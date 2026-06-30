/**
 * Read and summarize a JSONL trace. Used by `leash view` and exported for
 * programmatic analysis (e.g. asserting in tests that a denied call never ran).
 */
import { readFileSync } from "node:fs";
import type { CallEvent, RunEndEvent, RunStartEvent, TraceEvent } from "./types.js";

/** Parse a JSONL string into trace events, skipping blank/garbage lines. */
export function parseTrace(jsonl: string): TraceEvent[] {
  const events: TraceEvent[] = [];
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && "type" in parsed) {
        events.push(parsed as TraceEvent);
      }
    } catch {
      // Ignore malformed lines so a partially-written trace still reads.
    }
  }
  return events;
}

/** Read and parse a trace file from disk. */
export function readTrace(path: string): TraceEvent[] {
  return parseTrace(readFileSync(path, "utf8"));
}

export interface TraceSummary {
  runId?: string;
  policyName?: string;
  policySummary?: string;
  start?: RunStartEvent;
  end?: RunEndEvent;
  calls: CallEvent[];
  counts: {
    total: number;
    allowed: number;
    denied: number;
    rejected: number;
    limited: number;
    errored: number;
  };
  /** True if any call was blocked (denied, rejected, or limited). */
  hadBlocks: boolean;
  haltReason?: string;
}

/** Reduce a list of trace events into a summary. */
export function summarizeTrace(events: TraceEvent[]): TraceSummary {
  const calls: CallEvent[] = [];
  let start: RunStartEvent | undefined;
  let end: RunEndEvent | undefined;

  for (const e of events) {
    if (e.type === "run.start") start = e;
    else if (e.type === "run.end") end = e;
    else if (e.type === "call") calls.push(e);
  }

  const counts = {
    total: calls.length,
    allowed: calls.filter((c) => c.outcome === "allowed").length,
    denied: calls.filter((c) => c.outcome === "denied").length,
    rejected: calls.filter((c) => c.outcome === "rejected").length,
    limited: calls.filter((c) => c.outcome === "limited").length,
    errored: calls.filter((c) => c.outcome === "error").length,
  };

  return {
    runId: start?.runId ?? end?.runId ?? calls[0]?.runId,
    policyName: start?.policyName,
    policySummary: start?.policySummary,
    start,
    end,
    calls,
    counts,
    hadBlocks: counts.denied + counts.rejected + counts.limited > 0,
    haltReason: end?.haltReason,
  };
}
