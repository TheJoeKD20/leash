/**
 * Typed errors. Every block raised by Leash is an instance of
 * {@link LeashError}, so callers can `catch` one type and branch on `.code`.
 * Adapters that run in "block" mode convert these into a structured tool
 * result the agent can read instead of throwing.
 */
import type { Decision, ToolCall } from "./policy/types.js";

export type LeashErrorCode =
  | "POLICY_VIOLATION"
  | "APPROVAL_REJECTED"
  | "LIMIT_EXCEEDED";

/** Base class for everything Leash throws. */
export abstract class LeashError extends Error {
  /** Stable, machine-readable discriminant. */
  abstract readonly code: LeashErrorCode;
  /** The offending call, when applicable. */
  readonly call?: ToolCall;

  constructor(message: string, call?: ToolCall) {
    super(message);
    this.name = new.target.name;
    this.call = call;
    // Restore prototype chain for instanceof across transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** A serializable shape suitable for returning to an agent as a tool result. */
  toResult(): { error: true; code: LeashErrorCode; message: string } {
    return { error: true, code: this.code, message: this.message };
  }
}

/** A tool call was blocked by a `deny` policy decision. */
export class PolicyViolationError extends LeashError {
  readonly code = "POLICY_VIOLATION" as const;
  readonly decision: Decision;

  constructor(call: ToolCall, decision: Decision) {
    super(`Tool "${call.tool}" blocked by policy: ${decision.reason}`, call);
    this.decision = decision;
  }
}

/** A human approval gate rejected (or timed out on) an `ask` decision. */
export class ApprovalRejectedError extends LeashError {
  readonly code = "APPROVAL_REJECTED" as const;
  readonly decision: Decision;

  constructor(call: ToolCall, decision: Decision, detail?: string) {
    super(
      `Tool "${call.tool}" denied by human approval${detail ? `: ${detail}` : ""}`,
      call,
    );
    this.decision = decision;
  }
}

/** A per-run resource limit was hit (count, tokens, wall-clock, loop). */
export class LimitExceededError extends LeashError {
  readonly code = "LIMIT_EXCEEDED" as const;
  /** Which limit tripped, e.g. `"maxToolCalls"`. */
  readonly limit: string;
  readonly observed: number;
  readonly cap: number;

  constructor(
    limit: string,
    observed: number,
    cap: number,
    message: string,
    call?: ToolCall,
  ) {
    super(message, call);
    this.limit = limit;
    this.observed = observed;
    this.cap = cap;
  }
}

/** Type guard. */
export function isLeashError(e: unknown): e is LeashError {
  return e instanceof LeashError;
}
