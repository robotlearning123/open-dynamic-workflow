> Historical adversarial-review artifact. This is not the current vulnerability list; see `review/README.md` and `PROGRESS.md` for current status.

Now I have all the evidence needed. Here is my confirmed findings report:

---

## tests-coverage — Confirmed Defects

### 1. `crosscheck.mjs:61` — Resume cache assertion is too weak; allows partial failure to pass

**Severity: HIGH** | `tools/crosscheck.mjs:61`

The assertion:
```js
ok(counting.calls.length < 8, `resume reused cache (live calls ${counting.calls.length} < 8)`);
```
allows 0–7 cache misses to pass. With a deterministic `MockBackend` and identical source, the correct bound is `=== 0`. The companion `compare.mjs:94` correctly checks for exactly 0 (`(x, y) => y <= x` where `x=0`). A caching regression that misses 1–7 keys would pass crosscheck but fail compare — the two gates are inconsistent.

**Confirmed by:**
```bash
node -e "
const fs = require('fs');
const s = fs.readFileSync('tools/crosscheck.mjs','utf8').split('\n');
console.log('L61:', s[60]);
"
# → ok(counting.calls.length < 8, ...)
# compare.mjs L94: check("resume: ...", 0, counting.calls.length, (x, y) => y <= x);
```

**Fix:** `crosscheck.mjs:61` — change `< 8` to `=== 0`:
```js
ok(counting.calls.length === 0, `resume reused cache (live calls ${counting.calls.length}; expect 0)`);
```

---

### 2. `primitives.ts:130–132` — Agent `agent-fail` progress event never tested via `agent()` API

**Severity: HIGH** | `src/primitives.ts:130–132`

When `backend.run()` throws (not from budget/cap), the catch block emits an `agent-fail` progress event:
```ts
} catch (e) {
  const errMsg = e instanceof Error ? e.message : String(e);
  ctx.reporter.emit({ kind: "agent-fail", ordinal, agentId, label, phase, error: errMsg });
  throw e;
}
```
No test exercises this path. The only `ThrowingBackend` in `primitives.test.ts` is used in the resume test (line 259) where it must **not** be called. The `agent-fail` event is tested only as a direct `emit()` on `TreeReporter` in `progress.test.ts:18` — not through the actual `agent()` → `backend.run()` → catch integration.

**Confirmed by:**
```bash
# V8 coverage shows the catch at L130 branches both uncovered:
npx vitest run --coverage --coverage.include='src/primitives.ts' --coverage.reporter=json
# Branch 17 idx 0 (L130:44) and idx 1 (L130:56) → both 0
grep -n "ThrowingBackend\|agent-fail" test/primitives.test.ts
# ThrowingBackend only at L259 (resume test, must NOT fire)
```

**Fix:** Add a test where a non-`ThrowingBackend` backend rejects during `agent()`:
```ts
it("emits agent-fail on backend error and re-throws", async () => {
  const failBackend: AgentBackend = {
    run: async () => { throw new Error("API down"); },
  };
  const events: ProgressEvent[] = [];
  const reporter = { emit: (e: ProgressEvent) => events.push(e) };
  const ctx = createContext({ backend: failBackend, journalDir: makeTmpDir(), runId: "fail-1", reporter });
  const { agent } = makeGlobals(ctx);
  await expect(agent("x")).rejects.toThrow("API down");
  expect(events.some(e => e.kind === "agent-fail" && e.error === "API down")).toBe(true);
});
```

---

### 3. `backend.ts:277–279` — `_executeTools` tool-handler-throw path untested

**Severity: HIGH** | `src/backend.ts:277–279`

When a registered tool's `handler()` throws, the error is caught and wrapped as `"tool error: ..."` text, which is returned to the model as a tool result. No test in `backend-tools.test.ts` exercises this path. A bug in the error wrapping (e.g., empty message, garbled output) would send confusing input to the model.

**Confirmed by:**
```bash
# V8 coverage: the catch block at L277-279 is uncovered (function at L82:39)
grep -n "throw\|error\|fail" test/backend-tools.test.ts
# Only "throw" is in the schema-retry test (L46), not a tool handler throw
```

**Fix:**
```ts
it("wraps tool handler throw as 'tool error: ...' result", async () => {
  const fakeClient = {
    messages: {
      create: async () => {
        // Model calls tool, tool throws, model receives error, then answers
        if (fakeClient._turn++ === 0) {
          return {
            content: [{ type: "tool_use", id: "t1", name: "bad", input: {} }],
            stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 },
          };
        }
        return { content: [{ type: "text", text: "I'll work around it" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
      }, _turn: 0,
    },
  };
  const be = new AnthropicBackend({
    client: fakeClient as never,
    tools: [{ name: "bad", description: "throws", input_schema: { type: "object" }, handler: () => { throw new Error("oops"); } }],
  });
  const res = await be.run({ agentId: "a1", prompt: "x" });
  expect(res.output).toBe("I'll work around it");
});
```

---

### 4. `backend.ts:332–336` — `_runWithTools` schema-nudge path untested

**Severity: MED** | `src/backend.ts:332–336`

When `req.schema !== undefined` and the model returns `end_turn` (or similar) without calling `StructuredOutput`, the code nudges the model to finalize. This is a real production scenario (model forgets to call the structured output tool). No test covers this path.

**Confirmed by:**
```bash
# V8 coverage: Branch 35 idx 0 at L332 uncovered
node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('/tmp/cov/coverage-final.json', 'utf8'));
const info = data[Object.keys(data).find(k => k.includes('backend.ts') && !k.includes('cli') && !k.includes('http'))];
const b = info.b['35'];
console.log('Branch 35:', b);
"
# → [0, 0] — neither branch hit
```

**Fix:** Add a test where the model returns `end_turn` with only text (no tool_use) when `schema` is set and tools are registered, then succeeds on the nudge turn.

---

### 5. `structured-output.ts:128–141` — `deepEqual` recursive object/array comparison paths untested

**Severity: MED** | `src/structured-output.ts:128–141`

The `deepEqual` function (used for enum validation) has its entire object/array comparison branch (lines 128–141) uncovered. All existing enum tests use only simple types (`"red"`, `1`, `null`). If `deepEqual` has a bug in recursive comparison (e.g., different-length arrays, missing keys), it would silently corrupt enum validation for complex types.

**Confirmed by:**
```bash
# V8 coverage shows Branch 28 idx 0 (L128-140) uncovered
# Also functions at L132 and L139 (recursive calls) uncovered
grep -n "enum" test/structured-output.test.ts
# All enum tests use simple types: strings, numbers, null
```

**Fix:**
```ts
it("enum with object values compares deeply", () => {
  const schema: JsonSchema = { enum: [{ a: 1, b: [2, 3] }] };
  expect(validate({ a: 1, b: [2, 3] }, schema).ok).toBe(true);
  expect(validate({ a: 1, b: [2, 4] }, schema).ok).toBe(false);
  expect(validate({ a: 1, b: [2] }, schema).ok).toBe(false);
  expect(validate({ a: 1, b: [2, 3], c: 0 }, schema).ok).toBe(false);
});
```

---

### 6. `primitives.ts:113–114` — `agent({ isolation: "worktree" })` path untested through agent API

**Severity: MED** | `src/primitives.ts:113–114`

The worktree isolation branch inside `agent()` (opts.isolation === "worktree" → `withWorktree` → `backend.run({ cwd })`) is never tested through the agent API. `worktree.ts` is tested directly, but the integration through `agent()` — including passing `cwd` to the backend — is untested.

**Confirmed by:**
```bash
grep -n "isolation.*worktree" test/primitives.test.ts
# No results — the keyword only appears in journal and worktree tests
```

**Fix:**
```ts
it("agent with isolation:'worktree' passes cwd to backend", async () => {
  // Use a git repo as worktreeRoot
  // ...
});
```

---

### 7. `http-agent-backend.ts` — timeout/abort, custom buildBody, custom parseResponse all untested

**Severity: MED** | `src/http-agent-backend.ts` (50% branch coverage)

The `HttpAgentBackend` has only 3 tests (happy path, token estimation, non-ok response). The following are uncovered:
- **Timeout/AbortController** (L53) — if the timeout mechanism is broken, stuck requests would hang forever
- **No fetch available** (L43–45) — the error branch when `fetchImpl` is not a function
- **Custom `buildBody`** (L48) — the alternate body-building path
- **Custom `parseResponse`** (L69 fallback) — custom response parsing

**Confirmed by:**
```bash
npx vitest run --coverage --coverage.include='src/http-agent-backend.ts'
# Branch coverage: 50%, Lines 190-197, 211-212 uncovered
```

**Fix:** Add tests for timeout abort, missing fetch, custom buildBody, and custom parseResponse.

---

### 8. `cli-agent-backend.ts` — preset `buildCommand` logic completely untested

**Severity: LOW** | `src/cli-agent-backend.ts` (50% branch coverage)

The `claude()`, `worker()`, `codex()`, and `opencode()` preset constructors are tested only with `toBeInstanceOf(CliAgentBackend)` (test line 72–76). Their internal `buildCommand` functions — which compose flag arrays for `--model`, `--bare`, `--sandbox`, `--pure`, `--agent`, etc. — are never exercised. The 50% branch coverage is almost entirely due to this gap.

**Confirmed by:**
```bash
grep -n "toBeInstanceOf" test/cli-agent-backend.test.ts
# L72-76: Only checks instance type, never calls .run()
```

**Fix:** Test at least one preset's `buildCommand` output by extracting the invocation from a `custom()` test.

---

### 9. `compare.mjs:159` — composition check #9 hardcodes `true` instead of comparing against real trace

**Severity: LOW** | `tools/compare.mjs:159`

```js
check("composition: pipeline stage-2 = parallel -> [2,2] of {ref,ok} (experiment-07)", true, okShape);
```
All other checks (1–5, 8, 10) compare against actual real trace data. This check compares a hardcoded `true` against a boolean expression. While the assertion is meaningful (it validates shape), the error message `"real=true ours=false"` is misleading since `true` is not the real trace's value. Checks 6 and 7 also don't compare against real trace data, but they at least compare computed values.

**Fix:** Compare against the real experiment-07 trace's result instead of hardcoded `true`:
```js
const realComp = realResult("traces/experiment-07-compose/task-output.json");
check("composition: ...", realComp.out, r.result.out, /* structural comparator */);
```

---

### Summary

| # | Severity | File | Issue |
|---|----------|------|-------|
| 1 | **HIGH** | crosscheck.mjs:61 | Resume assertion `< 8` allows 7 cache misses to pass; should be `=== 0` |
| 2 | **HIGH** | primitives.ts:130–132 | `agent-fail` progress event from `agent()` → backend throw untested |
| 3 | **HIGH** | backend.ts:277–279 | `_executeTools` tool-handler-throw path untested |
| 4 | **MED** | backend.ts:332–336 | `_runWithTools` schema-nudge (end_turn without StructuredOutput) untested |
| 5 | **MED** | structured-output.ts:128–141 | `deepEqual` recursive object/array comparison untested |
| 6 | **MED** | primitives.ts:113–114 | `agent({isolation:"worktree"})` integration untested |
| 7 | **MED** | http-agent-backend.ts | Timeout/abort, custom buildBody/parseResponse untested (50% branch) |
| 8 | **LOW** | cli-agent-backend.ts | Preset `buildCommand` logic untested (50% branch) |
| 9 | **LOW** | compare.mjs:159 | Composition check hardcodes `true` instead of real trace comparison |
