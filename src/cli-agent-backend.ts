import { spawn } from "node:child_process";
import type { AgentBackend, AgentRequest, AgentResponse } from "./types.js";
import { estTokens } from "./utils.js";

// CliAgentBackend — the gap-closer + superset vs the raw engine.
// In Claude Code's dynamic workflows the subagent IS a full Claude Code agent. Here the basic
// unit is ALSO a full coding agent — but a *pluggable* one: dispatch each agent() call to any
// real agent CLI (claude, ccz/ccd/ccq, codex/cx, cursor, …) as a child process. The agent brings
// its own tools (Bash/files/MCP), so this reproduces "subagent = full agent" faithfully and goes
// beyond raw by being vendor- and model-agnostic.
//
// Security: processes are spawned with an args ARRAY (no shell), so the prompt cannot break out.

export interface CliAgentInvocation {
  cmd: string;
  args: string[];
  /** Optional stdin payload (some agents read the prompt from stdin). */
  input?: string;
}

export interface CliAgentSpec {
  /** Build the process invocation from the request. */
  buildCommand: (req: AgentRequest) => CliAgentInvocation;
  /** Parse stdout into the result. Default: trimmed text, or extracted JSON when a schema is set. */
  parseOutput?: (stdout: string, req: AgentRequest) => unknown;
  /** Working directory (string, or per-request — e.g. a git worktree for isolation). */
  cwd?: string | ((req: AgentRequest) => string | undefined);
  env?: NodeJS.ProcessEnv;
  /** Kill the agent after this many ms. Default 300000 (5 min). */
  timeoutMs?: number;
}

/** Best-effort JSON extraction from an agent's free-form stdout (whole / fenced / first balanced). */
export function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    /* fall through */
  }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* fall through */
    }
  }
  const start = text.search(/[{[]/);
  if (start >= 0) {
    for (let end = text.length; end > start; end--) {
      try {
        return JSON.parse(text.slice(start, end));
      } catch {
        /* keep shrinking */
      }
    }
  }
  return undefined;
}

function defaultParse(stdout: string, req: AgentRequest): unknown {
  const text = stdout.trim();
  if (req.schema === undefined) return text;
  const obj = extractJson(text);
  return obj ?? text;
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export class CliAgentBackend implements AgentBackend {
  constructor(private readonly spec: CliAgentSpec) {}

  /** Introspect the exact process invocation for a request (no spawn) — useful for tests/debugging. */
  buildInvocation(req: AgentRequest): CliAgentInvocation {
    return this.spec.buildCommand(req);
  }

  async run(req: AgentRequest): Promise<AgentResponse> {
    const { cmd, args, input } = this.spec.buildCommand(req);
    const specCwd = typeof this.spec.cwd === "function" ? this.spec.cwd(req) : this.spec.cwd;
    // Honor an engine-provided cwd (e.g. a worktree from opts.isolation:'worktree').
    const cwd = specCwd ?? req.cwd;
    const { stdout } = await this._spawn(cmd, args, input, cwd);
    const output = (this.spec.parseOutput ?? defaultParse)(stdout, req);
    // CLI agents rarely report token usage; estimate deterministically from text size.
    return { output, inputTokens: estTokens(req.prompt), outputTokens: estTokens(stdout) };
  }

  private _spawn(cmd: string, args: string[], input: string | undefined, cwd: string | undefined): Promise<SpawnResult> {
    const timeoutMs = this.spec.timeoutMs ?? 300_000;
    return new Promise<SpawnResult>((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd,
        env: this.spec.env ?? process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`agent '${cmd}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        // Reject on ANY non-zero exit — a crashed agent that emitted partial stdout must not be
        // accepted as a result (that would silently journal/cache corrupt output).
        if (code === 0) {
          resolve({ stdout, stderr, code });
        } else {
          const tail = (stderr.trim() || stdout.trim()).slice(0, 500);
          reject(new Error(`agent '${cmd}' exited ${code}: ${tail}`));
        }
      });

      // A fast-exiting / non-draining agent makes stdin emit EPIPE; without this handler Node
      // would throw it as an unhandled 'error' and crash the whole orchestrator process.
      child.stdin.on("error", () => {
        /* ignore: the 'close' handler decides the outcome from the exit code */
      });
      if (input !== undefined) child.stdin.write(input);
      child.stdin.end();
    });
  }

  // ---------- presets for agent CLIs (flags verified on this host via --help) ----------

  /** Claude Code headless: `claude -p "<prompt>" [--model M] --output-format text [--bare]`.
   *  Flags verified against official docs (code.claude.com/docs/en/cli-reference). `bare:true`
   *  adds `--bare` (skip hooks/MCP/skills/CLAUDE.md) — recommended for clean scripted/CI runs. */
  static claude(o?: { model?: string; bare?: boolean; extraArgs?: string[]; timeoutMs?: number; cwd?: string }): CliAgentBackend {
    return new CliAgentBackend({
      buildCommand: (req) => {
        const model = req.model ?? o?.model;
        return {
          cmd: "claude",
          args: [
            "-p",
            req.prompt,
            ...(model ? ["--model", model] : []),
            "--output-format",
            "text",
            ...(o?.bare ? ["--bare"] : []),
            ...(o?.extraArgs ?? []),
          ],
        };
      },
      ...(o?.cwd !== undefined ? { cwd: o.cwd } : {}),
      timeoutMs: o?.timeoutMs ?? 300_000,
    });
  }

  /** Free Claude-Code-compatible worker wrappers (ccz/ccd/ccq), per the orchestration playbook
   *  (`ccz -p --dangerously-skip-permissions "<prompt>"`). Use only for low-risk worker tasks.
   *  Set `dangerouslySkipPermissions:false` to omit the flag (e.g. in an already-guarded environment). */
  static worker(bin: "ccz" | "ccd" | "ccq", o?: { model?: string; timeoutMs?: number; cwd?: string; dangerouslySkipPermissions?: boolean; extraArgs?: string[] }): CliAgentBackend {
    return new CliAgentBackend({
      buildCommand: (req) => {
        // req.model is the POOL ROUTING LABEL (matched against route.match in PoolBackend), NOT a CLI
        // model name. The cc-family wrappers fix their model via env; forwarding req.model as --model
        // sends an invalid model (e.g. `--model ccz` → API 400 "Unknown Model"). Only an explicit
        // o.model overrides — route via req.agentType so the routing label never reaches the CLI.
        const skipPerms = o?.dangerouslySkipPermissions ?? true;
        return {
          cmd: bin,
          args: [
            "-p",
            ...(skipPerms ? ["--dangerously-skip-permissions"] : []),
            ...(o?.extraArgs ?? []),
            req.prompt,
            ...(o?.model ? ["--model", o.model] : []),
          ],
        };
      },
      ...(o?.cwd !== undefined ? { cwd: o.cwd } : {}),
      timeoutMs: o?.timeoutMs ?? 300_000,
    });
  }

  /** OpenAI Codex CLI: `codex exec --skip-git-repo-check -s <sandbox> [-m M] "<prompt>"` — the final
   *  message prints to stdout. Flags verified against the LOCAL `codex exec --help` (note: this
   *  version has no `--ask-for-approval`; `--output-schema` takes a FILE, not inline JSON — pass it
   *  via `extraArgs` with a schema file). `bypass:true` adds `--dangerously-bypass-approvals-and-sandbox`
   *  for fully-unattended runs (no sandbox — use only in an already-sandboxed environment). */
  static codex(o?: {
    model?: string;
    sandbox?: "read-only" | "workspace-write" | "danger-full-access";
    bypass?: boolean;
    extraArgs?: string[];
    timeoutMs?: number;
    cwd?: string;
  }): CliAgentBackend {
    return new CliAgentBackend({
      buildCommand: (req) => {
        const model = req.model ?? o?.model;
        const args = ["exec", "--skip-git-repo-check"];
        if (o?.bypass) args.push("--dangerously-bypass-approvals-and-sandbox");
        else args.push("-s", o?.sandbox ?? "read-only");
        if (model) args.push("-m", model);
        if (o?.extraArgs) args.push(...o.extraArgs);
        args.push(req.prompt);
        return { cmd: "codex", args };
      },
      ...(o?.cwd !== undefined ? { cwd: o.cwd } : {}),
      timeoutMs: o?.timeoutMs ?? 300_000,
    });
  }

  /** OpenCode (sst) headless: `opencode run "<prompt>" [-m provider/model] [--agent A] [--pure]`
   *  — prints the response to stdout. Flags verified via `opencode --help`. `model` is
   *  `provider/model` form (e.g. `anthropic/claude-sonnet-4-6`); `pure:true` adds `--pure`
   *  (no external plugins, e.g. skip oh-my-opencode config for clean CI). */
  static opencode(o?: { model?: string; agent?: string; pure?: boolean; timeoutMs?: number; cwd?: string }): CliAgentBackend {
    return new CliAgentBackend({
      buildCommand: (req) => {
        const model = req.model ?? o?.model;
        return {
          cmd: "opencode",
          args: [
            "run",
            req.prompt,
            ...(model ? ["--model", model] : []),
            ...(o?.agent ? ["--agent", o.agent] : []),
            ...(o?.pure ? ["--pure"] : []),
          ],
        };
      },
      ...(o?.cwd !== undefined ? { cwd: o.cwd } : {}),
      timeoutMs: o?.timeoutMs ?? 300_000,
    });
  }

  /** Any other agent CLI (cx/cursor/local) — supply your own buildCommand. */
  static custom(spec: CliAgentSpec): CliAgentBackend {
    return new CliAgentBackend(spec);
  }
}
