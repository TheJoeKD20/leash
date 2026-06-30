/**
 * {@link Leash} is the runtime context for a single agent run. It binds a
 * policy, the per-run resource limits, a tracer, and an optional approval
 * handler, and exposes one method every adapter funnels through: {@link Leash.guard}.
 *
 * ```ts
 * const leash = createLeash({ policy: safeDefaults(), trace: "./run.jsonl" });
 * const result = await leash.guard({ tool: "fs.read", args: { path } }, () =>
 *   fs.readFile(path, "utf8"),
 * );
 * ```
 */
import { normalizeApproval, type ApprovalHandler } from "./approval.js";
import { LimitTracker, type UsageStats } from "./enforcement/limits.js";
import {
  ApprovalRejectedError,
  LeashError,
  LimitExceededError,
  PolicyViolationError,
} from "./errors.js";
import { evaluate } from "./policy/engine.js";
import { safeDefaults } from "./policy/defaults.js";
import type { Decision, Policy, ToolCall } from "./policy/types.js";
import type { RedactOptions } from "./trace/redact.js";
import { Tracer } from "./trace/tracer.js";
import type { CallOutcome, TraceEvent } from "./trace/types.js";

/** How policy blocks are surfaced to the calling agent. */
export type ViolationMode = "block" | "throw";

export interface LeashOptions {
  /** Policy to enforce. Defaults to {@link safeDefaults}. */
  policy?: Policy;
  /**
   * Where to write the execution trace. A string is treated as a JSONL file
   * path; pass an object for finer control (custom sink, redaction, retention).
   */
  trace?: string | TraceOptions;
  /** Handler invoked for `ask` decisions. Without one, `ask` fails closed. */
  onApproval?: ApprovalHandler;
  /**
   * How policy denials / approval rejections are surfaced:
   * - `"block"` (default): return a structured error as the tool result so the
   *   agent can read it and adapt.
   * - `"throw"`: throw the {@link LeashError}.
   *
   * Resource-limit / loop hard-stops always throw — that is the kill-switch.
   */
  onViolation?: ViolationMode;
  /** Stable id for this run. Auto-generated if omitted. */
  runId?: string;
  /** Injectable clock, primarily for deterministic tests. */
  now?: () => number;
}

export interface TraceOptions extends RedactOptions {
  file?: string;
  sink?: (event: TraceEvent) => void;
  /** Retain events in memory (queryable via {@link Leash.events}). */
  retain?: boolean;
}

/** What a `block`-mode guard returns instead of a tool result. */
export interface BlockedResult {
  error: true;
  code: LeashError["code"];
  message: string;
  tool: string;
}

let runCounter = 0;

function makeRunId(now: () => number): string {
  // Deterministic-friendly: monotonic counter + clock, no Math.random.
  runCounter += 1;
  return `run_${now().toString(36)}_${runCounter.toString(36)}`;
}

export class Leash {
  readonly policy: Policy;
  readonly runId: string;
  private readonly limits: LimitTracker;
  private readonly tracer: Tracer;
  private readonly onApproval?: ApprovalHandler;
  private readonly violationMode: ViolationMode;
  private readonly now: () => number;
  private seq = 0;
  private halted?: { reason: string; error: LimitExceededError };
  private ended = false;

  constructor(options: LeashOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.policy = options.policy ?? safeDefaults();
    this.runId = options.runId ?? makeRunId(this.now);
    this.onApproval = options.onApproval;
    this.violationMode = options.onViolation ?? "block";
    this.limits = new LimitTracker(this.policy.limits, this.now);

    const traceOpts: TraceOptions =
      typeof options.trace === "string"
        ? { file: options.trace }
        : (options.trace ?? {});
    this.tracer = new Tracer({
      runId: this.runId,
      now: this.now,
      ...traceOpts,
    });
    this.tracer.runStart(summarizePolicy(this.policy), this.policy.name);
  }

  /**
   * Run `exec` if-and-only-if `call` passes limits and policy. The single
   * choke point every adapter uses.
   *
   * In `block` mode a denied/rejected call resolves to a {@link BlockedResult}
   * instead of running `exec`. In `throw` mode it throws. Resource-limit and
   * loop hard-stops always throw and permanently halt the leash.
   */
  async guard<T>(call: ToolCall, exec: () => T | Promise<T>): Promise<T | BlockedResult> {
    const seq = ++this.seq;

    // Once halted, every subsequent call is refused immediately.
    if (this.halted) {
      this.tracer.recordCall({
        tool: call.tool,
        args: call.args,
        decision: "deny",
        outcome: "limited",
        reason: `run halted: ${this.halted.reason}`,
      });
      throw this.halted.error;
    }

    // 1. Resource limits / loop detection — the kill-switch. Always throws.
    try {
      this.limits.checkBeforeCall(call);
    } catch (e) {
      if (e instanceof LimitExceededError) {
        this.tracer.recordCall({
          tool: call.tool,
          args: call.args,
          decision: "deny",
          outcome: "limited",
          reason: e.message,
        });
        this.halt(e);
        throw e;
      }
      throw e;
    }

    // 2. Policy evaluation.
    const decision = evaluate(this.policy, call);

    if (decision.effect === "deny") {
      return this.block(call, new PolicyViolationError(call, decision), "denied", decision);
    }

    if (decision.effect === "ask") {
      const approved = await this.requestApproval(call, decision, seq);
      if (!approved.approved) {
        return this.block(
          call,
          new ApprovalRejectedError(call, decision, approved.reason),
          "rejected",
          decision,
        );
      }
    }

    // 3. Allowed (or approved): execute with timing, record outcome.
    this.limits.recordCall(call);
    const startedAt = this.now();
    try {
      const result = await exec();
      this.tracer.recordCall({
        tool: call.tool,
        args: call.args,
        decision: decision.effect,
        outcome: "allowed",
        reason: decision.reason,
        rule: decision.rule?.id,
        durationMs: this.now() - startedAt,
        result,
      });
      return result;
    } catch (err) {
      this.tracer.recordCall({
        tool: call.tool,
        args: call.args,
        decision: decision.effect,
        outcome: "error",
        reason: decision.reason,
        rule: decision.rule?.id,
        durationMs: this.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /** Add to the run's token budget tally. */
  reportTokens(tokens: number): void {
    this.limits.reportTokens(tokens);
  }

  /** Current usage snapshot. */
  stats(): UsageStats {
    return this.limits.stats();
  }

  /** True once a hard-stop has fired. */
  get isHalted(): boolean {
    return this.halted !== undefined;
  }

  /** In-memory trace events (only when `trace.retain` is set). */
  events(): readonly TraceEvent[] {
    return this.tracer.getEvents();
  }

  /**
   * Finalize the run: write the `run.end` event with final stats. Idempotent.
   * Call this when the agent loop completes.
   */
  end(haltReason?: string): UsageStats {
    const stats = this.limits.stats();
    if (!this.ended) {
      this.tracer.runEnd(stats, haltReason ?? this.halted?.reason);
      this.ended = true;
    }
    return stats;
  }

  private halt(error: LimitExceededError): void {
    if (!this.halted) {
      this.halted = { reason: error.message, error };
      this.end(error.message);
    }
  }

  private async requestApproval(
    call: ToolCall,
    decision: Decision,
    seq: number,
  ): Promise<{ approved: boolean; reason?: string }> {
    if (!this.onApproval) {
      return { approved: false, reason: "no approval handler configured (fail closed)" };
    }
    try {
      const result = await this.onApproval({ call, decision, seq });
      return normalizeApproval(result);
    } catch (e) {
      return {
        approved: false,
        reason: `approval handler threw: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  private block(
    call: ToolCall,
    error: LeashError,
    outcome: CallOutcome,
    decision: Decision,
  ): BlockedResult {
    this.tracer.recordCall({
      tool: call.tool,
      args: call.args,
      decision: "deny",
      outcome,
      reason: error.message,
      rule: decision.rule?.id,
    });
    if (this.violationMode === "throw") throw error;
    return { error: true, code: error.code, message: error.message, tool: call.tool };
  }
}

/** Convenience factory mirroring the `createX` idiom. */
export function createLeash(options?: LeashOptions): Leash {
  return new Leash(options);
}

/** Type guard for the structured block result returned in `block` mode. */
export function isBlocked(value: unknown): value is BlockedResult {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as BlockedResult).error === true &&
    typeof (value as BlockedResult).tool === "string"
  );
}

/** One-line, human-readable summary of a policy for the trace header. */
export function summarizePolicy(policy: Policy): string {
  const parts: string[] = [];
  parts.push(`${policy.rules?.length ?? 0} rules`);
  parts.push(`default=${policy.default ?? "deny"}`);
  const l = policy.limits;
  if (l) {
    const limitBits: string[] = [];
    if (l.maxToolCalls !== undefined) limitBits.push(`calls≤${l.maxToolCalls}`);
    if (l.maxTokens !== undefined) limitBits.push(`tokens≤${l.maxTokens}`);
    if (l.wallClockMs !== undefined) limitBits.push(`wall≤${l.wallClockMs}ms`);
    if (l.maxRepeatedCalls) limitBits.push(`repeat≤${l.maxRepeatedCalls}`);
    if (limitBits.length) parts.push(`limits:${limitBits.join(",")}`);
  }
  const prefix = policy.name ? `${policy.name}: ` : "";
  return prefix + parts.join(", ");
}
