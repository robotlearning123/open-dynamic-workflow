/**
 * pool-manager.ts — Phase 3: the agentic control plane (opt-in, low-frequency).
 *
 * Reads the deterministic scheduler's live telemetry, decides tuning actions
 * (deterministically, or via an LLM "manager"), and RE-AUTHORS the pool config
 * (a pure PoolMemberSpec[] transform). Apply by feeding the new spec back to
 * definePool() — no engine changes, no mutation of a running scheduler.
 *
 * The loop: poolTelemetry(state) → suggestTuning | agenticTune → applyTuning(members)
 *           → definePool({ ...opts, members }) → repeat.
 *
 * "Who manages the manager": run agenticTune on a paid/strong backend (Opus/GPT),
 * never on the free pool it is tuning.
 */

import { PoolState } from "./pool-state.js";
import type { PoolMemberSpec } from "./pool-config.js";
import type { AgentBackend, JsonSchema } from "./types.js";

// ---------- telemetry ----------

export interface MemberTelemetry {
  name: string;
  circuit: "closed" | "open" | "half-open";
  access: "ok" | "denied";
  inFlight: number;
  totalRequests: number;
  totalSuccess: number;
  total429: number;
  totalErrors: number;
  /** (total429 + totalErrors) / totalRequests, or 0 when no requests yet. */
  errorRate: number;
  latencyEwmaMs: number | null;
  qualityScore: number | null;
  cooldownActive: boolean;
}

/** Snapshot per-member telemetry from a PoolState (read-only). */
export function poolTelemetry(state: PoolState, now: () => number = () => Date.now()): MemberTelemetry[] {
  const t = now();
  return state.memberNames.map((name) => {
    const s = state.getMemberState(name);
    const failures = s.total429 + s.totalErrors;
    return {
      name,
      circuit: s.circuit,
      access: s.access,
      inFlight: s.inFlight,
      totalRequests: s.totalRequests,
      totalSuccess: s.totalSuccess,
      total429: s.total429,
      totalErrors: s.totalErrors,
      errorRate: s.totalRequests > 0 ? failures / s.totalRequests : 0,
      latencyEwmaMs: s.latencyEwmaMs,
      qualityScore: s.qualityScore,
      cooldownActive: t < s.cooldownUntil,
    };
  });
}

// ---------- tuning actions ----------

export interface TuningAction {
  member: string;
  action: "disable" | "deprioritize" | "prioritize" | "keep";
  reason: string;
}

export interface SuggestOptions {
  /** errorRate at/above which a member is deprioritized. Default 0.5. */
  errorRateThreshold?: number;
  /** Minimum requests before error-rate is trusted. Default 3. */
  minRequests?: number;
  /** qualityScore below which a member is deprioritized. Default 0.4. */
  minQuality?: number;
}

/**
 * Deterministic tuning heuristics (no LLM): denied → disable; high error rate or
 * low quality → deprioritize; otherwise keep.
 */
export function suggestTuning(telemetry: MemberTelemetry[], opts: SuggestOptions = {}): TuningAction[] {
  const errTh = opts.errorRateThreshold ?? 0.5;
  const minReq = opts.minRequests ?? 3;
  const minQ = opts.minQuality ?? 0.4;
  return telemetry.map((m): TuningAction => {
    if (m.access === "denied") return { member: m.name, action: "disable", reason: "access denied (401/403/404)" };
    if (m.totalRequests >= minReq && m.errorRate >= errTh) {
      return { member: m.name, action: "deprioritize", reason: `error rate ${(m.errorRate * 100).toFixed(0)}% over ${m.totalRequests} reqs` };
    }
    if (m.qualityScore !== null && m.qualityScore < minQ) {
      return { member: m.name, action: "deprioritize", reason: `low quality score ${m.qualityScore}` };
    }
    return { member: m.name, action: "keep", reason: "healthy" };
  });
}

// ---------- agentic tuning (opt-in LLM) ----------

const TUNING_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          member: { type: "string" },
          action: { type: "string", enum: ["disable", "deprioritize", "prioritize", "keep"] },
          reason: { type: "string" },
        },
        required: ["member", "action", "reason"],
      },
    },
  },
  required: ["actions"],
};

/**
 * Ask a STRONG backend (Opus/GPT — never the free pool) to decide tuning actions
 * from telemetry. Returns the parsed actions (empty array if the backend returns
 * an unexpected shape).
 */
export async function agenticTune(telemetry: MemberTelemetry[], tuner: AgentBackend): Promise<TuningAction[]> {
  const prompt =
    `You manage a pool of free/cheap model workers. Given per-member telemetry, decide a tuning action ` +
    `for each member: "disable" (broken/denied), "deprioritize" (flaky/slow/low-quality), "prioritize" ` +
    `(reliable & fast), or "keep". Be conservative — only disable on clear access loss.\n\n` +
    `TELEMETRY:\n${JSON.stringify(telemetry, null, 2)}\n\n` +
    `Return JSON {"actions": [{"member","action","reason"}]}.`;
  const resp = await tuner.run({ prompt, schema: TUNING_SCHEMA, agentId: "pool-manager", agentType: "pool-manager" });
  const out = resp.output;
  if (out !== null && typeof out === "object" && "actions" in out) {
    const actions = (out as { actions: unknown }).actions;
    if (Array.isArray(actions)) return actions as TuningAction[];
  }
  return [];
}

// ---------- apply (re-author the config) ----------

/**
 * Apply tuning actions to a pool config spec — a PURE transform (returns a new
 * member array; the input is not mutated). `disable` drops the member and removes
 * it from other members' `fallback` lists; `deprioritize`/`prioritize` shift priority
 * by ±10; `keep` leaves it. Feed the result back to definePool().
 */
export function applyTuning(members: PoolMemberSpec[], actions: TuningAction[]): PoolMemberSpec[] {
  const action = new Map(actions.map((a) => [a.member, a.action]));
  const disabled = new Set(actions.filter((a) => a.action === "disable").map((a) => a.member));

  const out: PoolMemberSpec[] = [];
  for (const m of members) {
    if (disabled.has(m.name)) continue;
    let priority = m.priority ?? 0;
    const act = action.get(m.name);
    if (act === "deprioritize") priority -= 10;
    else if (act === "prioritize") priority += 10;
    const fallback = m.fallback?.filter((f) => !disabled.has(f));
    out.push({ ...m, priority, ...(fallback !== undefined ? { fallback } : {}) });
  }
  return out;
}
