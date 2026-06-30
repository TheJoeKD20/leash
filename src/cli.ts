#!/usr/bin/env node
/**
 * The `leash` CLI. v0.1 ships one job: render an execution trace.
 *
 *   leash view <trace.jsonl>     pretty-print a run as a timeline
 *   leash view --json <file>     re-emit the summary as JSON
 *   leash --help                 usage
 */
import { readFileSync } from "node:fs";
import { parseTrace, summarizeTrace } from "./trace/reader.js";
import { renderTrace } from "./cli/render.js";
import { colors } from "./cli/colors.js";

const VERSION = "0.1.0";

function main(argv: string[]): number {
  const args = argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return args.length === 0 ? 1 : 0;
  }
  if (args[0] === "--version" || args[0] === "-v") {
    process.stdout.write(`leash ${VERSION}\n`);
    return 0;
  }

  const command = args[0];
  if (command === "view") {
    return cmdView(args.slice(1));
  }

  process.stderr.write(colors.red(`Unknown command: ${command}\n\n`));
  printHelp();
  return 1;
}

function cmdView(args: string[]): number {
  let asJson = false;
  let color: boolean | undefined;
  let file: string | undefined;

  for (const arg of args) {
    if (arg === "--json") asJson = true;
    else if (arg === "--color") color = true;
    else if (arg === "--no-color") color = false;
    else if (arg.startsWith("-")) {
      process.stderr.write(colors.red(`Unknown option: ${arg}\n`));
      return 1;
    } else {
      file = arg;
    }
  }

  if (!file) {
    process.stderr.write(colors.red("Usage: leash view <trace.jsonl>\n"));
    return 1;
  }

  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (e) {
    process.stderr.write(
      colors.red(`Could not read trace "${file}": ${(e as Error).message}\n`),
    );
    return 1;
  }

  const events = parseTrace(raw);

  if (asJson) {
    process.stdout.write(JSON.stringify(summarizeTrace(events), null, 2) + "\n");
    return 0;
  }

  const useColor = color ?? colors.enabled;
  process.stdout.write(renderTrace(events, { color: useColor }) + "\n");

  // Non-zero exit if the run was blocked or halted — handy in CI gates.
  const summary = summarizeTrace(events);
  return summary.hadBlocks ? 2 : 0;
}

function printHelp(): void {
  const b = colors.bold;
  process.stdout.write(
    `${b("leash")} — runtime safety layer for AI agents (v${VERSION})

${b("Usage")}
  leash view <trace.jsonl>      Pretty-print an execution trace as a timeline
  leash view --json <file>      Emit the trace summary as JSON
  leash --help                  Show this help
  leash --version               Show version

${b("Options for `view`")}
  --json        Output a machine-readable summary instead of the timeline
  --color       Force ANSI colours on
  --no-color    Force ANSI colours off (also honours NO_COLOR)

${b("Exit codes")}
  0   trace rendered, no blocked calls
  1   usage / read error
  2   trace contained denied, rejected, or limited calls
`,
  );
}

process.exit(main(process.argv));
