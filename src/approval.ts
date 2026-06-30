/**
 * Human-in-the-loop approval. When a policy returns `ask`, the guard calls the
 * configured {@link ApprovalHandler}. Return `true`/an approve object to let
 * the call through, `false`/reject to block it. A missing handler means `ask`
 * is treated as `deny` (fail closed).
 */
import type { Decision, ToolCall } from "./policy/types.js";

export interface ApprovalRequest {
  call: ToolCall;
  decision: Decision;
  /** Sequence number of this call within the run. */
  seq: number;
}

export type ApprovalResult =
  | boolean
  | { approved: boolean; reason?: string };

/** Decide whether an `ask` call may proceed. May be async. */
export type ApprovalHandler = (
  request: ApprovalRequest,
) => ApprovalResult | Promise<ApprovalResult>;

/** Normalize the loose return type into `{ approved, reason }`. */
export function normalizeApproval(result: ApprovalResult): {
  approved: boolean;
  reason?: string;
} {
  if (typeof result === "boolean") return { approved: result };
  return { approved: result.approved, reason: result.reason };
}

/**
 * A handler that auto-approves everything. Useful in development to "see what
 * the agent would do" without a UI. **Do not use in production.**
 */
export const autoApprove: ApprovalHandler = () => true;

/** A handler that auto-rejects everything (fail closed). */
export const autoReject: ApprovalHandler = () => false;
