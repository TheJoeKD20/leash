/**
 * Framework-agnostic adapters. Everything else (Vercel, Anthropic) is a thin
 * shim over these. The core idea: a "tool" is a named async function, and to
 * leash it we route its invocation through {@link Leash.guard}.
 */
import type { Leash } from "../leash.js";

/**
 * A plain tool implementation: `(args) => result`. The argument type defaults
 * to `any` so concretely-typed tools (`(a: { path: string }) => …`) satisfy the
 * adapter constraint without widening — TypeScript's contravariant parameter
 * checking would otherwise reject them.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolFn<A = any, R = unknown> = (args: A) => R | Promise<R>;

/**
 * Wrap a single named tool function so every invocation passes through the
 * leash. The returned function has the same signature, but in `block` mode may
 * resolve to a structured block result instead of the tool's value.
 */
export function wrapToolFn<A, R>(
  leash: Leash,
  name: string,
  fn: ToolFn<A, R>,
): ToolFn<A, R> {
  return ((args: A) =>
    leash.guard({ tool: name, args: toArgsRecord(args) }, () => fn(args))) as ToolFn<A, R>;
}

/**
 * Coerce a tool's input into the `Record<string, unknown>` shape the policy
 * engine and tracer expect. Object inputs pass through; a primitive or array
 * input is wrapped as `{ value }` so arg-based matchers still have something to
 * match. Shared by every adapter so they normalize identically.
 */
export function toArgsRecord(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : { value: args };
}

/**
 * Wrap a record of tool functions (`{ name: fn }`) in one go. Handy when your
 * agent dispatches tools from a plain object map.
 */
export function wrapTools<T extends Record<string, ToolFn>>(
  leash: Leash,
  tools: T,
): T {
  const out: Record<string, ToolFn> = {};
  for (const [name, fn] of Object.entries(tools)) {
    out[name] = wrapToolFn(leash, name, fn);
  }
  return out as T;
}
