/**
 * Ergonomic helpers for authoring policies. These are thin sugar over the
 * plain {@link Rule}/{@link Policy} object literals — you never *need* them,
 * but they read nicely:
 *
 * ```ts
 * const policy = definePolicy({
 *   rules: [
 *     allow("fs.read", { path: "./src/**" }),
 *     deny("fs.*", { reason: "writes are off-limits" }),
 *     ask("http.fetch", { host: "*.github.com" }),
 *   ],
 *   limits: { maxToolCalls: 50 },
 * });
 * ```
 */
import type { NameMatcher, Policy, Rule } from "./types.js";

type RuleExtras = Omit<Rule, "tool" | "effect">;

function makeRule(
  effect: Rule["effect"],
  tool?: NameMatcher,
  extras: RuleExtras = {},
): Rule {
  return { effect, ...(tool !== undefined ? { tool } : {}), ...extras };
}

/** Create an `allow` rule. */
export function allow(tool?: NameMatcher, extras: RuleExtras = {}): Rule {
  return makeRule("allow", tool, extras);
}

/** Create a `deny` rule. */
export function deny(tool?: NameMatcher, extras: RuleExtras = {}): Rule {
  return makeRule("deny", tool, extras);
}

/** Create an `ask` (human-approval) rule. */
export function ask(tool?: NameMatcher, extras: RuleExtras = {}): Rule {
  return makeRule("ask", tool, extras);
}

/**
 * Identity helper that exists purely for type-checking and readability: it
 * validates the shape of a policy literal at the call site.
 */
export function definePolicy(policy: Policy): Policy {
  return policy;
}
