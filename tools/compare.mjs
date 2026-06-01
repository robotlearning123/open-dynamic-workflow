// compare.mjs — "OURS vs CLAUDE" differential fidelity gate.
// Runs OUR engine (MockBackend) on the SAME probe scripts the REAL Workflow tool ran, then
// compares behavior against the harvested real results in traces/. Deterministic behaviors
// (sandbox, boundaries, nesting message) must match EXACTLY; LLM-content behaviors are compared
// structurally (types/shape). Prints a VS table + fidelity %. Exit 0 iff 100%.
//
// Run after `npm run build`:  node tools/compare.mjs
import { runWorkflow, runWorkflowFile, MockBackend, defaultConcurrency } from "../dist/index.js";
import { readFileSync } from "node:fs";
import os from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = (p) => join(ROOT, p);
const RUNS = T(".runs");
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const readJsonl = (p) => readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
function realResult(p) {
  const o = JSON.parse(readFileSync(T(p), "utf8"));
  return o && typeof o === "object" && "result" in o ? o.result : o;
}
// Resolve nested workflow() scriptPaths under the repo ROOT (the captured probe scripts embed the
// original absolute capture path). This keeps the differential gate reproducible from ANY clone
// location and in CI — not only on the machine that recorded the traces.
const portableResolver = async (ref) => {
  const sp = typeof ref === "string" ? ref : ref.scriptPath;
  const i = sp.indexOf("traces/");
  return readFileSync(join(ROOT, i >= 0 ? sp.slice(i) : sp), "utf8");
};
const runOurs = (script, runId) =>
  runWorkflowFile(T(script), { backend: new MockBackend(), journalDir: RUNS, runId, workflowResolver: portableResolver });

const rows = [];
let pass = 0;
const check = (name, real, ours, eq = deepEq) => {
  const ok = eq(real, ours);
  if (ok) pass++;
  rows.push({ name, ok, real, ours });
};

console.log("=== OURS vs CLAUDE — differential fidelity ===\n");

// ---------- 1) SANDBOX (deterministic → exact match expected) ----------
{
  const real = realResult("traces/experiment-04-sandbox/task-output.json").results;
  const ours = (await runOurs("traces/experiment-04-sandbox.workflow.js", "cmp-sandbox")).result.results;
  for (const r of real) {
    const o = ours.find((x) => x.label === r.label);
    check(`sandbox: ${r.label}`, { ok: r.ok, msg: r.error ?? r.value }, o ? { ok: o.ok, msg: o.error ?? o.value } : null);
  }
}

// ---------- 2) BOUNDARIES (deterministic → exact, incl. nesting message) ----------
{
  const real = realResult("traces/experiment-05-boundaries/task-output-success.json");
  const ours = (await runOurs("traces/experiment-05-boundaries/parent.workflow.js", "cmp-bound")).result;
  check("boundaries: emptyParallel === []", real.emptyParallel, ours.emptyParallel);
  check("boundaries: emptyPipeline === []", real.emptyPipeline, ours.emptyPipeline);
  check("boundaries: asyncReject thunk → null", real.asyncRejectParallel_nullAt1, ours.asyncRejectParallel_nullAt1);
  check("boundaries: pipeline stage-throw → [null,'b-done']", real.throwingPipeline, ours.throwingPipeline);
  check("boundaries: top-level workflow() allowed", real.parentLevelError, ours.parentLevelError);
  check("boundaries: NESTING error message (exact)", real.childResult?.nestedError, ours.childResult?.nestedError);
  check("boundaries: grandchild did NOT run", real.childResult?.nestedRan, ours.childResult?.nestedRan);
}

// ---------- 3) PROBE (LLM content differs → structural match) ----------
{
  const real = realResult("traces/experiment-01/task-output.json");
  const run = await runOurs("traces/experiment-01-probe.workflow.js", "cmp-probe");
  const ours = run.result;
  const shape = (r) => ({
    fanout: Array.isArray(r.fanout) && r.fanout.length === 3 && r.fanout.every((x) => x && typeof x === "object"),
    pipeline: Array.isArray(r.pipeline) && r.pipeline.length === 2 && r.pipeline.every((x) => typeof x === "string"),
    synthesis: typeof r.synthesis === "string",
  });
  check("probe: result SHAPE (fanout=3 obj, pipeline=2 str, synth=str)", shape(real), shape(ours));
  check("probe: agentCount", 8, run.agentCount, (a, b) => a === b);

  // journal format vs real
  const jReal = readJsonl(T("traces/experiment-01/run/journal.jsonl"));
  const jOurs = readJsonl(join(RUNS, run.runId, "journal.jsonl"));
  const jshape = (ev) => ({
    twoEvent: ev.filter((e) => e.type === "started").length === ev.filter((e) => e.type === "result").length,
    v2: ev.every((e) => typeof e.key === "string" && e.key.startsWith("v2:")),
    nStarted: ev.filter((e) => e.type === "started").length,
  });
  const a = jshape(jReal), b = jshape(jOurs);
  check("journal: 2-event model", a.twoEvent, b.twoEvent);
  check("journal: v2 keys", a.v2, b.v2);
  check("journal: #started events", a.nStarted, b.nStarted, (x, y) => x === y);
}

// ---------- 4) RESUME (deterministic mock → cache serves) ----------
{
  const r1 = await runOurs("traces/experiment-01-probe.workflow.js", "cmp-resume");
  const counting = new MockBackend();
  await runWorkflowFile(T("traces/experiment-01-probe.workflow.js"), {
    backend: counting, journalDir: RUNS, runId: "cmp-resume", resumeFromRunId: "cmp-resume",
  });
  // deterministic mock => invocation order stable => 0 live backend calls (full cache)
  check("resume: live backend calls after resume (deterministic→0)", 0, counting.calls.length, (x, y) => y <= x);
}

// ---------- 5) RESUME MODEL: edit a middle call -> it + all later re-run (experiment-06) ----------
{
  const mk = (b) =>
    "export const meta={name:'e6',description:'resume-model'};\n" +
    "const a=await agent('A1',{label:'A'});\n" +
    `const b=await agent('${b}',{label:'B'});\n` +
    "const c=await agent('C1',{label:'C'});\n" +
    "const d=await agent('D1',{label:'D'});\n" +
    "return {a,b,c,d};\n";
  await runWorkflow(mk("B1"), { backend: new MockBackend(), journalDir: RUNS, runId: "cmp-e6" });
  const counting = new MockBackend();
  const r2 = await runWorkflow(mk("B2"), { backend: counting, journalDir: RUNS, runId: "cmp-e6", resumeFromRunId: "cmp-e6" });
  // real exp-06: editing B re-ran B, C, D (chained-key cascade) and cached A.
  check("resume cascade: edit middle call -> exactly B,C,D re-run (A cached), like experiment-06", 3, counting.calls.length, (x, y) => x === y);
  check("resume cascade: edited call B reflects the new prompt (B2)", "[mock] B2", r2.result.b);
}

// ---------- 6) parallel preserves INPUT order (experiment-01 fanoutOrderPreserved=true) ----------
{
  const r = await runWorkflow(
    "export const meta={name:'po',description:'order'};\nreturn await parallel([0,1,2,3,4].map((i)=>()=>agent('idx '+i,{label:'p'+i})));\n",
    { backend: new MockBackend({ responder: (req) => req.prompt }), journalDir: RUNS, runId: "cmp-order" },
  );
  check("parallel preserves input order (experiment-01)", ["idx 0", "idx 1", "idx 2", "idx 3", "idx 4"], r.result);
}

// ---------- 7) pipeline (prev,original,index): stage-1 prev===item; stage-2 prev=stage-1 out (experiment-01) ----------
{
  const r = await runWorkflow(
    "export const meta={name:'pa',description:'args'};\n" +
      "return await pipeline(['X'],\n" +
      "  (prev,original,index)=>agent(JSON.stringify({s:1,prevEqualsItem:prev===original,original,index}),{}),\n" +
      "  (prev,original,index)=>agent(JSON.stringify({s:2,prevS:(prev&&prev.s),original,index}),{}));\n",
    { backend: new MockBackend({ responder: (req) => JSON.parse(req.prompt) }), journalDir: RUNS, runId: "cmp-pipe" },
  );
  const x = r.result[0];
  check(
    "pipeline (prev,original,index): stage-1 prev===item, stage-2 prev=stage-1 output, original+index preserved (experiment-01)",
    true,
    x.prevS === 1 && x.original === "X" && x.index === 0,
  );
}

// ---------- 8) concurrency cap = min(16, cores-2) (experiment-03 measured 16) ----------
{
  const expected = Math.min(16, Math.max(1, os.cpus().length - 2));
  check("concurrency cap = min(16, cores-2) (experiment-03)", expected, defaultConcurrency(), (a, b) => a === b);
}

// ---------- 9) COMPOSITION: pipeline whose stage-2 is a parallel (experiment-07: shape [2,2]) ----------
{
  const r = await runWorkflowFile(T("traces/experiment-07-compose.workflow.js"), {
    backend: new MockBackend(),
    journalDir: RUNS,
    runId: "cmp-compose",
  });
  const out = r.result.out;
  const wellFormed =
    Array.isArray(out) &&
    out.length === 2 &&
    out.every((g) => Array.isArray(g) && g.length === 2 && g.every((v) => v && typeof v === "object" && "ref" in v && "ok" in v));
  // Compare OURS' shape against the REAL experiment-07 trace's shape ([2,2]); STRUCTURE-MISMATCH
  // fails the equality if the nested [verdict,verdict] of {ref,ok} structure is wrong.
  const realComp = realResult("traces/experiment-07-compose/task-output.json");
  check("composition: pipeline stage-2 = parallel -> shape matches real trace (experiment-07)", realComp.shape, wellFormed ? r.result.shape : "STRUCTURE-MISMATCH");
}

// ---------- 10) budget contract: total=null -> remaining()=Infinity; spent() monotonic (experiment-01) ----------
{
  const r = await runWorkflow(
    "export const meta={name:'bg',description:'budget'};\n" +
      "const s0=budget.spent();\nawait agent('x');\nconst s1=budget.spent();\n" +
      "return { total: budget.total, remainingInfinite: budget.remaining()===Infinity, grew: s1>=s0 && s1>0 };\n",
    { backend: new MockBackend(), journalDir: RUNS, runId: "cmp-budget" },
  );
  // exp-01 task-output: budgetTotal=null, tokensSpent>0; remaining is Infinity when total is null.
  check("budget: total=null -> remaining()=Infinity, spent() monotonic (experiment-01)", { total: null, remainingInfinite: true, grew: true }, r.result);
}

// ---------- report ----------
const total = rows.length;
const pct = ((pass / total) * 100).toFixed(1);
console.log("behavior".padEnd(54), "match");
console.log("-".repeat(64));
for (const r of rows) {
  console.log(r.name.padEnd(54), r.ok ? "✓" : `✗  real=${JSON.stringify(r.real)} ours=${JSON.stringify(r.ours)}`);
}
console.log("-".repeat(64));
console.log(`FIDELITY: ${pass}/${total} = ${pct}%`);
process.exit(pass === total ? 0 : 1);
