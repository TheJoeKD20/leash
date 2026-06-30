/**
 * The {@link Tracer} writes {@link TraceEvent}s for a single run. Writes are
 * synchronous and flushed per-event when targeting a file, so a trace survives
 * even if the agent process is hard-killed mid-runaway — exactly when you most
 * want the forensic record.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Decision, Effect } from "../policy/types.js";
import type { UsageStats } from "../enforcement/limits.js";
import { preview, sanitizeArgs, type RedactOptions } from "./redact.js";
import type {
  CallEvent,
  CallOutcome,
  TraceEvent,
} from "./types.js";

export interface TracerOptions extends RedactOptions {
  runId: string;
  /** Append JSONL to this path. Parent directories are created as needed. */
  file?: string;
  /** Custom sink, called for every event. Composes with `file`. */
  sink?: (event: TraceEvent) => void;
  /** Keep events in memory for in-process inspection. Default `false`. */
  retain?: boolean;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

/** Fields the guard supplies when recording a completed call. */
export interface RecordCallInput {
  tool: string;
  args: Record<string, unknown>;
  decision: Effect;
  outcome: CallOutcome;
  reason: string;
  rule?: string;
  durationMs?: number;
  result?: unknown;
  error?: string;
}

export class Tracer {
  private seq = 0;
  private readonly events: TraceEvent[] = [];
  private readonly now: () => number;
  private fileReady = false;

  constructor(private readonly opts: TracerOptions) {
    this.now = opts.now ?? (() => Date.now());
  }

  get runId(): string {
    return this.opts.runId;
  }

  runStart(policySummary: string, policyName?: string): void {
    this.emit({
      v: 1,
      type: "run.start",
      ts: this.now(),
      runId: this.opts.runId,
      ...(policyName ? { policyName } : {}),
      policySummary,
    });
  }

  /** Record a completed (or blocked) call. Returns the emitted event. */
  recordCall(input: RecordCallInput): CallEvent {
    const event: CallEvent = {
      v: 1,
      type: "call",
      ts: this.now(),
      runId: this.opts.runId,
      seq: ++this.seq,
      tool: input.tool,
      args: sanitizeArgs(input.args, this.opts),
      decision: input.decision,
      outcome: input.outcome,
      reason: input.reason,
      ...(input.rule ? { rule: input.rule } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      ...(input.outcome === "allowed" && input.result !== undefined
        ? { resultPreview: preview(input.result, this.opts.maxStringLength) }
        : {}),
      ...(input.error ? { error: input.error } : {}),
    };
    this.emit(event);
    return event;
  }

  runEnd(stats: UsageStats, haltReason?: string): void {
    this.emit({
      v: 1,
      type: "run.end",
      ts: this.now(),
      runId: this.opts.runId,
      stats,
      ...(haltReason ? { haltReason } : {}),
    });
  }

  /** In-memory events (only populated when `retain: true`). */
  getEvents(): readonly TraceEvent[] {
    return this.events;
  }

  private emit(event: TraceEvent): void {
    if (this.opts.retain) this.events.push(event);
    if (this.opts.file) this.appendToFile(event);
    if (this.opts.sink) {
      try {
        this.opts.sink(event);
      } catch {
        // A misbehaving sink must never break the guarded run.
      }
    }
  }

  private appendToFile(event: TraceEvent): void {
    const file = this.opts.file!;
    try {
      if (!this.fileReady) {
        mkdirSync(dirname(file), { recursive: true });
        this.fileReady = true;
      }
      appendFileSync(file, JSON.stringify(event) + "\n");
    } catch {
      // Tracing is best-effort; never let it crash the agent.
    }
  }
}

/** Build the one-line policy summary stored at run start. */
export function summarizePolicyDecision(decision: Decision): string {
  return decision.reason;
}
