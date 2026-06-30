import { describe, expect, it } from "vitest";
import { LimitTracker } from "../src/enforcement/limits.js";
import { LimitExceededError } from "../src/errors.js";

function fixedClock(start = 0) {
  let t = start;
  const now = () => t;
  return { now, advance: (ms: number) => (t += ms) };
}

describe("LimitTracker", () => {
  it("enforces maxToolCalls", () => {
    const t = new LimitTracker({ maxToolCalls: 2 });
    const call = { tool: "x", args: {} };
    t.checkBeforeCall(call);
    t.recordCall(call);
    t.checkBeforeCall(call);
    t.recordCall(call);
    expect(() => t.checkBeforeCall(call)).toThrow(LimitExceededError);
  });

  it("enforces wall-clock budget", () => {
    const clock = fixedClock();
    const t = new LimitTracker({ wallClockMs: 1000 }, clock.now);
    const call = { tool: "x", args: {} };
    t.checkBeforeCall(call);
    clock.advance(1500);
    expect(() => t.checkBeforeCall(call)).toThrow(/Wall-clock budget/);
  });

  it("enforces token budget once reported", () => {
    const t = new LimitTracker({ maxTokens: 100 });
    const call = { tool: "x", args: {} };
    t.checkBeforeCall(call);
    t.reportTokens(150);
    expect(() => t.checkBeforeCall(call)).toThrow(/Token budget/);
  });

  it("enforces per-tool caps", () => {
    const t = new LimitTracker({ maxCallsPerTool: { "http.fetch": 1 } });
    const call = { tool: "http.fetch", args: {} };
    t.checkBeforeCall(call);
    t.recordCall(call);
    expect(() => t.checkBeforeCall(call)).toThrow(/Per-tool budget/);
  });

  it("detects loops via maxRepeatedCalls", () => {
    const t = new LimitTracker({ maxRepeatedCalls: 2 });
    const call = { tool: "search", args: { q: "same" } };
    t.checkBeforeCall(call); // 1
    t.checkBeforeCall(call); // 2
    expect(() => t.checkBeforeCall(call)).toThrow(/Loop detected/); // 3 > 2
  });

  it("loop detection is argument-order insensitive", () => {
    const t = new LimitTracker({ maxRepeatedCalls: 1 });
    t.checkBeforeCall({ tool: "x", args: { a: 1, b: 2 } });
    expect(() =>
      t.checkBeforeCall({ tool: "x", args: { b: 2, a: 1 } }),
    ).toThrow(/Loop detected/);
  });

  it("reports usage stats", () => {
    const clock = fixedClock();
    const t = new LimitTracker({}, clock.now);
    t.recordCall({ tool: "a", args: {} });
    t.recordCall({ tool: "a", args: {} });
    t.reportTokens(42);
    clock.advance(10);
    const s = t.stats();
    expect(s.toolCalls).toBe(2);
    expect(s.perTool.a).toBe(2);
    expect(s.tokens).toBe(42);
    expect(s.elapsedMs).toBe(10);
  });
});
