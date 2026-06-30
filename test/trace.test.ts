import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLeash } from "../src/leash.js";
import { allow, deny } from "../src/policy/builder.js";
import { parseTrace, readTrace, summarizeTrace } from "../src/trace/reader.js";
import { renderTrace } from "../src/cli/render.js";

const ESC = String.fromCharCode(27);

describe("trace round-trip", () => {
  it("writes JSONL to disk and reads it back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "leash-"));
    const file = join(dir, "run.jsonl");
    try {
      const leash = createLeash({
        policy: { rules: [allow("fs.read"), deny("fs.write")] },
        trace: file,
      });
      await leash.guard({ tool: "fs.read", args: { path: "a" } }, () => "ok");
      await leash.guard({ tool: "fs.write", args: { path: "a" } }, () => "no");
      leash.end();

      const raw = readFileSync(file, "utf8");
      expect(raw.trim().split("\n")).toHaveLength(4); // start + 2 calls + end

      const events = readTrace(file);
      const summary = summarizeTrace(events);
      expect(summary.counts.allowed).toBe(1);
      expect(summary.counts.denied).toBe(1);
      expect(summary.hadBlocks).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parseTrace tolerates malformed lines", () => {
    const events = parseTrace('{"type":"call","v":1}\nnot json\n\n');
    expect(events).toHaveLength(1);
  });
});

describe("renderTrace", () => {
  it("renders a timeline with a summary and halt notice", async () => {
    const leash = createLeash({
      policy: { rules: [allow("*")], limits: { maxToolCalls: 1 } },
      trace: { retain: true },
    });
    await leash.guard({ tool: "a", args: {} }, () => 1);
    await leash.guard({ tool: "b", args: {} }, () => 2).catch(() => {});

    const out = renderTrace([...leash.events()], { color: false });
    expect(out).toMatch(/leash trace/);
    expect(out).toMatch(/summary/);
    expect(out).toMatch(/HALTED/);
    expect(out).toMatch(/1 allowed/);
  });

  it("omits ANSI codes when color is off", async () => {
    const leash = createLeash({ policy: { rules: [allow("*")] }, trace: { retain: true } });
    await leash.guard({ tool: "a", args: {} }, () => 1);
    leash.end();
    const out = renderTrace([...leash.events()], { color: false });
    expect(out.includes(ESC)).toBe(false);
  });

  it("includes ANSI codes when color is on", async () => {
    const leash = createLeash({ policy: { rules: [allow("*")] }, trace: { retain: true } });
    await leash.guard({ tool: "a", args: {} }, () => 1);
    leash.end();
    const out = renderTrace([...leash.events()], { color: true });
    expect(out.includes(ESC)).toBe(true);
  });
});
