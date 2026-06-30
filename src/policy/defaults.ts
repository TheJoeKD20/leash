/**
 * Zero-config safe-default policies. These exist so that `createLeash()` with
 * no policy still does something sensible and *restrictive*: deny all network,
 * allow read-only filesystem access within the project, hold everything else
 * for a human.
 *
 * Tool naming follows a `category.verb` convention (`fs.read`, `fs.write`,
 * `http.fetch`, `net.connect`, `bash`). Adapt the names to your own tools by
 * composing your own policy — these are starting points, not a contract.
 */
import { allow, deny } from "./builder.js";
import type { Policy } from "./types.js";

/** Glob fragments that look like filesystem-mutating tools. */
const FS_WRITE_TOOLS = ["fs.write", "fs.append", "fs.delete", "fs.rm", "fs.move", "fs.mkdir"];

/** Glob fragments that look like network egress tools. */
const NETWORK_TOOLS = ["http.*", "https.*", "net.*", "fetch", "request"];

/**
 * Deny every outbound network call. Pairs well with an explicit allowlist of
 * hosts layered *above* it.
 */
export function denyNetworkPolicy(): Policy {
  return {
    name: "deny-network",
    rules: [
      deny(NETWORK_TOOLS, { reason: "network egress denied by default policy" }),
    ],
    default: "allow",
  };
}

/**
 * Read-only filesystem: allow reads, deny writes/deletes/moves. Does not speak
 * to network policy on its own.
 */
export function readOnlyFsPolicy(): Policy {
  return {
    name: "read-only-fs",
    rules: [
      deny(FS_WRITE_TOOLS, { reason: "filesystem is read-only under this policy" }),
      allow(["fs.read", "fs.list", "fs.stat", "fs.glob"]),
    ],
    default: "allow",
  };
}

/**
 * The recommended zero-config starter: read-only filesystem scoped to the
 * project tree, no network, a conservative tool-call budget, and loop
 * detection. Everything not explicitly allowed falls through to `deny`.
 *
 * @param projectRoot Glob root for permitted reads. Defaults to the CWD tree.
 */
export function safeDefaults(projectRoot = "**"): Policy {
  return {
    name: "safe-defaults",
    rules: [
      // Network egress is denied outright.
      deny(NETWORK_TOOLS, { reason: "network egress denied by safe defaults" }),
      // Destructive shell is denied outright.
      deny("bash", {
        when: (c) => containsDangerousShell(c.args),
        reason: "destructive shell command blocked by safe defaults",
      }),
      // Filesystem writes are denied.
      deny(FS_WRITE_TOOLS, { reason: "read-only filesystem under safe defaults" }),
      // Reads are allowed, but only inside the project tree.
      allow(["fs.read", "fs.list", "fs.stat", "fs.glob"], {
        path: projectRoot === "**" ? "**" : [projectRoot, `${stripTrailingGlob(projectRoot)}/**`],
        reason: "read within project tree",
      }),
    ],
    // Anything unmatched is denied — deny by default.
    default: "deny",
    limits: {
      maxToolCalls: 100,
      maxRepeatedCalls: 5,
      wallClockMs: 5 * 60_000,
    },
  };
}

function stripTrailingGlob(p: string): string {
  return p.replace(/\/?\*+$/, "").replace(/\/$/, "");
}

/** Heuristic detector for obviously destructive shell one-liners. */
const DANGEROUS_SHELL = [
  /\brm\s+-[a-z]*r[a-z]*f/i, // rm -rf and friends
  /\brm\s+-[a-z]*f[a-z]*r/i, // rm -fr
  /\bmkfs\b/i,
  /\b:\(\)\s*\{\s*:\s*\|\s*:/, // fork bomb :(){ :|:& };:
  /\bdd\s+if=.*of=\/dev\//i,
  /\bchmod\s+-R\s+0?00\b/i,
  />\s*\/dev\/sd[a-z]/i,
];

function containsDangerousShell(args: Record<string, unknown>): boolean {
  const cmd =
    typeof args.command === "string"
      ? args.command
      : typeof args.cmd === "string"
        ? args.cmd
        : typeof args.script === "string"
          ? args.script
          : "";
  return DANGEROUS_SHELL.some((re) => re.test(cmd));
}
