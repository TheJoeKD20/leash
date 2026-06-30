import { describe, expect, it } from "vitest";
import { evaluate } from "../src/policy/engine.js";
import {
  denyNetworkPolicy,
  readOnlyFsPolicy,
  safeDefaults,
} from "../src/policy/defaults.js";

describe("safeDefaults", () => {
  const policy = safeDefaults();

  it("denies network egress", () => {
    expect(evaluate(policy, { tool: "http.fetch", args: { url: "https://x" } }).effect).toBe(
      "deny",
    );
    expect(evaluate(policy, { tool: "fetch", args: {} }).effect).toBe("deny");
  });

  it("denies filesystem writes but allows scoped reads", () => {
    expect(evaluate(policy, { tool: "fs.write", args: { path: "a" } }).effect).toBe("deny");
    expect(evaluate(policy, { tool: "fs.read", args: { path: "src/a.ts" } }).effect).toBe(
      "allow",
    );
  });

  it("blocks destructive shell", () => {
    expect(
      evaluate(policy, { tool: "bash", args: { command: "rm -rf /" } }).effect,
    ).toBe("deny");
  });

  it("denies anything unmatched (deny by default)", () => {
    expect(evaluate(policy, { tool: "some.random.tool", args: {} }).effect).toBe("deny");
  });

  it("ships conservative limits", () => {
    expect(policy.limits?.maxToolCalls).toBeGreaterThan(0);
    expect(policy.limits?.maxRepeatedCalls).toBeGreaterThan(0);
  });
});

describe("denyNetworkPolicy", () => {
  it("denies network, allows the rest", () => {
    const p = denyNetworkPolicy();
    expect(evaluate(p, { tool: "http.fetch", args: {} }).effect).toBe("deny");
    expect(evaluate(p, { tool: "fs.read", args: {} }).effect).toBe("allow");
  });
});

describe("readOnlyFsPolicy", () => {
  it("denies writes, allows reads", () => {
    const p = readOnlyFsPolicy();
    expect(evaluate(p, { tool: "fs.write", args: {} }).effect).toBe("deny");
    expect(evaluate(p, { tool: "fs.read", args: {} }).effect).toBe("allow");
  });
});
