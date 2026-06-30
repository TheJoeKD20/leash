/**
 * Core policy types for Leash.
 *
 * A {@link Policy} is a flat, ordered list of {@link Rule}s plus optional
 * resource limits. Rules are evaluated first-match-wins (top to bottom). If no
 * rule matches, the policy `default` effect applies (which itself defaults to
 * `deny` — Leash is deny-by-default and safe out of the box).
 */

/** What Leash should do with a tool call. */
export type Effect = "allow" | "deny" | "ask";

/** A single tool invocation, as seen by the policy engine. */
export interface ToolCall {
  /** Tool name, e.g. `"fs.read"`, `"http.fetch"`, `"bash"`. */
  tool: string;
  /** Arguments the agent passed to the tool. */
  args: Record<string, unknown>;
}

/**
 * Matches a tool name. A string is treated as a glob (`"fs.*"`, `"*"`), so an
 * exact name like `"bash"` matches itself. A `RegExp` is tested directly. An
 * array matches if any entry matches.
 */
export type NameMatcher = string | RegExp | Array<string | RegExp>;

/**
 * Matches a single argument value. The cheapest useful primitives, plus a
 * custom predicate escape hatch.
 */
export type ArgMatcher =
  | { equals: unknown }
  | { oneOf: unknown[] }
  | { glob: string | string[] }
  | { host: string | string[] }
  | { regex: string | RegExp }
  | { contains: string }
  | { exists: boolean }
  | ((value: unknown) => boolean);

/**
 * A policy rule. All specified conditions must match for the rule to apply
 * (logical AND). Omitted conditions are treated as "always matches".
 */
export interface Rule {
  /** Match by tool name. Omit to match every tool. */
  tool?: NameMatcher;
  /**
   * Match named arguments. Each key is matched against `call.args[key]`.
   * All listed keys must match for the rule to apply.
   */
  args?: Record<string, ArgMatcher>;
  /**
   * Ergonomic sugar: match a path-like glob against *any* string argument
   * value (recursively). Handy for `fs.*` tools without naming the field.
   *
   * Note: because it matches *any* leaf, this is fail-safe for `deny` rules but
   * can be too permissive for `allow` rules — scope an allowlist to a specific
   * field with `args: { path: { glob: "src/**" } }` instead. Values are
   * lexically normalized (`.`/`..` resolved) before matching.
   */
  path?: string | string[];
  /**
   * Ergonomic sugar: match a URL host against *any* string argument value
   * that parses as a URL (recursively). Handy for network tools.
   *
   * Note: as with {@link path}, this matches *any* leaf — prefer
   * `args: { url: { host: "*.github.com" } }` for precise allowlists so an
   * unrelated field can't widen an `allow` rule.
   */
  host?: string | string[];
  /** Fully custom predicate over the whole call. ANDed with the above. */
  when?: (call: ToolCall) => boolean;
  /** What to do when this rule matches. */
  effect: Effect;
  /** Human-readable explanation, surfaced in errors and traces. */
  reason?: string;
  /** Optional stable id for referencing this rule in traces. */
  id?: string;
}

/**
 * Per-run resource caps. These are enforced across the lifetime of a single
 * {@link Leash} instance (one agent run).
 */
export interface ResourceLimits {
  /** Maximum total number of allowed tool calls for the run. */
  maxToolCalls?: number;
  /**
   * Maximum total tokens for the run. Tokens are not observable from tool
   * calls alone — report them with `leash.reportTokens(n)` as the model
   * consumes them, and Leash hard-stops once the budget is exceeded.
   */
  maxTokens?: number;
  /** Wall-clock budget in milliseconds from leash creation. */
  wallClockMs?: number;
  /** Per-tool call caps, e.g. `{ "http.fetch": 20 }`. */
  maxCallsPerTool?: Record<string, number>;
  /**
   * Loop / runaway detection: if the *same* (tool, args) call repeats this
   * many times, Leash hard-stops the run. Set to `0`/`undefined` to disable.
   */
  maxRepeatedCalls?: number;
}

/** A complete policy. */
export interface Policy {
  /** Ordered rules; first match wins. */
  rules?: Rule[];
  /** Effect applied when no rule matches. Defaults to `"deny"`. */
  default?: Effect;
  /** Per-run resource caps. */
  limits?: ResourceLimits;
  /** Optional name, surfaced in traces. */
  name?: string;
}

/** The result of evaluating a single call against a policy. */
export interface Decision {
  effect: Effect;
  /** The matched rule, or `undefined` if the policy default applied. */
  rule?: Rule;
  /** Human-readable reason for the decision. */
  reason: string;
}
