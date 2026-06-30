import { describe, expect, it } from "vitest";
import { normalizePath, matchPath, matchHost } from "../src/policy/matchers.js";
import { evaluate } from "../src/policy/engine.js";
import { safeDefaults, isDestructiveShellCommand } from "../src/policy/defaults.js";
import { createLeash, isBlocked } from "../src/leash.js";
import { allow } from "../src/policy/builder.js";
import type { TraceEvent } from "../src/trace/types.js";

describe("path traversal / normalization (deny-evasion fix)", () => {
  it("resolves . and .. segments lexically", () => {
    expect(normalizePath("src/../secrets/key")).toBe("secrets/key");
    expect(normalizePath("./src/index.ts")).toBe("src/index.ts");
    expect(normalizePath("//etc//passwd")).toBe("/etc/passwd");
    expect(normalizePath("a/b/../../c")).toBe("c");
    expect(normalizePath("src/../../etc")).toBe("../etc");
    expect(normalizePath("foo\\bar")).toBe("foo/bar");
  });

  it("a deny glob can't be evaded by a .. detour", () => {
    // 'src/../secrets/key' normalizes to 'secrets/key' and so DOES match.
    expect(matchPath("src/../secrets/key", "secrets/**")).toBe(true);
    expect(matchPath("foo/../.ssh/id_rsa", "**/.ssh/**")).toBe(true);
  });

  it("a leading // can't dodge an absolute glob", () => {
    expect(matchPath("//etc/passwd", "/etc/**")).toBe(true);
  });
});

describe("safeDefaults read scoping (absolute/escape fix)", () => {
  const policy = safeDefaults();

  it("allows reads inside the project tree", () => {
    expect(evaluate(policy, { tool: "fs.read", args: { path: "src/a.ts" } }).effect).toBe(
      "allow",
    );
  });

  it("denies absolute-path reads", () => {
    expect(evaluate(policy, { tool: "fs.read", args: { path: "/etc/passwd" } }).effect).toBe(
      "deny",
    );
    expect(
      evaluate(policy, { tool: "fs.read", args: { path: "/home/user/.aws/credentials" } })
        .effect,
    ).toBe("deny");
  });

  it("denies parent-traversal and home reads", () => {
    expect(
      evaluate(policy, { tool: "fs.read", args: { path: "src/../../etc/passwd" } }).effect,
    ).toBe("deny");
    expect(evaluate(policy, { tool: "fs.read", args: { path: "~/.ssh/id_rsa" } }).effect).toBe(
      "deny",
    );
  });
});

describe("destructive shell detection (flag-form fix)", () => {
  const dangerous = (command: string) => isDestructiveShellCommand({ command });

  it("catches recursive+force rm in any flag form", () => {
    expect(dangerous("rm -rf /")).toBe(true);
    expect(dangerous("rm -fr /tmp/x")).toBe(true);
    expect(dangerous("rm -r -f /")).toBe(true);
    expect(dangerous("rm --recursive --force /")).toBe(true);
    expect(dangerous("rm -r --force /var")).toBe(true);
    expect(dangerous("/bin/rm -rf /")).toBe(true);
  });

  it("catches find -delete, mkfs, fork bombs", () => {
    expect(dangerous("find . -name '*.ts' -delete")).toBe(true);
    expect(dangerous("mkfs.ext4 /dev/sda1")).toBe(true);
    expect(dangerous(":(){ :|:& };:")).toBe(true);
  });

  it("does not flag a benign rm of one file or a non-forced rm", () => {
    expect(dangerous("rm ./build.log")).toBe(false);
    expect(dangerous("rm -i note.txt")).toBe(false);
    expect(dangerous("echo rm is fine in a string")).toBe(false);
  });

  it("safeDefaults blocks dangerous bash (and denies all bash by default)", () => {
    const policy = safeDefaults();
    expect(evaluate(policy, { tool: "bash", args: { command: "rm -r -f /" } }).effect).toBe(
      "deny",
    );
  });
});

describe("host matching hardening", () => {
  it("strips a trailing FQDN dot so it can't evade an exact host policy", () => {
    expect(matchHost("api.github.com.", "api.github.com")).toBe(true);
    expect(matchHost("api.github.com", "*.github.com")).toBe(true);
    expect(matchHost("evil.com", "*.github.com")).toBe(false);
  });
});

describe("trace result redaction (leak fix)", () => {
  it("redacts sensitive keys in structured tool results", async () => {
    const events: TraceEvent[] = [];
    const leash = createLeash({
      policy: { rules: [allow("*")] },
      trace: { sink: (e) => events.push(e) },
    });
    await leash.guard({ tool: "creds.get", args: {} }, () => ({
      user: "joe",
      apiKey: "sk-secret-value",
    }));
    const call = events.find((e) => e.type === "call");
    if (call?.type === "call") {
      expect(call.resultPreview).toContain("joe");
      expect(call.resultPreview).toContain("[redacted]");
      expect(call.resultPreview).not.toContain("sk-secret-value");
    }
  });

  it("captureResults:false omits the result preview entirely", async () => {
    const events: TraceEvent[] = [];
    const leash = createLeash({
      policy: { rules: [allow("*")] },
      trace: { sink: (e) => events.push(e), captureResults: false },
    });
    await leash.guard({ tool: "fs.read", args: { path: "x" } }, () => "TOP SECRET CONTENTS");
    const call = events.find((e) => e.type === "call");
    if (call?.type === "call") {
      expect(call.resultPreview).toBeUndefined();
    }
  });
});

describe("loop detection counts only executed calls", () => {
  it("a stream of policy-denied calls never trips the hard-stop", async () => {
    const leash = createLeash({
      policy: { rules: [], default: "deny", limits: { maxRepeatedCalls: 2 } },
    });
    // Ten identical denied calls — none execute, so the run must NOT halt.
    for (let i = 0; i < 10; i++) {
      const out = await leash.guard({ tool: "blocked", args: { x: 1 } }, () => "ran");
      expect(isBlocked(out)).toBe(true);
    }
    expect(leash.isHalted).toBe(false);
  });

  it("a loop of executed (allowed) calls does trip the hard-stop", async () => {
    const leash = createLeash({
      policy: { rules: [allow("*")], limits: { maxRepeatedCalls: 2 } },
    });
    await leash.guard({ tool: "x", args: { q: 1 } }, () => 1); // 1
    await leash.guard({ tool: "x", args: { q: 1 } }, () => 1); // 2
    await expect(
      leash.guard({ tool: "x", args: { q: 1 } }, () => 1), // 3 > 2 → halt
    ).rejects.toThrow(/Loop detected/);
    expect(leash.isHalted).toBe(true);
  });
});

describe("trace seq is a single sequence across mixed outcomes", () => {
  it("call events are numbered 1..n regardless of allow/deny", async () => {
    const events: TraceEvent[] = [];
    const leash = createLeash({
      policy: { rules: [allow("ok")], default: "deny" },
      trace: { sink: (e) => events.push(e) },
    });
    await leash.guard({ tool: "ok", args: {} }, () => 1);
    await leash.guard({ tool: "nope", args: {} }, () => 2);
    await leash.guard({ tool: "ok", args: {} }, () => 3);
    const seqs = events.filter((e) => e.type === "call").map((e) => (e as { seq: number }).seq);
    expect(seqs).toEqual([1, 2, 3]);
  });
});
