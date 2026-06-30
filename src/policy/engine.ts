/**
 * The policy engine: evaluate a {@link ToolCall} against a {@link Policy} and
 * return a {@link Decision}. Pure and synchronous — no I/O, no side effects —
 * so it is trivial to unit-test and reason about.
 */
import {
  callMatchesHost,
  callMatchesPath,
  matchArg,
  matchName,
} from "./matchers.js";
import type { Decision, Policy, Rule, ToolCall } from "./types.js";

/** Does a single rule match a call? (All listed conditions must hold.) */
export function ruleMatches(rule: Rule, call: ToolCall): boolean {
  if (rule.tool !== undefined && !matchName(call.tool, rule.tool)) return false;

  if (rule.args) {
    for (const [key, matcher] of Object.entries(rule.args)) {
      if (!matchArg(call.args[key], matcher)) return false;
    }
  }

  if (rule.path !== undefined && !callMatchesPath(call, rule.path)) return false;
  if (rule.host !== undefined && !callMatchesHost(call, rule.host)) return false;

  if (rule.when && !rule.when(call)) return false;

  return true;
}

/**
 * Evaluate a call against a policy. First matching rule wins; if none match,
 * the policy `default` effect applies (itself defaulting to `"deny"`).
 */
export function evaluate(policy: Policy, call: ToolCall): Decision {
  const rules = policy.rules ?? [];
  for (const rule of rules) {
    if (ruleMatches(rule, call)) {
      return {
        effect: rule.effect,
        rule,
        reason:
          rule.reason ??
          `${effectVerb(rule.effect)} by rule${rule.id ? ` "${rule.id}"` : ""}`,
      };
    }
  }

  const fallback = policy.default ?? "deny";
  return {
    effect: fallback,
    reason:
      fallback === "deny"
        ? "denied by default (no rule matched; Leash is deny-by-default)"
        : `${effectVerb(fallback)} by policy default`,
  };
}

function effectVerb(effect: string): string {
  switch (effect) {
    case "allow":
      return "allowed";
    case "deny":
      return "denied";
    case "ask":
      return "held for approval";
    default:
      return effect;
  }
}
