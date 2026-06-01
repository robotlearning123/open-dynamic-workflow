# Feature parity: ours vs the raw Claude Code dynamic-workflow engine

Order of operations (per project priority): **(1) be 1:1 with raw first, (2) cover every raw feature, (3) then be better.** This page is the honest accounting. "1:1 verified" = asserted by `tools/compare.mjs` (currently **34/34 = 100%**) against real captured traces; "covered" = implemented + unit-tested; "🔜" = on the roadmap (not yet, stated plainly).

## 1. Raw features — coverage
| raw capability | status | where / evidence |
|---|---|---|
| `agent()` text result | ✅ 1:1 verified | compare "probe" + traces/experiment-01 |
| `agent()` schema → `StructuredOutput` forced tool | ✅ 1:1 verified | `src/backend.ts`, `src/structured-output.ts`; compare |
| `parallel()` concurrent + barrier + input-order | ✅ 1:1 verified | `src/primitives.ts`; traces/experiment-01 |
| `parallel()` async-reject→null, **sync-throw crashes** | ✅ 1:1 verified | traces/experiment-05; `test/primitives.test.ts` |
| `pipeline()` no inter-stage barrier | ✅ 1:1 verified | traces/experiment-01 (wall-clock); primitives test |
| `pipeline()` `(prev,original,index)`, stage-throw→null | ✅ 1:1 verified | traces/experiment-01 / 05 |
| `phase()` / `log()` | ✅ covered | `src/primitives.ts`, `src/progress.ts` |
| `budget {total,spent(),remaining()}` + hard ceiling | ✅ covered | primitives + tests (run-scoped; see §3) |
| `workflow()` nesting = 1 level (exact error msg) | ✅ 1:1 verified | traces/experiment-05; compare exact-message match |
| journal: append-only `{type,key,agentId,result}`, `v2:` keys (exact real shape) | ✅ 1:1 verified | `src/journal.ts`; compare journal-shape checks |
| resume: prefix-**chained** key, content-addressed (seq→100%, edit→cascade, concurrent→partial) | ✅ 1:1 verified | exp-02 + **exp-06** FINDINGs; compare "resume cascade" (34/34) |
| concurrency cap `min(16,cores-2)` | ✅ covered | `src/concurrency.ts`; measured in traces/experiment-03 |
| lifetime cap 1000 agents | ✅ covered | `MAX_TOTAL_AGENTS` + test (not live-run, to bound cost) |
| script sandbox: block `Date.now`/argless `new Date`/`Math.random`; no require/process/fetch | ✅ 1:1 verified | `src/runner.ts`; compare sandbox 14/14 exact |
| `meta` (name/description/phases) | ✅ covered | `parseMeta` + test |
| `args`, `opts.model`, `opts.label`, `opts.phase`, `agentType` | ✅ covered | primitives + types |
| `opts.isolation:'worktree'` (git worktree per agent) | 🟡 partial | type honored; `CliAgentBackend` supports per-request `cwd` (point at a worktree); auto `git worktree add` is 🔜 |
| named-workflow registry `workflow('name')` | 🟡 partial | `{scriptPath}` resolver works; a name→path registry is 🔜 |
| rich live TUI progress | 🟡 partial | `TreeReporter` (line/tree to stderr); no full-screen TUI |

## 2. Beyond raw — where ours is *better* (the open-source value)
| capability | raw | ours |
|---|---|---|
| Runs outside Claude Code | ✗ (only inside CC) | ✅ standalone npm lib in any Node app / CI |
| Open & forkable | ✗ closed | ✅ MIT TypeScript |
| **Agent is a pluggable basic unit** | Claude Code only | ✅ `CliAgentBackend` → **any** agent CLI: `claude`, `codex`, `opencode`, `ccz/ccd/ccq`, `cursor`, custom |
| **Local → cloud** | local (in-session) | ✅ `CliAgentBackend` (local processes) **and** `HttpAgentBackend` (remote agent runner) |
| Multi-model / multi-vendor per agent | single vendor | ✅ `opts.model` + per-backend model resolution |
| Tool-using direct API agents | n/a | ✅ `AnthropicBackend({tools})` tool-use loop |
| Deterministic offline testing | ✗ | ✅ `MockBackend` (schema-faking, no Date/random) |
| Transparent, inspectable resume | internal | ✅ human-readable `journal.jsonl` |
| Reverse-engineering field guide | n/a | ✅ `ANALYSIS.md` + `traces/` (7 real runs + live e2e) |

## 3. Honest boundaries (reproduce observable behavior, not internals)
- The `v2:` cache-key **hash preimage** is undisclosed — we match shape/semantics, not bytes.
- `budget.spent()` is **turn-global** in the harness vs **run-scoped** here (same observable contract: monotonic output-token meter + hard ceiling).
- The raw subagent is Claude Code itself; ours models the agent as a pluggable CLI/HTTP/API unit. With `CliAgentBackend.claude()` the unit *is* Claude Code — closing the gap on this host.
- CLI agents don't report tokens → we estimate `ceil(chars/4)`.

## 4. Roadmap to "covers all + strictly better"
1. Auto git-worktree isolation when `opts.isolation:'worktree'` (wire into `CliAgentBackend.cwd`).
2. Named-workflow registry for `workflow('name')`.
3. Token usage from CLI agents that report it (e.g. `--output-format json`).
4. A richer live TUI reporter.
5. More real-vs-ours comparison probes as features land (keep `compare.mjs` at 100%).
