// tools/fleet-matrix.mjs — dogfood benchmark: fan the local free cc-family fleet across a set of
// source files for structured code review, driven by THIS project's PoolBackend. Exercises the
// agent×model pool end-to-end (label routing, circuit breaker, telemetry) under real load and emits
// a per-worker scoreboard. The harness that produced docs/BENCHMARKS.md §4 "Fleet matrix".
//
// Usage:
//   npm run build && node tools/fleet-matrix.mjs [file ...]    # default targets: this repo's src/*.ts
//   SMOKE=1 node tools/fleet-matrix.mjs                        # 1 worker × 1 target end-to-end check
//   OUT=/tmp/fm node tools/fleet-matrix.mjs path/to/a.py b.py
//
// Assumes the cc-family wrappers (ccz/ccxm/ccd/ccor/ccq/ccfree) are on PATH; each is a full
// Claude-Code CLI accepting `-p --dangerously-skip-permissions [--bare --max-turns 1] "<prompt>"`.
// Findings are LEADS, not ground truth — verify before acting (free models hallucinate).

import { CliAgentBackend, PoolBackend, PoolState, poolTelemetry } from "../dist/index.js";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, basename } from "node:path";

const SMOKE = process.env.SMOKE === "1";
const OUT = process.env.OUT ?? "/tmp/fleet-matrix";
mkdirSync(OUT, { recursive: true });
const here = dirname(fileURLToPath(import.meta.url));

// ---------- targets: argv files, else this repo's own src/*.ts (dogfood) ----------
const argvFiles = process.argv.slice(2);
const defaultFiles = readdirSync(resolve(here, "../src"))
  .filter((f) => f.endsWith(".ts"))
  .map((f) => resolve(here, "../src", f));
const ALL_TARGETS = (argvFiles.length ? argvFiles.map((f) => resolve(f)) : defaultFiles).map((path) => ({
  name: basename(path),
  path,
}));

// ---------- workers: lean cc-family fleet (--bare skips hooks/LSP/MCP; --max-turns 1 = single-shot) ----------
// Select via WORKERS=ccxm,ccz,... (default = good valid-JSON producers). ccq/ccor/ccfree are opt-in;
// ccq is OFF unless explicitly named (weak quality / high hallucination — measured 2026-05-29).
const LEAN = ["--bare", "--max-turns", "1"];
const cc = (cmd, extra, timeoutMs) =>
  CliAgentBackend.custom({ buildCommand: (req) => ({ cmd, args: [...extra, req.prompt] }), timeoutMs });
const ccfam = ["-p", "--dangerously-skip-permissions", ...LEAN];

const REGISTRY = {
  ccxm: { conc: 2, backend: cc("ccxm", ccfam, 240_000) }, // best structured-review worker
  ccz: { conc: 2, backend: cc("ccz", ccfam, 240_000) }, // reliable, conservative
  ccd: { conc: 2, backend: cc("ccd", ccfam, 240_000) }, // slower on big files
  ccor: { conc: 2, backend: cc("ccor", ccfam, 60_000) }, // opt-in: rarely valid JSON
  "ccfree-flash": { conc: 2, backend: cc("ccfree", ["-m", "flash", ...ccfam], 120_000) }, // opt-in: NIM via router
  ccq: { conc: 2, backend: cc("ccq", ccfam, 120_000) }, // opt-in ONLY (named in WORKERS) — weak quality
};
const DEFAULT_WORKERS = ["ccxm", "ccz", "ccd"];
const picked = process.env.WORKERS ? process.env.WORKERS.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_WORKERS;
const ALL_WORKERS = picked.filter((n) => REGISTRY[n]).map((n) => ({ name: n, ...REGISTRY[n] }));
if (!ALL_WORKERS.length) throw new Error(`no valid workers in WORKERS="${process.env.WORKERS}"; known: ${Object.keys(REGISTRY).join(",")}`);

const TARGETS = SMOKE ? ALL_TARGETS.slice(0, 1) : ALL_TARGETS;
const WORKERS = SMOKE ? [ALL_WORKERS[0]] : ALL_WORKERS;

// ---------- review schema + prompt ----------
const SCHEMA = {
  type: "object",
  properties: {
    module: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string" },
          line: { type: ["integer", "null"] },
          category: { type: "string" },
          issue: { type: "string" },
          evidence: { type: "string" },
          fix: { type: "string" },
        },
        required: ["severity", "category", "issue"],
      },
    },
    summary: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["module", "findings", "summary"],
};

const buildPrompt = (t) => `You are auditing ONE source file. Find REAL defects only: correctness bugs,
API misuse, resource leaks, thread-safety. Cite the exact line. If the code is fine, return empty findings.

FILE: ${t.name}
<<<CODE
${readFileSync(t.path, "utf8")}
CODE

Respond with ONLY a JSON object (no markdown, no prose):
{"module":"${t.name}","findings":[{"severity":"critical|high|medium|low","line":<int|null>,"category":"correctness|api-misuse|resource|thread-safety|style","issue":"<short>","evidence":"<quote>","fix":"<short>"}],"summary":"<1-2 sentences>","confidence":<0.0-1.0>}
Output JSON only.`;

// ---------- pool (label routing + breaker + telemetry) ----------
const memberNames = WORKERS.map((w) => w.name);
const state = new PoolState(memberNames, Object.fromEntries(memberNames.map((n) => [n, {}])));
const pool = new PoolBackend({
  routes: WORKERS.map((w) => ({ name: w.name, match: [w.name], backend: w.backend, priority: 0 })),
  default: WORKERS[0].name,
  state,
  log: (m) => process.stderr.write(`[pool] ${m}\n`),
});

// ---------- driver: one bounded lane per worker, all lanes concurrent ----------
const results = [];
const isObj = (o) => o !== null && typeof o === "object";

async function lane(worker) {
  let i = 0;
  const work = async () => {
    while (i < TARGETS.length) {
      const t = TARGETS[i++];
      const started = Date.now();
      const cell = { worker: worker.name, target: t.name };
      try {
        // PIN via agentType, NOT model — model would leak to the CLI as --model (see worker() fix).
        const resp = await pool.run({ prompt: buildPrompt(t), agentId: `${t.name}__${worker.name}`, agentType: worker.name, schema: SCHEMA });
        cell.ms = Date.now() - started;
        cell.ok = true;
        cell.validJson = isObj(resp.output);
        cell.output = resp.output;
        cell.nFindings = isObj(resp.output) && Array.isArray(resp.output.findings) ? resp.output.findings.length : null;
      } catch (e) {
        cell.ms = Date.now() - started;
        cell.ok = false;
        cell.error = String(e?.message ?? e).slice(0, 240);
      }
      results.push(cell);
      process.stderr.write(`  [${cell.ok ? (cell.validJson ? "ok " : "txt") : "ERR"}] ${worker.name} × ${t.name} ${cell.ms}ms${cell.nFindings != null ? ` (${cell.nFindings} findings)` : ""}\n`);
    }
  };
  await Promise.all(Array.from({ length: worker.conc }, work));
}

const t0 = Date.now();
process.stderr.write(`fleet-matrix: ${WORKERS.length} workers × ${TARGETS.length} targets = ${WORKERS.length * TARGETS.length} cells${SMOKE ? " (SMOKE)" : ""}\n`);
await Promise.all(WORKERS.map(lane));
const wallMs = Date.now() - t0;

// ---------- scoreboard from pool telemetry ----------
const tel = poolTelemetry(state);
const scoreboard = tel.map((m) => {
  const rs = results.filter((r) => r.worker === m.name);
  const ok = rs.filter((r) => r.ok);
  const valid = rs.filter((r) => r.validJson);
  return {
    worker: m.name,
    circuit: m.circuit,
    cells: rs.length,
    ok: ok.length,
    validJson: valid.length,
    failed: rs.length - ok.length,
    errorRate: +m.errorRate.toFixed(2),
    avgMs: ok.length ? Math.round(ok.reduce((a, r) => a + r.ms, 0) / ok.length) : null,
    ewmaMs: m.latencyEwmaMs ? Math.round(m.latencyEwmaMs) : null,
    findings: valid.reduce((a, r) => a + (r.nFindings || 0), 0),
  };
});

// per-target findings digest (compact: one line per finding across all valid reviewers)
const digest = TARGETS.map((t) => {
  const cells = results.filter((r) => r.target === t.name && r.validJson);
  return {
    target: t.name,
    reviewers: cells.length,
    findings: cells.flatMap((c) =>
      (c.output.findings || []).map((f) => ({ worker: c.worker, severity: f.severity, line: f.line ?? null, category: f.category, issue: f.issue })),
    ),
  };
});

writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
writeFileSync(`${OUT}/scoreboard.json`, JSON.stringify({ wallMs, scoreboard }, null, 2));
writeFileSync(`${OUT}/digest.json`, JSON.stringify(digest, null, 2));
console.log("\n=== FLEET SCOREBOARD ===");
console.table(scoreboard);
console.log(`wall=${(wallMs / 1000).toFixed(1)}s  cells=${results.length}  ok=${results.filter((r) => r.ok).length}  validJson=${results.filter((r) => r.validJson).length}`);
console.log(`wrote ${OUT}/{results,scoreboard,digest}.json`);
