/**
 * Adapter for the Anthropic Messages API tool-use pattern.
 *
 * In the Anthropic SDK a tool is *declared* with `{ name, description,
 * input_schema }` and you supply the implementation yourself: the model emits
 * `tool_use` blocks, you run the matching handler and feed back a `tool_result`.
 * Leash sits at that handler boundary.
 *
 * {@link wrapAnthropicTools} takes your tools (declaration + handler) and
 * returns a {@link LeashedToolkit} that gives you back the `definitions` to
 * pass to `messages.create`, plus a `dispatch()` that runs the right leashed
 * handler for a `tool_use` block and returns a ready-to-send `tool_result`.
 *
 * Types are kept loose so Leash doesn't pin a specific `@anthropic-ai/sdk`
 * version.
 */
import { isBlocked, type Leash } from "../leash.js";

/** A tool declaration plus its server-side handler. */
export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: unknown;
  handler: (input: Record<string, unknown>) => unknown;
}

/** The wire shape passed to `messages.create({ tools })`. */
export interface AnthropicToolDefinition {
  name: string;
  description?: string;
  input_schema: unknown;
}

/** A `tool_use` content block emitted by the model. */
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** A `tool_result` content block to send back to the model. */
export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface LeashedToolkit {
  /** Tool declarations to pass straight to `messages.create({ tools })`. */
  definitions: AnthropicToolDefinition[];
  /** Run the leashed handler for one `tool_use` block, returning a `tool_result`. */
  dispatch: (block: ToolUseBlock) => Promise<ToolResultBlock>;
  /** Dispatch every `tool_use` block in a model response's content array. */
  dispatchAll: (content: unknown[]) => Promise<ToolResultBlock[]>;
}

/**
 * Wrap a set of Anthropic tools so their handlers run behind the leash.
 */
export function wrapAnthropicTools(leash: Leash, tools: AnthropicTool[]): LeashedToolkit {
  const byName = new Map<string, AnthropicTool>();
  for (const t of tools) byName.set(t.name, t);

  const definitions: AnthropicToolDefinition[] = tools.map(
    ({ handler: _handler, ...def }) => def,
  );

  const dispatch = async (block: ToolUseBlock): Promise<ToolResultBlock> => {
    const tool = byName.get(block.name);
    if (!tool) {
      return {
        type: "tool_result",
        tool_use_id: block.id,
        content: `Unknown tool "${block.name}"`,
        is_error: true,
      };
    }

    const input = block.input ?? {};
    try {
      const result = await leash.guard({ tool: block.name, args: input }, () =>
        tool.handler(input),
      );
      // In `block` mode a denied call resolves to a structured block result;
      // surface it as an error tool_result so the model can adapt.
      if (isBlocked(result)) {
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: result.message,
          is_error: true,
        };
      }
      return {
        type: "tool_result",
        tool_use_id: block.id,
        content: stringifyResult(result),
      };
    } catch (err) {
      // `throw` mode, hard-stops, or a throwing tool all land here.
      return {
        type: "tool_result",
        tool_use_id: block.id,
        content: err instanceof Error ? err.message : String(err),
        is_error: true,
      };
    }
  };

  const dispatchAll = async (content: unknown[]): Promise<ToolResultBlock[]> => {
    const blocks = (content ?? []).filter(isToolUseBlock);
    const results: ToolResultBlock[] = [];
    for (const block of blocks) {
      results.push(await dispatch(block));
      // Once a hard-stop fires, stop dispatching the rest of this turn rather
      // than emitting an identical limit error for every remaining block.
      if (leash.isHalted) break;
    }
    return results;
  };

  return { definitions, dispatch, dispatchAll };
}

function isToolUseBlock(value: unknown): value is ToolUseBlock {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "tool_use" &&
    typeof (value as ToolUseBlock).name === "string"
  );
}

function stringifyResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}
