/**
 * Leash — a runtime safety layer for AI agents.
 *
 * Wrap an agent's tool calls with allow/deny policies, resource limits, full
 * execution traces, and hard-stops, so an autonomous agent can't `rm -rf`,
 * exfiltrate, or burn your budget.
 *
 * @packageDocumentation
 */

// ── Core ────────────────────────────────────────────────────────────────────
export {
  Leash,
  createLeash,
  isBlocked,
  summarizePolicy,
  type LeashOptions,
  type TraceOptions,
  type ViolationMode,
  type BlockedResult,
} from "./leash.js";

// ── Policy ──────────────────────────────────────────────────────────────────
export { evaluate, ruleMatches } from "./policy/engine.js";
export { allow, deny, ask, definePolicy } from "./policy/builder.js";
export {
  safeDefaults,
  denyNetworkPolicy,
  readOnlyFsPolicy,
  isDestructiveShellCommand,
} from "./policy/defaults.js";
export {
  matchName,
  matchPath,
  matchHost,
  matchArg,
  extractHost,
  normalizePath,
} from "./policy/matchers.js";
export type {
  Policy,
  Rule,
  Effect,
  Decision,
  ToolCall,
  NameMatcher,
  ArgMatcher,
  ResourceLimits,
} from "./policy/types.js";

// ── Enforcement ─────────────────────────────────────────────────────────────
export { LimitTracker, type UsageStats } from "./enforcement/limits.js";

// ── Approval ────────────────────────────────────────────────────────────────
export {
  autoApprove,
  autoReject,
  normalizeApproval,
  type ApprovalHandler,
  type ApprovalRequest,
  type ApprovalResult,
} from "./approval.js";

// ── Errors ──────────────────────────────────────────────────────────────────
export {
  LeashError,
  PolicyViolationError,
  ApprovalRejectedError,
  LimitExceededError,
  isLeashError,
  type LeashErrorCode,
} from "./errors.js";

// ── Adapters ────────────────────────────────────────────────────────────────
export { wrapTools, wrapToolFn, toArgsRecord, type ToolFn } from "./adapters/generic.js";
export {
  wrapVercelTools,
  wrapVercelTool,
  type VercelTool,
  type VercelToolSet,
} from "./adapters/vercel.js";
export {
  wrapAnthropicTools,
  type AnthropicTool,
  type AnthropicToolDefinition,
  type LeashedToolkit,
  type ToolUseBlock,
  type ToolResultBlock,
} from "./adapters/anthropic.js";

// ── Trace ───────────────────────────────────────────────────────────────────
export { Tracer, type TracerOptions } from "./trace/tracer.js";
export {
  readTrace,
  parseTrace,
  summarizeTrace,
  type TraceSummary,
} from "./trace/reader.js";
export {
  sanitize,
  sanitizeArgs,
  preview,
  DEFAULT_REDACT,
  type RedactOptions,
  type RedactPredicate,
} from "./trace/redact.js";
export type {
  TraceEvent,
  TraceEventType,
  CallEvent,
  CallOutcome,
  RunStartEvent,
  RunEndEvent,
} from "./trace/types.js";
