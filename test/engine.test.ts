import { describe, expect, it } from "vitest";
import { evaluate } from "../src/policy/engine.js";
import { allow, ask, deny } from "../src/policy/builder.js";
import type { Policy } from "../src/policy/types.js";

describe("evaluate", () => {
  it("is deny-by-default", () => {
    const d = evaluate({}, { tool: "anything", args: {} });
    expect(d.effect).toBe("deny");
    expect(d.reason).toMatch(/deny-by-default/);
  });

  it("honours an explicit default", () => {
    const d = evaluate({ default: "allow" }, { tool: "x", args: {} });
    expect(d.effect).toBe("allow");
  });

  it("first match wins", () => {
    const policy: Policy = {
      rules: [
        deny("fs.write", { reason: "no writes" }),
        allow("fs.*"),
      ],
    };
    expect(evaluate(policy, { tool: "fs.write", args: {} }).effect).toBe("deny");
    expect(evaluate(policy, { tool: "fs.read", args: {} }).effect).toBe("allow");
  });

  it("ANDs all rule conditions", () => {
    const policy: Policy = {
      rules: [allow("fs.read", { path: "src/**" })],
      default: "deny",
    };
    expect(
      evaluate(policy, { tool: "fs.read", args: { path: "src/a.ts" } }).effect,
    ).toBe("allow");
    expect(
      evaluate(policy, { tool: "fs.read", args: { path: "/etc/passwd" } }).effect,
    ).toBe("deny");
  });

  it("matches host sugar against nested args", () => {
    const policy: Policy = {
      rules: [allow("http.fetch", { host: "*.github.com" })],
      default: "deny",
    };
    expect(
      evaluate(policy, {
        tool: "http.fetch",
        args: { request: { url: "https://api.github.com/x" } },
      }).effect,
    ).toBe("allow");
    expect(
      evaluate(policy, {
        tool: "http.fetch",
        args: { request: { url: "https://evil.com" } },
      }).effect,
    ).toBe("deny");
  });

  it("matches named arg matchers", () => {
    const policy: Policy = {
      rules: [ask("payments.charge", { args: { amount: (v) => Number(v) > 100 } })],
      default: "allow",
    };
    expect(
      evaluate(policy, { tool: "payments.charge", args: { amount: 500 } }).effect,
    ).toBe("ask");
    expect(
      evaluate(policy, { tool: "payments.charge", args: { amount: 5 } }).effect,
    ).toBe("allow");
  });

  it("surfaces the matched rule and reason", () => {
    const policy: Policy = {
      rules: [deny("bash", { id: "no-bash", reason: "shell disabled" })],
    };
    const d = evaluate(policy, { tool: "bash", args: {} });
    expect(d.rule?.id).toBe("no-bash");
    expect(d.reason).toBe("shell disabled");
  });
});
