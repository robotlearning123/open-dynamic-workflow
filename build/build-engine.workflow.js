// build-engine.workflow.js — fan-out build of the 1:1 reproduction engine.
// Opus authored the contract (src/types.ts, SPEC.md, ANALYSIS.md). This workflow dispatches
// parallel Sonnet implementers, each owning DISTINCT files, implementing to the contract.
// Integration (npm install, tsc, vitest, cross-check) is done by the orchestrator afterward.

export const meta = {
  name: 'build-open-dynamic-workflow-engine',
  description: 'Fan-out implement the TS engine modules + tests + config + examples against SPEC.md.',
  phases: [{ title: 'Implement', detail: 'parallel module implementers (config, concurrency, journal, structured-output, backend, primitives, runner, progress/cli/index, examples)' }],
}

const ROOT = (args && args.root) || '<repo-root>'

const PRE = `You are a worker building an open-source TypeScript repo at ${ROOT}.
RULES (follow exactly):
- FIRST Read these contract files already on disk: ${ROOT}/src/types.ts , ${ROOT}/SPEC.md , ${ROOT}/ANALYSIS.md.
- Implement EXACTLY the exports/signatures in SPEC.md against src/types.ts. Do NOT modify types.ts or files owned by other modules.
- ESM TypeScript ("type":"module", NodeNext): import LOCAL files with a .js extension, e.g. import { Foo } from "./types.js"; tests import from "../src/x.js".
- Do NOT fabricate APIs. The Anthropic SDK shape is given in SPEC.md ("Verified Anthropic SDK contract") — use it verbatim; never invent SDK methods/fields from memory.
- No emojis. Minimal, accurate comments. Match the style/strictness of src/types.ts. Code must pass "tsc --strict".
- Write with absolute paths under ${ROOT}. Your FINAL message = a one-line manifest "wrote: <files>". Not prose.`

const tasks = [
  { label: 'config', prompt: `Create project config:
- ${ROOT}/package.json : {"name":"open-dynamic-workflow","version":"0.1.0","type":"module","bin":{"run-workflow":"dist/cli.js"},"scripts":{"build":"tsc","typecheck":"tsc --noEmit","test":"vitest run"},"dependencies":{"@anthropic-ai/sdk":"^0.100.0"},"devDependencies":{"typescript":"^6.0.3","vitest":"^4.1.7","@types/node":"^22.0.0","tsx":"^4.22.3"},"engines":{"node":">=20"}}
- ${ROOT}/tsconfig.json : compilerOptions {target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",strict:true,esModuleInterop:true,skipLibCheck:true,resolveJsonModule:true,declaration:true,outDir:"dist",rootDir:"."}, include:["src","test"], exclude:["node_modules","dist","traces","build"].
- ${ROOT}/vitest.config.ts : import {defineConfig} from "vitest/config"; export default defineConfig({test:{environment:"node",include:["test/**/*.test.ts"]}});
- ${ROOT}/.gitignore : node_modules, dist, .runs/, *.log  (do NOT ignore traces/ — those are committed evidence).
Verify each JSON parses.` },

  { label: 'concurrency', prompt: `Implement ${ROOT}/src/concurrency.ts and ${ROOT}/test/concurrency.test.ts per SPEC.md "src/concurrency.ts".
- defaultConcurrency()=min(16,max(1,os.cpus().length-2)); MAX_TOTAL_AGENTS=1000; class Limiter{constructor(max);run<T>(fn):Promise<T>;active;queued} — acquire slot or FIFO-queue, run, release next.
- Tests (vitest): with max=2 and 5 tasks that each await a deferred, assert at most 2 active simultaneously and all 5 complete; assert FIFO order of starts.` },

  { label: 'journal', prompt: `Implement ${ROOT}/src/journal.ts and ${ROOT}/test/journal.test.ts per SPEC.md "src/journal.ts" and ANALYSIS.md §5,§6.
- cacheKey(prompt,opts,ordinal) = "v2:"+sha256(stableStringify({prompt,schema:opts.schema??null,model:opts.model??null,agentType:opts.agentType??null,isolation:opts.isolation??null,ordinal})). Use node:crypto. stableStringify must sort object keys recursively.
- createJournal({runId,dir,resumeFromRunId?}): appends {type:"started"|"result",ordinal,key,agentId,result?} lines to <dir>/<runId>/journal.jsonl (mkdir -p). On resume, load <dir>/<resumeFromRunId>/journal.jsonl, index by ordinal. lookup(ordinal,key): if prefixIntact && prior[ordinal] && prior[ordinal].key===key -> {hit:true,result:prior result}; else prefixIntact=false; return {hit:false}.
- Tests: (a) sequential identical (ordinal,key) sequence -> all hits; (b) change key at ordinal 3 -> ordinals 1-2 hit, 3+ miss (prefix broken); (c) object and string results round-trip.` },

  { label: 'structured-output', prompt: `Implement ${ROOT}/src/structured-output.ts and ${ROOT}/test/structured-output.test.ts per SPEC.md "src/structured-output.ts".
- MAX_SCHEMA_RETRIES=2; toToolDef(schema,name="StructuredOutput")->{name,description,input_schema:schema}; validate(value,schema) supporting type(object/array/string/number/integer/boolean/null),properties,required,items,enum -> {ok:true}|{ok:false,errors}.
- Tests: valid object passes; missing required -> errors; wrong type -> errors; enum violation -> errors; nested object+array validate.` },

  { label: 'backend', prompt: `Implement ${ROOT}/src/backend.ts and ${ROOT}/test/backend.test.ts per SPEC.md "src/backend.ts" and ANALYSIS.md §4,§8.
- MockBackend: deterministic, NO Date/Math.random. If req.schema -> synthesize a minimal VALID instance (object:{} filling required recursively; string:"mock"; integer/number:0; boolean:false; array:[]; enum:first; respect nested schemas). Else -> a canned string derived from req.prompt (e.g. "[mock] "+first 60 chars). outputTokens=Math.ceil(JSON.stringify(output).length/4); inputTokens=Math.ceil(prompt.length/4). Record calls[].
- AnthropicBackend: use the verified SDK shape in SPEC.md. Resolve aliases {sonnet:"claude-sonnet-4-6",haiku:"claude-haiku-4-5-20251001",opus:"claude-opus-4-6"}. schema path: tools=[toToolDef(schema)], tool_choice={type:"tool",name:"StructuredOutput"}, read tool_use.input, validate(), retry up to MAX_SCHEMA_RETRIES feeding the validation errors back as a user message. text path: join text blocks. outputTokens=msg.usage.output_tokens, inputTokens=msg.usage.input_tokens. Accept an injected client for testability; default new Anthropic({apiKey:o.apiKey??process.env.ANTHROPIC_API_KEY}).
- Tests (MockBackend ONLY, no network): schema req -> object valid against schema; text req -> string; outputTokens>0; identical req twice -> identical output (determinism). Use a fake client object to unit-test AnthropicBackend's schema parsing WITHOUT network (inject client whose messages.create returns a canned tool_use response).` },

  { label: 'primitives', prompt: `Implement ${ROOT}/src/primitives.ts and ${ROOT}/test/primitives.test.ts per SPEC.md "src/primitives.ts" and ANALYSIS.md §2,§3,§6,§7. THIS IS THE CORE — be precise.
- createContext(cfg & {runId}): build RunContext (Limiter via cfg.concurrency??defaultConcurrency(); journal via createJournal; reporter via cfg.reporter??silent; budgetTotal=cfg.budget??null; state{ordinal:0,agentCount:0,tokensSpent:0,currentPhase:"",agentSeq:0}; depth:0; abort:{aborted:false}; limiterRun=limiter.run.bind(limiter)).
- makeGlobals(ctx) returns {agent,parallel,pipeline,phase,log,args:ctx.args,budget,workflow}:
  * agent(prompt,opts={}): const ordinal=++ctx.state.ordinal (SYNCHRONOUS, before any await — critical for resume); label=opts.label??("agent#"+ordinal); phase=opts.phase??ctx.state.currentPhase; key=cacheKey(prompt,opts,ordinal); agentId="a"+ordinal-derived-id; emit agent-start; return ctx.limiterRun(async()=>{ if(ctx.budgetTotal!=null && ctx.state.tokensSpent>=ctx.budgetTotal) throw Error("budget exhausted"); if(ctx.state.agentCount>=MAX_TOTAL_AGENTS) throw Error("agent cap 1000 reached"); const c=ctx.journal.lookup(ordinal,key); if(c.hit){emit agent-done cached:true; return c.result;} ctx.journal.recordStarted(ordinal,key,agentId); try{ const resp=await ctx.backend.run({prompt,schema:opts.schema,model:opts.model??ctx.defaultModel,agentType:opts.agentType??"workflow-subagent",agentId}); ctx.state.agentCount++; ctx.state.tokensSpent+=resp.outputTokens; ctx.journal.recordResult(ordinal,key,agentId,resp.output); emit agent-done; return resp.output;}catch(e){emit agent-fail; throw e;} });
  * parallel(thunks): Promise.all(thunks.map(t=>(async()=>{try{return await t();}catch{return null;}})())) — barrier, order preserved.
  * pipeline(items,...stages): Promise.all(items.map((item,i)=>(async()=>{try{let acc=item;for(const s of stages)acc=await s(acc,item,i);return acc;}catch{return null;}})())) — NO inter-stage barrier.
  * phase(title): ctx.state.currentPhase=title; emit phase. log(msg): emit log. budget per SPEC. workflow(ref,args): if ctx.depth>=1 throw "nesting one level only"; else use ctx.workflowResolver (throw if absent) and run nested sharing ctx counters (depth+1).
- Tests with MockBackend + silent reporter + a tmp journal dir:
  (a) parallel preserves order + a throwing thunk -> null;
  (b) pipeline NO-BARRIER: 2 items, stage1 with per-item different mock delay (item0 slow, item1 fast) recording a global start-order array; assert item1 reaches stage2 before item0 finishes stage1 (start order shows pipe2_item1 before stage1_item0_done) — use a shared array + small awaited timers to sequence; also assert stage receives (prev,original,index) and stage1 prev===item;
  (c) budget ceiling: budget=0 -> first agent throws "budget exhausted" (caught by parallel -> null acceptable; test agent() directly throws);
  (d) resume: run a small sequential workflow ctx, then a second ctx with resumeFromRunId=first runId and a backend that throws if called -> all results served from cache (0 backend calls).` },

  { label: 'runner', prompt: `Implement ${ROOT}/src/runner.ts and ${ROOT}/test/runner.test.ts per SPEC.md "src/runner.ts" and ANALYSIS.md §9. Tricky — be careful.
- parseMeta(source): extract the object literal after "export const meta =" up to its matching closing brace (balance braces, respect strings), evaluate it in a minimal vm sandbox to get the object; throw if missing name or description.
- runWorkflow(source,cfg): meta=parseMeta(source); runId=cfg.runId ?? deterministic id (NO Date/random: e.g. "wf_"+sha256(source+JSON.stringify(cfg.args??null)).slice(0,12)); ctx=createContext({...cfg,runId}); globals=makeGlobals(ctx). Build a vm context: spread globals + safe built-ins {JSON,Math:SAFE_MATH,Array,Object,String,Number,Boolean,Promise,Map,Set,console,globalThis:{}} and a SAFE_DATE. SAFE_MATH = {...Math, random:()=>{throw new Error("Math.random() is unavailable in workflow scripts (breaks resume). For N independent samples, include the index in the agent label or prompt.")}}. SAFE_DATE: a function/class where now() and a 0-arg call/new throw "Date.now() / new Date() are unavailable in workflow scripts (breaks resume). Stamp results after the workflow returns, or pass timestamps via args." but new Date(arg) delegates to the real Date. Do NOT expose require/process/fetch.
  Strip leading "export " (multiline) from source, wrap as: const fn = vm.runInContext("(async function(){\\n"+body+"\\n})", context); const result = await fn(); journal.flush(); return {result,runId,journalPath:journal.path,agentCount:ctx.state.agentCount,tokensSpent:ctx.state.tokensSpent}.
- runWorkflowFile(path,cfg): read file, set cfg.runId default, call runWorkflow.
- Tests (MockBackend, tmp journalDir): (a) a script with phases + parallel + return value returns the value; (b) parseMeta extracts name/description; (c) a script calling Date.now() rejects with the exact message; Math.random() rejects with exact message; new Date(0) works; (d) typeof require==="undefined" inside script.` },

  { label: 'progress-cli-index', prompt: `Implement ${ROOT}/src/progress.ts, ${ROOT}/src/cli.ts, ${ROOT}/src/index.ts per SPEC.md.
- progress.ts: class TreeReporter implements ProgressReporter (constructor {stream?}=process.stderr; emit(e) renders phase headers, agent start/done/fail lines with label+cached+tokens, log as narrator). export const silentReporter:ProgressReporter={emit(){}}.
- cli.ts: "#!/usr/bin/env node" shebang; parse argv: run-workflow <script.js> [--args <json>] [--resume <runId>] [--mock] [--budget <n>] [--json-dir <dir>]. backend = (!--mock && process.env.ANTHROPIC_API_KEY) ? new AnthropicBackend() : new MockBackend(). reporter=new TreeReporter(). Call runWorkflowFile. On success print "runId: <id>" and JSON.stringify(result.result,null,2) to stdout; process.exitCode=0. On error print to stderr, exitCode=1.
- index.ts: re-export runWorkflow,runWorkflowFile,parseMeta (runner), MockBackend,AnthropicBackend (backend), Limiter,defaultConcurrency (concurrency), createJournal,cacheKey (journal), TreeReporter,silentReporter (progress), and "export * from ./types.js".
No test file required for these (covered via runner/cli usage). Ensure tsc-strict clean.` },

  { label: 'examples', prompt: `Create three PLAIN-JS example workflow scripts under ${ROOT}/examples/ (no imports; they use injected globals). They must RUN to completion under MockBackend (deterministic). Read ANALYSIS.md for primitive semantics.
- examples/review-changes.js: meta + a DIMENSIONS array; pipeline(DIMENSIONS, d=>agent(review prompt, {schema:FINDINGS}), review=>parallel(review.findings.map(f=>()=>agent(verify prompt,{schema:VERDICT})))) ; then flatten + filter by survivesVerification(votes). Include function survivesVerification(votes){ /* majority */ } with a comment: "DECISION POINT — majority vs unanimous changes how many findings survive; tune here." Keep schemas small.
- examples/research.js: parallel multi-modal sweep (3 agents, schema) -> pipeline deep-read (2 stages) -> a synth agent. return a small report object.
- examples/loop-until-dry.js: while(dry<2){ const found=(await parallel([...3 finder agents schema...])).filter(Boolean).flatMap(r=>r.items||[]); const fresh=found.filter(x=>!seen.has(key(x))); if(!fresh.length){dry++;continue;} dry=0; fresh.forEach(x=>seen.add(key(x))); confirmed.push(...fresh);} with function key(x){...}. MUST terminate under MockBackend (mock returns identical items each round -> round 2 has no fresh -> dry increments). Add a hard safety cap (e.g. max 6 rounds) to guarantee termination. Comment key() as a DECISION POINT.
Verify each file is syntactically valid JS (node --check).` },
]

phase('Implement')
const results = await parallel(
  tasks.map((t) => () => agent(`${PRE}\n\nTASK [${t.label}]:\n${t.prompt}`, { label: t.label, phase: 'Implement', model: 'sonnet' })),
)
return {
  built: tasks.map((t, i) => ({ label: t.label, ok: results[i] != null, manifest: typeof results[i] === 'string' ? results[i].slice(0, 240) : results[i] })),
}
