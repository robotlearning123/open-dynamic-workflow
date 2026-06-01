import { describe, it, expect } from "vitest";
import type { AgentBackend, AgentRequest, AgentResponse } from "../src/types.js";
import { PoolState } from "../src/pool-state.js";
import type { PoolMemberSpec } from "../src/pool-config.js";
import { poolTelemetry, suggestTuning, agenticTune, applyTuning } from "../src/pool-manager.js";
import type { MemberTelemetry } from "../src/pool-manager.js";

const tel = (over: Partial<MemberTelemetry> & { name: string }): MemberTelemetry => ({
  circuit: "closed", access: "ok", inFlight: 0, totalRequests: 0, totalSuccess: 0,
  total429: 0, totalErrors: 0, errorRate: 0, latencyEwmaMs: null, qualityScore: null,
  cooldownActive: false, ...over,
});

describe("pool-manager (Phase 3 — control plane)", () => {
  it("poolTelemetry summarizes per-member state read-only", () => {
    let t = 0;
    const state = new PoolState(["a", "b"], {}, { now: () => t, breakerThreshold: 99 });
    state.onDispatch("a"); state.onSuccess("a", 100);
    state.onDispatch("b"); state.onFailure("b", { is429: true });
    const out = poolTelemetry(state, () => t);
    const a = out.find((m) => m.name === "a")!;
    const b = out.find((m) => m.name === "b")!;
    expect(a.errorRate).toBe(0);
    expect(a.latencyEwmaMs).toBe(100);
    expect(b.total429).toBe(1);
    expect(b.errorRate).toBe(1);
  });

  it("suggestTuning: denied→disable, high-error→deprioritize, low-quality→deprioritize, healthy→keep", () => {
    const actions = suggestTuning([
      tel({ name: "denied", access: "denied", totalRequests: 5, totalErrors: 5, errorRate: 1 }),
      tel({ name: "flaky", totalRequests: 10, total429: 8, errorRate: 0.8 }),
      tel({ name: "lowq", qualityScore: 0.2 }),
      tel({ name: "good", totalRequests: 5, totalSuccess: 5, qualityScore: 0.9 }),
    ]);
    const by = Object.fromEntries(actions.map((a) => [a.member, a.action]));
    expect(by["denied"]).toBe("disable");
    expect(by["flaky"]).toBe("deprioritize");
    expect(by["lowq"]).toBe("deprioritize");
    expect(by["good"]).toBe("keep");
  });

  it("applyTuning is a pure transform: disable drops + cleans fallbacks, ±priority shifts", () => {
    const members: PoolMemberSpec[] = [
      { name: "a", match: "x", agent: "mock", priority: 50, fallback: ["b", "c"] },
      { name: "b", match: "x", agent: "mock", priority: 10 },
      { name: "c", match: "x", agent: "mock", priority: 5 },
    ];
    const out = applyTuning(members, [
      { member: "a", action: "deprioritize", reason: "" },
      { member: "b", action: "disable", reason: "" },
      { member: "c", action: "prioritize", reason: "" },
    ]);
    expect(out.map((m) => m.name)).toEqual(["a", "c"]); // b disabled (dropped)
    const a = out.find((m) => m.name === "a")!;
    expect(a.priority).toBe(40);
    expect(a.fallback).toEqual(["c"]); // "b" removed from fallback
    expect(out.find((m) => m.name === "c")!.priority).toBe(15);
    // input not mutated
    expect(members.find((m) => m.name === "a")!.priority).toBe(50);
    expect(members.find((m) => m.name === "a")!.fallback).toEqual(["b", "c"]);
  });

  it("agenticTune parses structured actions and passes the pool-manager agentType + schema", async () => {
    let seen: AgentRequest | undefined;
    const tuner: AgentBackend = {
      run: async (req): Promise<AgentResponse> => {
        seen = req;
        return { output: { actions: [{ member: "a", action: "keep", reason: "ok" }] }, inputTokens: 1, outputTokens: 1 };
      },
    };
    const acts = await agenticTune([tel({ name: "a" })], tuner);
    expect(acts).toEqual([{ member: "a", action: "keep", reason: "ok" }]);
    expect(seen?.agentType).toBe("pool-manager");
    expect(seen?.schema).toBeDefined();
  });

  it("agenticTune returns [] when the backend yields an unexpected shape", async () => {
    const bad: AgentBackend = { run: async (): Promise<AgentResponse> => ({ output: "not an object", inputTokens: 0, outputTokens: 0 }) };
    expect(await agenticTune([], bad)).toEqual([]);
  });
});
