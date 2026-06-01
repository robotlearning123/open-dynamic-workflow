// author.ts — the AUTHOR layer.
//
// Official Claude Code dynamic workflows are: "Claude writes the script for the task you describe,
// and a runtime executes it." That bundles the AUTHOR (Claude) to the runtime. This module unbundles
// it: ANY agent (Claude, Codex, OpenCode, a free local worker, a cloud HTTP agent) can be the author.
// `authorWorkflow` asks an `authorBackend` to write a workflow script for a natural-language task,
// then runs it through the same open engine on any `runBackend`. Follow official, not bound to Claude.

import { runWorkflow, parseMeta } from "./runner.js";
import type { AgentBackend, RunConfig, RunResult } from "./types.js";

/** The instruction given to the author agent. Teaches the injected globals + sandbox rules (SPEC.md)
 *  so any reasonably capable coding agent can emit a runnable workflow script. */
export function buildAuthorPrompt(task: string): string {
  return [
    "You are a workflow AUTHOR. Write ONE self-contained JavaScript \"dynamic workflow\" script that",
    "orchestrates subagents to accomplish the TASK. Output ONLY the script — no prose, no explanation.",
    "",
    "TASK:",
    task,
    "",
    "These GLOBALS are already injected into the script (do NOT import or redefine them):",
    "- agent(prompt, opts?) -> Promise<result>   // one subagent. opts: {label, phase, schema, model}.",
    "                                             // with a JSON-Schema `schema`, returns the validated object; else text.",
    "- parallel(thunks) -> Promise<results[]>     // run `() => agent(...)` thunks concurrently; order preserved;",
    "                                             // an async rejection -> null, but a SYNCHRONOUS throw propagates.",
    "- pipeline(items, ...stages) -> Promise<[]>  // each item through all stages; stage = (prev, item, index) => ...;",
    "                                             // no inter-stage barrier.",
    "- phase(title)   log(message)                // progress grouping + narrator lines.",
    "- budget {total, spent(), remaining()}       // output-token meter.",
    "- workflow(ref, args?) -> Promise<result>    // run a nested workflow (one level only).",
    "- args                                       // the value passed in as run args.",
    "",
    "HARD RULES:",
    "1. START with a pure literal: export const meta = { name: '<kebab-name>', description: '<one line>' }",
    "2. Use top-level `await`; END with a top-level `return <result>;`  (NOT module.exports / export default).",
    "3. The sandbox BLOCKS Date.now(), argless `new Date()`, Math.random(), require, process, fetch —",
    "   they throw (they would break resume). `new Date(arg)` is fine.",
    "4. Available built-ins: JSON, Math (except random), Array, Object, String, Number, Boolean, Promise, Map, Set, console.",
    "5. Prefer parallel()/pipeline() for fan-out. Plain JavaScript only (no TypeScript types).",
    "",
    "Output the script now, starting with `export const meta`.",
  ].join("\n");
}

/** Pull the raw script out of an author's reply: prefer a fenced code block, else drop any leading
 *  prose before `export const meta`. */
export function extractScript(raw: string): string {
  const text = String(raw ?? "").trim();
  // Gather ALL fenced code blocks and prefer the one that defines `export const meta` (LLMs often
  // emit prose plus one or more fences; a lazy single-match could grab the wrong block). Fall back
  // to the first fence, else the whole reply.
  const fences: string[] = [];
  const re = /```(?:js|javascript|ts|typescript|mjs)?\s*\n?([\s\S]*?)```/gi;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (typeof m[1] === "string") fences.push(m[1]);
  }
  let body = fences.find((f) => f.includes("export const meta")) ?? fences[0] ?? text;
  const metaIdx = body.indexOf("export const meta");
  if (metaIdx > 0) body = body.slice(metaIdx);
  return body.trim();
}

export interface AuthorOptions extends Omit<RunConfig, "backend"> {
  /** The agent that WRITES the workflow script (any backend — Claude, Codex, ccz, HTTP, ...). */
  authorBackend: AgentBackend;
  /** The agent fleet that EXECUTES the workflow. Defaults to `authorBackend`. */
  runBackend?: AgentBackend;
  /** Author the script but do NOT run it (returns `{ script }` only). */
  dryRun?: boolean;
  /** Model alias/id for the authoring call. */
  authorModel?: string;
}

export interface AuthorResult {
  /** The workflow script the author agent produced. */
  script: string;
  /** The execution result (undefined when `dryRun`). */
  run?: RunResult;
  /** Output tokens the author agent spent writing the script (metered against the run budget). */
  authorTokens: number;
}

/**
 * Have ANY agent author a dynamic-workflow script for `task`, then execute it on the open engine.
 * This is the vendor-neutral analogue of the official "Claude writes the script" step.
 */
export async function authorWorkflow(task: string, opts: AuthorOptions): Promise<AuthorResult> {
  if (typeof task !== "string" || task.trim().length === 0) {
    throw new Error("authorWorkflow: `task` must be a non-empty string");
  }
  const { authorBackend, runBackend, dryRun, authorModel, ...runCfg } = opts;

  const resp = await authorBackend.run({
    prompt: buildAuthorPrompt(task),
    model: authorModel,
    agentType: "workflow-author",
    agentId: "author-0",
  });

  const authorTokens = typeof resp.outputTokens === "number" ? resp.outputTokens : 0;
  const raw = typeof resp.output === "string" ? resp.output : JSON.stringify(resp.output);
  const script = extractScript(raw);

  // Fail loudly if the author returned prose / garbage instead of a workflow.
  try {
    parseMeta(script);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    throw new Error(
      `authorWorkflow: the author agent did not produce a valid workflow script (it must start with \`export const meta = {...}\`). ${why}\n--- author output (first 400 chars) ---\n${script.slice(0, 400)}`,
    );
  }

  if (dryRun) return { script, authorTokens };

  // Meter the author call against the run budget — the official engine counts every token, so the
  // author call must not be invisible. Subtract it from the run ceiling and surface it in the result.
  const runBudget = runCfg.budget == null ? runCfg.budget : Math.max(0, runCfg.budget - authorTokens);
  const run = await runWorkflow(script, { ...runCfg, budget: runBudget, backend: runBackend ?? authorBackend });
  return { script, run, authorTokens };
}
