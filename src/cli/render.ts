/**
 * Render a parsed trace into a human-readable timeline. Pure string-in /
 * string-out so it can be snapshot-tested without touching stdout.
 */
import type { TraceEvent, CallEvent } from "../trace/types.js";
import { summarizeTrace } from "../trace/reader.js";
import { makeColors } from "./colors.js";

export interface RenderOptions {
  color?: boolean;
  /** Show redacted argument values inline. Default `true`. */
  showArgs?: boolean;
}

const GLYPH: Record<CallEvent["outcome"], string> = {
  allowed: "✔",
  error: "✘",
  denied: "⛔",
  rejected: "✋",
  limited: "🛑",
};

/** Render a full trace timeline. */
export function renderTrace(events: TraceEvent[], opts: RenderOptions = {}): string {
  const c = makeColors(opts.color ?? false);
  const showArgs = opts.showArgs ?? true;
  const s = summarizeTrace(events);
  const lines: string[] = [];

  // Header.
  lines.push(c.bold(`leash trace · ${s.runId ?? "unknown run"}`));
  if (s.policySummary) {
    lines.push(c.dim(`policy: ${s.policyName ? "" : ""}${s.policySummary}`));
  }
  lines.push("");

  // Timeline.
  const t0 = s.start?.ts ?? s.calls[0]?.ts;
  for (const call of s.calls) {
    lines.push(renderCall(call, t0, c, showArgs));
  }
  if (s.calls.length === 0) lines.push(c.dim("  (no tool calls recorded)"));

  // Footer / summary.
  lines.push("");
  lines.push(c.bold("summary"));
  const { counts } = s;
  lines.push(
    "  " +
      [
        c.green(`${counts.allowed} allowed`),
        c.red(`${counts.denied} denied`),
        c.yellow(`${counts.rejected} rejected`),
        c.magenta(`${counts.limited} limited`),
        c.gray(`${counts.errored} errored`),
      ].join(c.dim(" · ")),
  );
  if (s.end) {
    const { stats } = s.end;
    lines.push(
      c.dim(
        `  ${stats.toolCalls} calls · ${stats.tokens} tokens · ${stats.elapsedMs}ms wall`,
      ),
    );
  }
  if (s.haltReason) {
    lines.push("");
    lines.push(c.red(c.bold(`🛑 HALTED: ${s.haltReason}`)));
  }
  return lines.join("\n");
}

function renderCall(
  call: CallEvent,
  t0: number | undefined,
  c: ReturnType<typeof makeColors>,
  showArgs: boolean,
): string {
  const glyph = GLYPH[call.outcome];
  const offset = t0 !== undefined ? `+${pad(call.ts - t0, 6)}ms` : "";
  const seq = `#${String(call.seq).padStart(2, "0")}`;
  const colorFor =
    call.outcome === "allowed"
      ? c.green
      : call.outcome === "error"
        ? c.gray
        : call.outcome === "denied"
          ? c.red
          : call.outcome === "rejected"
            ? c.yellow
            : c.magenta;

  const head = `${c.dim(seq)} ${c.dim(offset)} ${colorFor(glyph)} ${c.bold(call.tool)}`;
  const parts = [head];

  if (showArgs) {
    const args = compactArgs(call.args);
    if (args) parts.push(c.dim(args));
  }

  const detail: string[] = [];
  if (call.durationMs !== undefined) detail.push(c.dim(`${call.durationMs}ms`));
  if (call.outcome === "allowed" && call.resultPreview) {
    detail.push(c.gray(`→ ${call.resultPreview}`));
  }
  if (call.outcome !== "allowed") {
    detail.push(colorFor(call.reason));
  }
  if (call.outcome === "error" && call.error) {
    detail.push(c.gray(`threw: ${call.error}`));
  }

  const main = parts.join(" ");
  if (detail.length === 0) return `  ${main}`;
  return `  ${main}\n      ${detail.join(c.dim(" · "))}`;
}

function compactArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return "";
  const inner = keys
    .map((k) => `${k}=${shortValue(args[k])}`)
    .join(", ");
  return `(${inner})`;
}

function shortValue(v: unknown): string {
  if (typeof v === "string") return v.length > 48 ? `"${v.slice(0, 48)}…"` : `"${v}"`;
  if (v === null || typeof v !== "object") return String(v);
  try {
    const j = JSON.stringify(v);
    return j.length > 48 ? `${j.slice(0, 48)}…` : j;
  } catch {
    return "[object]";
  }
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, " ");
}
