import { describe, expect, it, vi } from "vitest";
import { createLeash, isBlocked } from "../src/leash.js";
import { allow, ask, deny } from "../src/policy/builder.js";
import { LimitExceededError, PolicyViolationError } from "../src/errors.js";
import type { TraceEvent } from "../src/trace/types.js";

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("Leash.guard", () => {
  it("runs allowed calls and returns their result", async () => {
    const leash = createLeash({ policy: { rules: [allow("*")] } });
    const out = await leash.guard({ tool: "fs.read", args: { path: "a" } }, () => "data");
    expect(out).toBe("data");
  });

  it("blocks denied calls with a structured result (block mode)", async () => {
    const leash = createLeash({ policy: { rules: [deny("fs.write")] } });
    let ran = false;
    const out = await leash.guard({ tool: "fs.write", args: {} }, () => {
      ran = true;
      return "wrote";
    });
    expect(ran).toBe(false);
    expect(isBlocked(out)).toBe(true);
    if (isBlocked(out)) {
      expect(out.code).toBe("POLICY_VIOLATION");
      expect(out.tool).toBe("fs.write");
    }
  });

  it("throws denied calls in throw mode", async () => {
    const leash = createLeash({
      policy: { rules: [deny("fs.write")] },
      onViolation: "throw",
    });
    await expect(
      leash.guard({ tool: "fs.write", args: {} }, () => "x"),
    ).rejects.toBeInstanceOf(PolicyViolationError);
  });

  it("fails closed on ask without an approval handler", async () => {
    const leash = createLeash({ policy: { rules: [ask("deploy")] } });
    const out = await leash.guard({ tool: "deploy", args: {} }, () => "shipped");
    expect(isBlocked(out)).toBe(true);
    if (isBlocked(out)) expect(out.code).toBe("APPROVAL_REJECTED");
  });

  it("runs ask calls when the handler approves", async () => {
    const onApproval = vi.fn().mockResolvedValue(true);
    const leash = createLeash({ policy: { rules: [ask("deploy")] }, onApproval });
    const out = await leash.guard({ tool: "deploy", args: { env: "prod" } }, () => "shipped");
    expect(out).toBe("shipped");
    expect(onApproval).toHaveBeenCalledOnce();
    expect(onApproval.mock.calls[0]![0].call.tool).toBe("deploy");
  });

  it("blocks ask calls when the handler rejects with a reason", async () => {
    const leash = createLeash({
      policy: { rules: [ask("deploy")] },
      onApproval: () => ({ approved: false, reason: "not on a Friday" }),
    });
    const out = await leash.guard({ tool: "deploy", args: {} }, () => "shipped");
    expect(isBlocked(out)).toBe(true);
    if (isBlocked(out)) expect(out.message).toMatch(/not on a Friday/);
  });

  it("hard-stops and stays halted once a limit trips", async () => {
    const leash = createLeash({
      policy: { rules: [allow("*")], limits: { maxToolCalls: 1 } },
    });
    await leash.guard({ tool: "x", args: {} }, () => 1);
    // Second call exceeds the cap — kill-switch always throws.
    await expect(leash.guard({ tool: "x", args: {} }, () => 2)).rejects.toBeInstanceOf(
      LimitExceededError,
    );
    expect(leash.isHalted).toBe(true);
    // Even a previously-fine call is now refused.
    await expect(leash.guard({ tool: "x", args: {} }, () => 3)).rejects.toBeInstanceOf(
      LimitExceededError,
    );
  });

  it("propagates tool errors and records them", async () => {
    const events: TraceEvent[] = [];
    const leash = createLeash({
      policy: { rules: [allow("*")] },
      trace: { sink: (e) => events.push(e) },
    });
    await expect(
      leash.guard({ tool: "boom", args: {} }, () => {
        throw new Error("kaboom");
      }),
    ).rejects.toThrow("kaboom");
    const call = events.find((e) => e.type === "call");
    expect(call?.type === "call" && call.outcome).toBe("error");
  });

  it("emits a complete trace with redaction", async () => {
    const events: TraceEvent[] = [];
    const leash = createLeash({
      policy: { rules: [allow("*")] },
      trace: { sink: (e) => events.push(e), retain: true },
      now: clock().now,
    });
    await leash.guard(
      { tool: "http.fetch", args: { url: "https://x.com", apiKey: "sk-secret" } },
      () => ({ ok: true }),
    );
    leash.end();

    const types = events.map((e) => e.type);
    expect(types).toEqual(["run.start", "call", "run.end"]);
    const call = events[1];
    if (call?.type === "call") {
      expect(call.args.apiKey).toBe("[redacted]");
      expect(call.args.url).toBe("https://x.com");
      expect(call.outcome).toBe("allowed");
    }
  });

  it("enforces the token budget eagerly on reportTokens and halts", async () => {
    const leash = createLeash({
      policy: { rules: [allow("*")], limits: { maxTokens: 100 } },
    });
    // Over-budget report throws immediately (no further tool call needed) and
    // permanently halts the run.
    expect(() => leash.reportTokens(200)).toThrow(LimitExceededError);
    expect(leash.isHalted).toBe(true);
    await expect(leash.guard({ tool: "x", args: {} }, () => 1)).rejects.toBeInstanceOf(
      LimitExceededError,
    );
  });
});
