// crosscheck.mjs — C8 fidelity gate.
// Runs the SAME probe script (traces/experiment-01-probe.workflow.js) through the REPRODUCTION
// engine with MockBackend, then asserts the engine's journal.jsonl has the same SHAPE/SEMANTICS
// as the REAL working log (traces/experiment-01/run/journal.jsonl). Exit 0 iff all asserts pass.
//
// Run after `npm run build`:  node tools/crosscheck.mjs
import { runWorkflowFile, MockBackend } from "../dist/index.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROBE = join(ROOT, "traces/experiment-01-probe.workflow.js");
const REAL = join(ROOT, "traces/experiment-01/run/journal.jsonl");

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failures++; };
const readJsonl = (p) => readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

function journalShape(events) {
  const started = events.filter((e) => e.type === "started");
  const result = events.filter((e) => e.type === "result");
  const keysV2 = events.every((e) => typeof e.key === "string" && e.key.startsWith("v2:"));
  const paired = started.every((s) => result.some((r) => r.agentId === s.agentId && r.key === s.key));
  const objResults = result.filter((r) => r.result && typeof r.result === "object").length;
  const strResults = result.filter((r) => typeof r.result === "string").length;
  return { nStarted: started.length, nResult: result.length, keysV2, paired, objResults, strResults };
}

console.log("=== C8 fidelity cross-check: repro engine vs real working log ===\n");

// 1) Real working log shape
const real = readJsonl(REAL);
const realShape = journalShape(real);
console.log("real :", JSON.stringify(realShape));
ok(realShape.nStarted === 8 && realShape.nResult === 8, "real journal = 8 started + 8 result (sanity)");

// 2) Run the SAME script through the reproduction engine (MockBackend)
const run1 = await runWorkflowFile(PROBE, { backend: new MockBackend(), journalDir: join(ROOT, ".runs") });
const repro = readJsonl(join(ROOT, ".runs", run1.runId, "journal.jsonl"));
const reproShape = journalShape(repro);
console.log("repro:", JSON.stringify(reproShape));

ok(run1.agentCount === 8, `repro ran 8 agents (got ${run1.agentCount})`);
ok(reproShape.nStarted === realShape.nStarted, "same #started events as real");
ok(reproShape.nResult === realShape.nResult, "same #result events as real");
ok(reproShape.keysV2, "all repro keys are 'v2:<hash>' (matches real format)");
ok(reproShape.paired, "every started has a matching result (2-event model)");

// 3) Result-kind structure: fanout=object (schema), pipeline=string (text), synthesis=string
const r = run1.result;
ok(Array.isArray(r.fanout) && r.fanout.length === 3 && r.fanout.every((x) => x && typeof x === "object"), "fanout = 3 structured objects (parallel + schema, order preserved by index)");
ok(Array.isArray(r.pipeline) && r.pipeline.length === 2 && r.pipeline.every((x) => typeof x === "string"), "pipeline = 2 text strings (no-schema stage-2)");
ok(typeof r.synthesis === "string", "synthesis = text string");
ok(reproShape.objResults >= 5 && reproShape.strResults >= 3, "repro has object results (schema) AND string results (text), like real");

// 4) Resume behavior: re-run with resumeFromRunId; deterministic MockBackend => cache should serve.
const counting = new MockBackend();
const run2 = await runWorkflowFile(PROBE, { backend: counting, journalDir: join(ROOT, ".runs"), runId: run1.runId, resumeFromRunId: run1.runId });
console.log(`resume: backend.run called ${counting.calls.length} times (deterministic mock => expect 0; real run had latency-induced partial re-run)`);
ok(counting.calls.length === 0, `resume full cache hit: live backend calls = ${counting.calls.length} (expect exactly 0 for a deterministic re-run)`);
ok(JSON.stringify(run2.result.fanout) === JSON.stringify(run1.result.fanout), "resume fanout deep-equals first run (cache fidelity)");

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED ✓" : failures + " CHECK(S) FAILED ✗"}`);
process.exit(failures === 0 ? 0 : 1);
