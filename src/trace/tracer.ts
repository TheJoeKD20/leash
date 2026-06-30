/**
 * The {@link Tracer} writes {@link TraceEvent}s for a single run. Writes are
 * synchronous and flushed per-event when targeting a file, so a trace survives
 * even if the agent process is hard-killed mid-runaway — exactly when you most
 * want the forensic record.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Effect } from "../policy/types.js";
import type { UsageStats } from "../enforcement/limits.js";
import { preview, sanitize, sanitizeArgs, type RedactOptions } from "./redact.js";
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
  /**
   * Record a redacted+truncated preview of each allowed call's result. Default
   * `true`. Set `false` if tool outputs may carry secrets that key-based
   * redaction can't catch (e.g. a file's raw contents), so nothing of the
   * result body reaches the trace.
   */
  captureResults?: boolean;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

/** Fields the guard supplies when recording a completed call. */
export interface RecordCallInput {
  /** Sequence number for this call, owned by the caller (the leash). */
  seq: number;
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
      seq: input.seq,
      tool: input.tool,
      args: sanitizeArgs(input.args, this.opts),
      decision: input.decision,
      outcome: input.outcome,
      reason: input.reason,
      ...(input.rule ? { rule: input.rule } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      ...(this.opts.captureResults !== false &&
      input.outcome === "allowed" &&
      input.result !== undefined
        ? // Redact sensitive keys in structured results and truncate, so a
          // tool returning an object full of secrets doesn't leak into the trace.
          { resultPreview: preview(sanitize(input.result, this.opts), this.opts.maxStringLength) }
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
