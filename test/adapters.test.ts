import { describe, expect, it } from "vitest";
import { createLeash, isBlocked } from "../src/leash.js";
import { allow, deny } from "../src/policy/builder.js";
import { wrapTools } from "../src/adapters/generic.js";
import { wrapVercelTools } from "../src/adapters/vercel.js";
import { wrapAnthropicTools } from "../src/adapters/anthropic.js";

describe("generic wrapTools", () => {
  it("leashes a record of tool functions", async () => {
    const leash = createLeash({
      policy: { rules: [allow("readFile"), deny("deleteFile")] },
    });
    const tools = wrapTools(leash, {
      readFile: async (a: { path: string }) => `contents of ${a.path}`,
      deleteFile: async (_a: { path: string }) => "deleted",
    });

    expect(await tools.readFile({ path: "a.ts" })).toBe("contents of a.ts");
    const blocked = await tools.deleteFile({ path: "a.ts" });
    expect(isBlocked(blocked)).toBe(true);
  });
});

describe("wrapVercelTools", () => {
  it("wraps execute and preserves other props", async () => {
    const leash = createLeash({ policy: { rules: [deny("search")] } });
    const tools = wrapVercelTools(leash, {
      search: {
        description: "search the web",
        parameters: { type: "object" },
        execute: async (input: unknown) => `results for ${JSON.stringify(input)}`,
      },
    });
    expect(tools.search.description).toBe("search the web");
    const out = await tools.search.execute!({ q: "hi" });
    expect(isBlocked(out)).toBe(true);
  });

  it("leaves client-side tools (no execute) untouched", () => {
    const leash = createLeash({ policy: { rules: [allow("*")] } });
    const def = { description: "ui tool", parameters: {} };
    const tools = wrapVercelTools(leash, { ui: def });
    expect(tools.ui).toEqual(def);
  });

  it("runs allowed tools", async () => {
    const leash = createLeash({ policy: { rules: [allow("*")] } });
    const tools = wrapVercelTools(leash, {
      add: { execute: async (i: { a: number; b: number }) => i.a + i.b },
    });
    expect(await tools.add.execute!({ a: 2, b: 3 })).toBe(5);
  });
});

describe("wrapAnthropicTools", () => {
  const tools = [
    {
      name: "fs.read",
      description: "read a file",
      input_schema: { type: "object" },
      handler: (input: Record<string, unknown>) => `read ${input.path}`,
    },
    {
      name: "fs.write",
      input_schema: { type: "object" },
      handler: () => "wrote",
    },
  ];

  it("exposes definitions without the handler", () => {
    const leash = createLeash({ policy: { rules: [allow("*")] } });
    const kit = wrapAnthropicTools(leash, tools);
    expect(kit.definitions).toHaveLength(2);
    expect(kit.definitions[0]).not.toHaveProperty("handler");
    expect(kit.definitions[0]!.name).toBe("fs.read");
  });

  it("dispatches allowed tool_use to a tool_result", async () => {
    const leash = createLeash({ policy: { rules: [allow("fs.read")], default: "deny" } });
    const kit = wrapAnthropicTools(leash, tools);
    const result = await kit.dispatch({
      type: "tool_use",
      id: "tu_1",
      name: "fs.read",
      input: { path: "a.ts" },
    });
    expect(result.tool_use_id).toBe("tu_1");
    expect(result.content).toBe("read a.ts");
    expect(result.is_error).toBeUndefined();
  });

  it("marks denied calls as error tool_results", async () => {
    const leash = createLeash({ policy: { rules: [allow("fs.read")], default: "deny" } });
    const kit = wrapAnthropicTools(leash, tools);
    const result = await kit.dispatch({
      type: "tool_use",
      id: "tu_2",
      name: "fs.write",
      input: {},
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/blocked by policy/);
  });

  it("handles unknown tools", async () => {
    const leash = createLeash({ policy: { rules: [allow("*")] } });
    const kit = wrapAnthropicTools(leash, tools);
    const result = await kit.dispatch({
      type: "tool_use",
      id: "tu_3",
      name: "nope",
      input: {},
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/Unknown tool/);
  });

  it("dispatchAll filters tool_use blocks from mixed content", async () => {
    const leash = createLeash({ policy: { rules: [allow("*")] } });
    const kit = wrapAnthropicTools(leash, tools);
    const results = await kit.dispatchAll([
      { type: "text", text: "let me read that" },
      { type: "tool_use", id: "a", name: "fs.read", input: { path: "x" } },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe("read x");
  });
});
