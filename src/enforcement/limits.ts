/**
 * Per-run resource accounting and hard-stops. A {@link LimitTracker} holds the
 * mutable counters for a single agent run and decides when a cap has been
 * exceeded. It is intentionally separate from the policy engine: policy is
 * about *what* a call may do; limits are about *how much* the run may do in
 * aggregate.
 */
import { LimitExceededError } from "../errors.js";
import type { ResourceLimits, ToolCall } from "../policy/types.js";

/** Cap on distinct call signatures kept for loop detection (memory bound). */
const MAX_REPEAT_SIGNATURES = 10_000;

/** A point-in-time snapshot of run usage, surfaced in stats and traces. */
export interface UsageStats {
  toolCalls: number;
  tokens: number;
  elapsedMs: number;
  perTool: Record<string, number>;
}

/** Stable signature for a call, used by loop detection. */
function callSignature(call: ToolCall): string {
  // Sort keys so argument order doesn't defeat de-duplication.
  return `${call.tool}(${stableStringify(call.args)})`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export class LimitTracker {
  private toolCalls = 0;
  private tokens = 0;
  private readonly perTool = new Map<string, number>();
  private readonly repeats = new Map<string, number>();
  private readonly startedAt: number;

  constructor(
    private readonly limits: ResourceLimits = {},
    /** Injectable clock for deterministic tests. */
    private readonly now: () => number = () => Date.now(),
  ) {
    this.startedAt = now();
  }

  /** Milliseconds since the run started. */
  elapsedMs(): number {
    return this.now() - this.startedAt;
  }

  /**
   * Add to the run's token tally (call as the model reports usage), then check
   * the token budget. Throws {@link LimitExceededError} if the budget is now
   * exceeded — so a pure-generation token burn is caught immediately, even
   * without another tool call.
   */
  reportTokens(n: number): void {
    if (n > 0) this.tokens += n;
    this.checkTokenBudget();
  }

  /** Throw if the reported token total has exceeded the budget. */
  checkTokenBudget(call?: ToolCall): void {
    const { maxTokens } = this.limits;
    if (maxTokens !== undefined && this.tokens > maxTokens) {
      throw new LimitExceededError(
        "maxTokens",
        this.tokens,
        maxTokens,
        `Token budget exhausted: ${this.tokens} reported of ${maxTokens}`,
        call,
      );
    }
  }

  /**
   * Check the limits that gate a call *before* it runs: wall-clock, token
   * budget, the total tool-call cap, and the per-tool cap. Throws
   * {@link LimitExceededError} on the first cap exceeded. The total/per-tool
   * caps count only *executed* calls, so blocked calls don't consume budget.
   * Loop detection is handled separately by {@link checkRepeat}.
   */
  checkBeforeCall(call: ToolCall): void {
    const { maxToolCalls, wallClockMs, maxCallsPerTool } = this.limits;

    if (wallClockMs !== undefined) {
      const elapsed = this.elapsedMs();
      if (elapsed > wallClockMs) {
        throw new LimitExceededError(
          "wallClockMs",
          elapsed,
          wallClockMs,
          `Wall-clock budget exhausted: ${elapsed}ms elapsed of ${wallClockMs}ms`,
          call,
        );
      }
    }

    this.checkTokenBudget(call);

    if (maxToolCalls !== undefined && this.toolCalls >= maxToolCalls) {
      throw new LimitExceededError(
        "maxToolCalls",
        this.toolCalls,
        maxToolCalls,
        `Tool-call budget exhausted: ${this.toolCalls} of ${maxToolCalls} used`,
        call,
      );
    }

    if (maxCallsPerTool && maxCallsPerTool[call.tool] !== undefined) {
      const used = this.perTool.get(call.tool) ?? 0;
      const cap = maxCallsPerTool[call.tool]!;
      if (used >= cap) {
        throw new LimitExceededError(
          `maxCallsPerTool:${call.tool}`,
          used,
          cap,
          `Per-tool budget for "${call.tool}" exhausted: ${used} of ${cap} used`,
          call,
        );
      }
    }
  }

  /**
   * Loop / runaway detection. Call this only for calls that are about to
   * *execute* (i.e. after policy has allowed them) so a stream of policy-denied
   * calls — which never ran and did no harm — can't trip a terminal hard-stop.
   * Throws {@link LimitExceededError} once an identical call repeats past the cap.
   */
  checkRepeat(call: ToolCall): void {
    const { maxRepeatedCalls } = this.limits;
    if (!maxRepeatedCalls || maxRepeatedCalls <= 0) return;

    const sig = callSignature(call);
    const prior = this.repeats.get(sig);
    // Bound the signature map so a long run with many distinct calls can't grow
    // it without limit; once full we still track signatures already seen.
    if (prior === undefined && this.repeats.size >= MAX_REPEAT_SIGNATURES) return;

    const seen = (prior ?? 0) + 1;
    this.repeats.set(sig, seen);
    if (seen > maxRepeatedCalls) {
      throw new LimitExceededError(
        "maxRepeatedCalls",
        seen,
        maxRepeatedCalls,
        `Loop detected: identical call ${sig} repeated ${seen} times ` +
          `(cap ${maxRepeatedCalls}) — halting runaway agent`,
        call,
      );
    }
  }

  /** Record that an allowed call actually executed. */
  recordCall(call: ToolCall): void {
    this.toolCalls += 1;
    this.perTool.set(call.tool, (this.perTool.get(call.tool) ?? 0) + 1);
  }

  /** Current usage snapshot. */
  stats(): UsageStats {
    return {
      toolCalls: this.toolCalls,
      tokens: this.tokens,
      elapsedMs: this.elapsedMs(),
      perTool: Object.fromEntries(this.perTool),
    };
  }
}
