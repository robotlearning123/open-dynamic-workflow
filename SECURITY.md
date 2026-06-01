# Security

## Workflow scripts are TRUSTED input — `node:vm` is NOT a sandbox

The engine executes workflow scripts via `node:vm` (`src/runner.ts`). This reproduces the real
engine's *ergonomics* — injected `agent`/`parallel`/`pipeline`/… globals, and `Date.now()` /
argless `new Date()` / `Math.random()` throwing, with no `require`/`process`/`fetch` in scope — but
**`node:vm` is not a security boundary.**

Any host object or function placed into the vm context (the workflow globals themselves, `console`,
`JSON`, …) carries the **host realm's `Function`** via its `.constructor`. So a script can escape:

```js
Array.constructor("return process")()        // → the real host process
agent.constructor("return process")()         // → same, via an injected global
```

From `process` a script reaches `child_process`, the filesystem, env vars, and the network.

**Therefore: only run workflow source you trust** — exactly as in Claude Code's dynamic workflows,
where Claude itself authors the script. Do **not** feed untrusted or third‑party workflow scripts to
this engine. To run untrusted scripts, execute the engine inside a real boundary (a separate process
with OS‑level sandboxing / a container, or replace the runner with `isolated-vm`). The `Date`/`Math`/
`require` shaping in the runner is ergonomic + behavioral fidelity, **not** a containment guarantee.

## Agent backends

- **`CliAgentBackend`** spawns child processes with an **args array** (no shell), so a prompt cannot
  be shell‑injected. The `bypass` / `--dangerously-*` options disable the agent's own sandbox — use
  them only in an already‑sandboxed environment.
- **`HttpAgentBackend`** posts prompts to a URL you configure; pass auth via `headers`.
- No secrets are stored. `AnthropicBackend` reads `ANTHROPIC_API_KEY` from the environment.

### Additional caveats

- Nested `workflow()` (child workflows) execute via `new Function(...)` in the host realm — they are NOT wrapped in `node:vm`, so the `Date.now()` / `Math.random()` / `require` guards apply ONLY to the top-level workflow context, not to child workflows. (Run only trusted workflow source — this is consistent with the existing "vm is not a security boundary" stance.)
- `CliAgentBackend` spawns inherit the full parent `process.env` by default (including `ANTHROPIC_API_KEY`). Pass an explicit `env` in the CliAgentSpec to restrict what a spawned agent sees.
- A spawned agent's stderr/stdout tail (up to 500 chars) is included verbatim in thrown error messages and progress logs — if a child CLI prints a secret before crashing, it can surface in logs.
- `runId` and `resumeFromRunId` are validated against a safe pattern (`^[A-Za-z0-9_-]{1,128}$`) before being used in filesystem paths, to prevent path traversal.
- `parseMeta()` evaluates the meta object literal in an empty `vm` context (no injected host globals), so the constructor-escape is harder there than in the full workflow context — but it still executes arbitrary code and is not a security boundary.
- `HttpAgentBackend`'s `url` is caller-supplied and trusted — there is no SSRF allowlist, so do not pass attacker-controlled URLs (they could reach internal or metadata endpoints such as `169.254.169.254`).
- Resume caches an agent's TEXT output only, NOT filesystem or side-effects — re-running a cached file-writing or `isolation:'worktree'` agent does NOT re-apply its side effects, so a resumed run can diverge from a fresh run.

## Reporting

Educational reproduction (v0.x). Please open an issue for security concerns:
<https://github.com/robotlearning123/open-dynamic-workflow/issues>
