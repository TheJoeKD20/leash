/**
 * Trace event schema. A trace is an append-only JSONL stream: one event per
 * line. Events are deliberately flat and self-describing so a trace file can be
 * grepped, diffed, replayed, or rendered by `leash view` without the library.
 */
import type { Effect } from "../policy/types.js";
import type { UsageStats } from "../enforcement/limits.js";

export type TraceEventType = "run.start" | "call" | "run.end";

/** Outcome of a call as recorded in the trace. */
export type CallOutcome =
  | "allowed" // ran successfully
  | "error" // allowed, but the tool threw
  | "denied" // blocked by policy
  | "rejected" // held for approval, then rejected
  | "limited"; // blocked by a resource limit

interface BaseEvent {
  /** Schema/version marker so readers can evolve safely. */
  v: 1;
  type: TraceEventType;
  /** Epoch milliseconds. */
  ts: number;
  /** Run this event belongs to. */
  runId: string;
}

export interface RunStartEvent extends BaseEvent {
  type: "run.start";
  policyName?: string;
  /** Compact human-readable summary of the policy in force. */
  policySummary: string;
}

export interface CallEvent extends BaseEvent {
  type: "call";
  /** Monotonic sequence number within the run, starting at 1. */
  seq: number;
  tool: string;
  /** Arguments, after redaction. */
  args: Record<string, unknown>;
  decision: Effect;
  outcome: CallOutcome;
  /** Reason text from the policy decision or limit/approval gate. */
  reason: string;
  /** Id of the matched rule, if any. */
  rule?: string;
  /** Wall-clock duration of the tool execution in ms (allowed calls only). */
  durationMs?: number;
  /** Truncated preview of a successful result. */
  resultPreview?: string;
  /** Error message if the tool threw. */
  error?: string;
}

export interface RunEndEvent extends BaseEvent {
  type: "run.end";
  stats: UsageStats;
  /** Why the run ended, if it ended abnormally. */
  haltReason?: string;
}

export type TraceEvent = RunStartEvent | CallEvent | RunEndEvent;
