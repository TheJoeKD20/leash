/**
 * Redaction + truncation for trace payloads. The whole point of Leash is to
 * stop an agent exfiltrating secrets — so the trace itself must not become the
 * leak. By default we redact obviously-sensitive keys and truncate long values.
 */

export type RedactPredicate = (key: string, value: unknown) => boolean;

/** Keys whose values are redacted by default. */
export const DEFAULT_REDACT =
  /(^|[_\-.])(secret|token|password|passwd|api[_-]?key|apikey|access[_-]?key|authorization|auth|cookie|session|private[_-]?key|credential)s?($|[_\-.])/i;

const REDACTED = "[redacted]";

export interface RedactOptions {
  /** Keys matching this are redacted. Default {@link DEFAULT_REDACT}. */
  redact?: RegExp | RedactPredicate;
  /** Strings longer than this are truncated with an ellipsis marker. */
  maxStringLength?: number;
}

/**
 * Produce a redacted, truncated deep copy of an arbitrary value, suitable for
 * persisting to a trace. Never mutates the input.
 */
export function sanitize(value: unknown, opts: RedactOptions = {}): unknown {
  const maxLen = opts.maxStringLength ?? 512;
  const redactRe = opts.redact instanceof RegExp ? opts.redact : DEFAULT_REDACT;
  const pred: RedactPredicate =
    typeof opts.redact === "function" ? opts.redact : (key) => redactRe.test(key);

  const seen = new WeakSet<object>();

  const walk = (key: string, val: unknown): unknown => {
    if (key && pred(key, val)) return REDACTED;
    if (typeof val === "string") return truncate(val, maxLen);
    if (typeof val === "bigint") return `${val.toString()}n`;
    if (typeof val === "function") return `[Function ${val.name || "anonymous"}]`;
    if (val && typeof val === "object") {
      if (seen.has(val)) return "[circular]";
      seen.add(val);
      if (Array.isArray(val)) return val.map((v, i) => walk(String(i), v));
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) out[k] = walk(k, v);
      return out;
    }
    return val;
  };

  return walk("", value);
}

/** Sanitize a value and coerce it to a record (args are always objects). */
export function sanitizeArgs(
  args: Record<string, unknown>,
  opts: RedactOptions = {},
): Record<string, unknown> {
  return sanitize(args, opts) as Record<string, unknown>;
}

/** A short, single-line preview of any value for the trace. */
export function preview(value: unknown, maxLen = 512): string {
  let s: string;
  if (typeof value === "string") s = value;
  else {
    try {
      s = JSON.stringify(value);
    } catch {
      s = String(value);
    }
  }
  s = (s ?? "undefined").replace(/\s+/g, " ").trim();
  return truncate(s, maxLen);
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…[+${s.length - maxLen} chars]`;
}
