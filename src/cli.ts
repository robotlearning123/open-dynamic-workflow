#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { runWorkflowFile } from "./runner.js";
import { AnthropicBackend, MockBackend } from "./backend.js";
import { TreeReporter } from "./progress.js";
import type { ProgressReporter } from "./types.js";

const USAGE = "Usage: run-workflow <script.js> [--args <json>] [--resume <runId>] [--mock] [--budget <n>] [--json-dir <dir>]";

/** Thrown by parseArgs on bad input (instead of exiting, so it is testable). */
export class CliUsageError extends Error {}

export interface CliOptions {
  script: string;
  args: unknown;
  resumeRunId: string | undefined;
  mock: boolean;
  budget: number | null;
  jsonDir: string | undefined;
}

export function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  if (args.length === 0) throw new CliUsageError(USAGE);

  const script = args[0] as string;
  const out: CliOptions = { script, args: undefined, resumeRunId: undefined, mock: false, budget: null, jsonDir: undefined };

  for (let i = 1; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--mock") {
      out.mock = true;
    } else if (flag === "--args" && i + 1 < args.length) {
      const raw = args[++i] as string;
      try {
        out.args = JSON.parse(raw);
      } catch {
        throw new CliUsageError(`--args: invalid JSON: ${raw}`);
      }
    } else if (flag === "--resume" && i + 1 < args.length) {
      out.resumeRunId = args[++i];
    } else if (flag === "--budget" && i + 1 < args.length) {
      const n = Number(args[++i]);
      if (!Number.isFinite(n) || n <= 0) throw new CliUsageError(`--budget: expected a positive number, got: ${args[i]}`);
      out.budget = n;
    } else if (flag === "--json-dir" && i + 1 < args.length) {
      out.jsonDir = args[++i];
    } else {
      throw new CliUsageError(`Unknown or incomplete flag: ${flag}`);
    }
  }
  return out;
}

/** Core CLI logic. Returns an exit code (+ result) instead of exiting, so it is testable. */
export async function run(argv: string[], opts?: { reporter?: ProgressReporter }): Promise<{ code: number; runId?: string; result?: unknown }> {
  let parsed: CliOptions;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    process.stderr.write((e instanceof Error ? e.message : String(e)) + "\n");
    return { code: 1 };
  }

  const backend = !parsed.mock && process.env["ANTHROPIC_API_KEY"]?.trim() ? new AnthropicBackend() : new MockBackend();
  const reporter = opts?.reporter ?? new TreeReporter();

  try {
    const result = await runWorkflowFile(parsed.script, {
      args: parsed.args,
      backend,
      resumeFromRunId: parsed.resumeRunId,
      budget: parsed.budget,
      reporter,
      journalDir: parsed.jsonDir,
    });
    process.stdout.write(`runId: ${result.runId}\n` + JSON.stringify(result.result, null, 2) + "\n");
    return { code: 0, runId: result.runId, result: result.result };
  } catch (err) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    return { code: 1 };
  }
}

// Auto-run only when invoked directly as the CLI entry (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void run(process.argv).then((r) => {
    process.exitCode = r.code;
  });
}
