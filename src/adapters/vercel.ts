/**
 * Adapter for the Vercel AI SDK tool format.
 *
 * In the AI SDK a tool is an object with a `description`, a parameter schema
 * (`parameters` on v3/4, `inputSchema` on v5) and an `execute(input, options)`
 * function. Tools are passed to `generateText`/`streamText` as a record keyed
 * by tool name. We wrap each tool's `execute` so the invocation is leashed,
 * preserving every other property and the original call signature.
 *
 * Typed loosely on purpose so Leash doesn't pin you to one AI SDK version.
 *
 * ```ts
 * import { generateText, tool } from "ai";
 * import { createLeash, wrapVercelTools, safeDefaults } from "@joekd20/leash";
 *
 * const leash = createLeash({ policy: safeDefaults(), trace: "./run.jsonl" });
 * const tools = wrapVercelTools(leash, {
 *   readFile: tool({ description: "...", parameters: schema, execute: readFile }),
 * });
 * await generateText({ model, tools, prompt });
 * ```
 */
import type { Leash } from "../leash.js";

/** Minimal structural type for a Vercel AI SDK tool. */
export interface VercelTool {
  description?: string;
  parameters?: unknown;
  inputSchema?: unknown;
  // `any` here so concretely-typed `execute` functions satisfy the structural
  // type — TypeScript's contravariant parameter check rejects `unknown`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute?: (input: any, options?: any) => any;
  [key: string]: unknown;
}

export type VercelToolSet = Record<string, VercelTool>;

/**
 * Wrap every executable tool in a Vercel AI SDK tool set. Tools without an
 * `execute` (client-/UI-side tools) are returned untouched.
 */
export function wrapVercelTools<T extends VercelToolSet>(leash: Leash, tools: T): T {
  const out: VercelToolSet = {};
  for (const [name, def] of Object.entries(tools)) {
    out[name] = wrapVercelTool(leash, name, def);
  }
  return out as T;
}

/** Wrap a single Vercel AI SDK tool, given the name it is registered under. */
export function wrapVercelTool(leash: Leash, name: string, def: VercelTool): VercelTool {
  const original = def.execute;
  if (typeof original !== "function") return def;

  const execute = (input: unknown, options?: unknown) =>
    leash.guard({ tool: name, args: asArgs(input) }, () => original(input, options));

  return { ...def, execute };
}

function asArgs(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : { value: input };
}
