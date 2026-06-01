import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { Meta, RunConfig, RunResult } from "./types.js";
import { createContext, makeGlobals } from "./primitives.js";

// ---------- exact sandbox error messages from ANALYSIS §9 ----------

const DATE_MSG =
  "Date.now() / new Date() are unavailable in workflow scripts (breaks resume). " +
  "Stamp results after the workflow returns, or pass timestamps via args.";

const RANDOM_MSG =
  "Math.random() is unavailable in workflow scripts (breaks resume). " +
  "For N independent samples, include the index in the agent label or prompt.";

// ---------- SAFE_DATE ----------

// We need a constructor that:
//   - new SafeDate()          → throws DATE_MSG
//   - new SafeDate(arg)       → delegates to real Date
//   - SafeDate.now()          → throws DATE_MSG
//   - SafeDate.parse / .UTC   → delegates to real Date

// Using a regular function so `new` works without class syntax.
const _RealDate = Date;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _SafeDateConstructor(this: unknown, ...args: unknown[]): Date {
  if (args.length === 0) {
    throw new Error(DATE_MSG);
  }
  // When called with `new`, we need to return a real Date.
  // new.target is set, so we delegate by constructing a real Date.
  return new (_RealDate as unknown as new (...a: unknown[]) => Date)(...args);
}

_SafeDateConstructor.now = (): number => {
  throw new Error(DATE_MSG);
};
_SafeDateConstructor.parse = _RealDate.parse.bind(_RealDate);
_SafeDateConstructor.UTC = _RealDate.UTC.bind(_RealDate);
_SafeDateConstructor.prototype = _RealDate.prototype;

// ---------- SAFE_MATH ----------

// Math methods are not enumerable own properties — spread copies nothing useful.
// Use getOwnPropertyDescriptors to replicate all properties, then override random.
const SAFE_MATH: typeof Math = Object.create(
  null,
  Object.getOwnPropertyDescriptors(Math),
) as typeof Math;
// Override random to throw.
Object.defineProperty(SAFE_MATH, "random", {
  value(): number {
    throw new Error(RANDOM_MSG);
  },
  writable: true,
  enumerable: false,
  configurable: true,
});

// ---------- parseMeta ----------

// Offset-preserving copy of `src` with comments, regex literals, AND the contents of string/template literals
// replaced by whitespace (delimiters + length kept), so we can locate and brace-balance the meta
// declaration without matching text or counting braces inside comments or literals (the real literal
// is sliced from the ORIGINAL source).
function blankNonCode(src: string): string {
  let out = "";
  let i = 0;
  let prevSig: string | null = null;
  let token = "";
  let prevToken: string | null = null;
  const regexPrefixKeywords = new Set(["await", "case", "delete", "else", "in", "instanceof", "of", "return", "throw", "typeof", "void", "yield"]);
  const finishToken = (): void => {
    if (token) {
      prevToken = token;
      token = "";
    }
  };
  const noteCode = (c: string): void => {
    if (/[A-Za-z0-9_$]/.test(c)) {
      token += c;
      prevSig = c;
      return;
    }
    if (/\s/.test(c)) {
      finishToken();
      return;
    }
    finishToken();
    prevSig = c;
  };
  const canStartRegex = (): boolean =>
    prevSig === null || "([{=,:;!&|?+-*~^<>".includes(prevSig) || (prevToken !== null && regexPrefixKeywords.has(prevToken));

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    // string / template literal — keep the delimiters, blank the contents (escapes handled uniformly).
    if (ch === '"' || ch === "'" || ch === "`") {
      out += ch;
      i++;
      while (i < src.length) {
        const c = src[i];
        if (c === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (c === ch) {
          out += ch;
          i++;
          break;
        }
        out += c === "\n" ? "\n" : " ";
        i++;
      }
      prevSig = ")";
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < src.length) {
        out += "  ";
        i += 2;
      }
      continue;
    }
    if (ch === "/" && canStartRegex()) {
      out += "/";
      i++;
      let inClass = false;
      while (i < src.length) {
        const c = src[i];
        if (c === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (c === "\n" || c === "\r") {
          break;
        }
        if (c === "[") inClass = true;
        if (c === "]") inClass = false;
        if (c === "/" && !inClass) {
          out += "/";
          i++;
          while (i < src.length && /[A-Za-z]/.test(src[i]!)) {
            out += " ";
            i++;
          }
          prevSig = ")";
          break;
        }
        out += " ";
        i++;
      }
      continue;
    }
    out += ch;
    noteCode(ch);
    i++;
  }
  return out;
}

/**
 * Extract the object literal after `export const meta =` by balancing braces (respecting string
 * literals AND comments), then evaluate it in a minimal vm sandbox. Throws if name/description missing.
 */
export function parseMeta(source: string): Meta {
  // Locate + balance on a copy with comments + string/template contents blanked (offsets preserved);
  // slice the real literal from the original source.
  const scan = blankNonCode(source);
  const match = scan.match(/export\s+const\s+meta\s*=/);
  if (match === null || match.index === undefined) {
    throw new Error("parseMeta: no 'export const meta =' found in source");
  }

  const afterEq = match.index + match[0].length;

  // Skip whitespace to find the opening brace.
  let i = afterEq;
  while (i < scan.length && scan[i] !== "{") i++;
  if (i >= scan.length) {
    throw new Error("parseMeta: no opening brace after 'export const meta ='");
  }

  // Balance braces, respecting string literals and escape sequences (on the blanked copy).
  let depth = 0;
  let inStr: string | null = null;
  let end = i;

  while (end < scan.length) {
    const ch = scan[end];
    if (inStr !== null) {
      // Inside a string — only care about escapes and the closing quote.
      if (ch === "\\" && inStr !== "`") {
        // Skip the escaped character.
        end++;
      } else if (ch === inStr) {
        inStr = null;
      } else if (inStr === "`" && ch === "$" && scan[end + 1] === "{") {
        // Template literal interpolation — treat as nested braces; skip for simplicity.
        // This is a best-effort parser; complex template literals may not parse correctly.
        end++;
      }
    } else {
      if (ch === '"' || ch === "'" || ch === "`") {
        inStr = ch;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    end++;
  }

  if (depth !== 0) {
    throw new Error("parseMeta: unbalanced braces in meta literal");
  }

  const literal = source.slice(i, end + 1);

  // Evaluate the object literal in a minimal vm sandbox.
  const sandboxCtx = vm.createContext({});
  let meta: unknown;
  try {
    meta = vm.runInContext("(" + literal + ")", sandboxCtx);
  } catch (e) {
    throw new Error("parseMeta: failed to evaluate meta literal: " + String(e));
  }

  if (meta === null || typeof meta !== "object") {
    throw new Error("parseMeta: meta is not an object");
  }
  const m = meta as Record<string, unknown>;
  if (typeof m["name"] !== "string" || m["name"].length === 0) {
    throw new Error("parseMeta: meta.name is required and must be a non-empty string");
  }
  if (typeof m["description"] !== "string" || m["description"].length === 0) {
    throw new Error("parseMeta: meta.description is required and must be a non-empty string");
  }

  return meta as Meta;
}

// ---------- runWorkflow ----------

/**
 * Deterministic runId derived from source + args — uses sha256, no Date/random.
 * Prefix "wf_" + first 12 hex chars.
 */
function deriveRunId(source: string, args: unknown): string {
  const payload = source + JSON.stringify(args ?? null);
  const digest = createHash("sha256").update(payload, "utf8").digest("hex");
  return "wf_" + digest.slice(0, 12);
}

/**
 * Strip a leading `export ` (allowing indentation) from `export const/let/var`,
 * `export function/class`, and `export async function` so the source can run as a function body.
 * `export default` is NOT supported in workflow scripts (use a top-level `return`); it is left
 * intact so it fails loudly rather than silently mis-stripping.
 */
function stripExports(source: string): string {
  return source.replace(/^[ \t]*export\s+(?!default\b)/gm, "");
}

/**
 * Compile + run a workflow `source` string inside a `node:vm` context seeded with the given workflow
 * `globals` plus the safe built-ins (SAFE_MATH / SAFE_DATE; no require/process/fetch). Shared by the
 * top-level runWorkflow AND the nested workflow() primitive, so CHILD workflows get the SAME
 * determinism sandbox (Date.now()/Math.random() blocked) — previously the nested path used a host-realm
 * `new Function`, which silently broke resume determinism. SECURITY: node:vm is NOT a containment
 * boundary (a script can reach `process` via `.constructor`); run only TRUSTED source. See SECURITY.md.
 */
export async function runInSandbox(source: string, globals: Record<string, unknown>): Promise<unknown> {
  const sandboxObj: Record<string, unknown> = {
    ...globals,
    JSON,
    Math: SAFE_MATH,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Promise,
    Map,
    Set,
    console,
    Date: _SafeDateConstructor,
    globalThis: {},
  };
  const context = vm.createContext(sandboxObj);
  const body = stripExports(source);
  const fnSrc = "(async function(){\n" + body + "\n})";
  let fn: () => Promise<unknown>;
  try {
    fn = vm.runInContext(fnSrc, context) as () => Promise<unknown>;
  } catch (e) {
    throw new Error("runWorkflow: failed to compile workflow: " + String(e));
  }
  return fn();
}

export async function runWorkflow(source: string, cfg: RunConfig): Promise<RunResult> {
  const runId = cfg.runId ?? deriveRunId(source, cfg.args);
  // Default workflow() resolver: read a {scriptPath} (or bare path) file from disk so nested
  // workflows work out of the box (mirrors the real tool accepting {scriptPath}).
  const workflowResolver =
    cfg.workflowResolver ??
    (async (ref: string | { scriptPath: string }): Promise<string> => {
      // string ref → look up the named-workflow registry first, else treat as a path.
      const path = typeof ref === "string" ? (cfg.workflows?.[ref] ?? ref) : ref.scriptPath;
      return readFileSync(path, "utf8");
    });
  const ctx = createContext({ ...cfg, runId, workflowResolver });
  const { journal } = ctx;
  const globals = makeGlobals(ctx);

  // Build the vm context: the injected workflow globals + a few host built-ins, plus SAFE_MATH /
  // SAFE_DATE overrides that reproduce the real engine's Date/Math blocking, and no require/process/
  // fetch in scope. SECURITY: node:vm is NOT a security boundary — any injected host object/function
  // (console, the globals, even `agent`) exposes the host realm's Function via `.constructor`, so a
  // workflow script can reach `process`. Run only TRUSTED workflow source (same as the real engine,
  // where Claude authors the script). The Date/Math/require shaping below is ergonomic + fidelity,
  // not a containment guarantee. See SECURITY.md.
  const result = await runInSandbox(source, globals as unknown as Record<string, unknown>);
  journal.flush();

  return {
    result,
    runId,
    journalPath: journal.path,
    agentCount: ctx.state.agentCount,
    tokensSpent: ctx.state.tokensSpent,
  };
}

// ---------- runWorkflowFile ----------

export async function runWorkflowFile(path: string, cfg: RunConfig): Promise<RunResult> {
  const source = readFileSync(path, "utf8");
  // Default runId derived from file source + args (deterministic, no Date).
  const resolvedCfg: RunConfig = {
    ...cfg,
    runId: cfg.runId ?? deriveRunId(source, cfg.args),
  };
  return runWorkflow(source, resolvedCfg);
}
