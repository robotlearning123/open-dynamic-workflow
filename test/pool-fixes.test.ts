import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentBackend, AgentRequest, AgentResponse } from "../src/types.js";
import { PoolState, fileStore, httpStore } from "../src/pool-state.js";
import type { PoolStateSnapshot, StateStore } from "../src/pool-state.js";
import { PoolBackend } from "../src/pool-backend.js";
import { definePool } from "../src/pool-config.js";

// ---- helpers ----
const req = (model?: string): AgentRequest => ({ prompt: "x", agentId: "a1", ...(model !== undefined ? { model } : {}) });
const ok = (tag: string): AgentBackend => ({ run: async (): Promise<AgentResponse> => ({ output: tag, inputTokens: 0, outputTokens: 0 }) });
const fail = (msg: string): AgentBackend => ({ run: async (): Promise<AgentResponse> => { throw new Error(msg); } });

const memberState = (over: Partial<PoolStateSnapshot["members"][string]>): PoolStateSnapshot["members"][string] => ({
  rpmCount: 0, rpmWindowStart: 0, rpdCount: 0, rpdDay: new Date(0).toISOString().slice(0, 10),
  consecutiveFailures: 0, circuit: "closed", cooldownUntil: 0, access: "ok",
  latencyEwmaMs: null, qualityScore: null, inFlight: 0,
  totalRequests: 0, totalSuccess: 0, total429: 0, totalErrors: 0, ...over,
});

describe("pool review fixes", () => {
  it("#2 half-open allows only ONE concurrent probe", () => {
    let t = 0;
    const state = new PoolState(["m"], {}, { now: () => t, breakerThreshold: 1, halfOpenAfterMs: 10 });
    state.onDispatch("m");
    state.onFailure("m", {}); // 1 failure → circuit opens (threshold 1)
    expect(state.getMemberState("m").circuit).toBe("open");
    t = 100;
    state.rollWindows("m"); // cooldown elapsed + access ok → half-open
    expect(state.getMemberState("m").circuit).toBe("half-open");
    expect(state.isEligible("m")).toBe(true); // no in-flight → one probe allowed
    state.onDispatch("m"); // probe now in flight
    expect(state.isEligible("m")).toBe(false); // 2nd concurrent probe blocked
  });

  it("#1 unknown fallback name is skipped, never crashes run()", async () => {
    const state = new PoolState(["a"], {});
    const pool = new PoolBackend({
      routes: [{ name: "a", match: "x", backend: ok("A"), fallback: ["ghost-member"] }],
      default: "a", state,
    });
    await expect(pool.run(req("x"))).resolves.toMatchObject({ output: "A" });
  });

  it("circuit-open member is bypassed end-to-end; backup serves; no new dispatch to the open member", async () => {
    const t = 0;
    const state = new PoolState(["bad", "good"], {}, { now: () => t, breakerThreshold: 2, halfOpenAfterMs: 1_000_000 });
    const pool = new PoolBackend({
      routes: [
        { name: "bad", match: "x", backend: fail("boom"), priority: 10, fallback: ["good"] },
        { name: "good", match: "y", backend: ok("GOOD"), priority: 1 },
      ],
      default: "bad", state,
    });
    await pool.run(req("x")); // bad fails → falls back to good
    await pool.run(req("x")); // bad fails again → breaker trips (open)
    expect(state.getMemberState("bad").circuit).toBe("open");
    const before = state.getMemberState("bad").totalRequests;
    const r = await pool.run(req("x")); // bad open → skipped; good serves
    expect(r.output).toBe("GOOD");
    expect(state.getMemberState("bad").totalRequests).toBe(before); // open member NOT dispatched
  });

  it("#7 a denied (fatal) member stays 'open' (not half-open) after cooldown", () => {
    let t = 0;
    const state = new PoolState(["m"], {}, { now: () => t, breakerThreshold: 1 });
    state.onDispatch("m");
    state.onFailure("m", { fatal: true }); // fatal + threshold 1 → access denied AND circuit opens
    expect(state.getMemberState("m").access).toBe("denied");
    expect(state.getMemberState("m").circuit).toBe("open");
    t = 100 * 60 * 60 * 1000; // well past the 24h fatal cooldown
    state.rollWindows("m");
    expect(state.getMemberState("m").circuit).toBe("open"); // NOT half-open while denied
    expect(state.isEligible("m")).toBe(false);
  });

  it("#5 fileStore roundtrips a snapshot and returns null for a missing file", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "poolst-")), "state.json");
    const store = fileStore(path);
    expect(await store.load()).toBeNull();
    const snap: PoolStateSnapshot = { version: 1, updatedAt: 123, members: { m: memberState({ rpdCount: 7 }) } };
    await store.save(snap);
    const back = await store.load();
    expect(back?.updatedAt).toBe(123);
    expect(back?.members["m"]?.rpdCount).toBe(7);
  });

  it("#5 httpStore GETs/PUTs via injected fetch and returns null on non-ok GET", async () => {
    const methods: string[] = [];
    const snap: PoolStateSnapshot = { version: 1, updatedAt: 7, members: {} };
    const fetchOk = (async (_url: unknown, init?: { method?: string }) => {
      const m = init?.method ?? "GET";
      methods.push(m);
      return new Response(m === "GET" ? JSON.stringify(snap) : "", { status: 200 });
    }) as unknown as typeof fetch;
    const store = httpStore({ getUrl: "http://x/get", putUrl: "http://x/put", fetchImpl: fetchOk });
    expect((await store.load())?.updatedAt).toBe(7);
    await store.save(snap);
    expect(methods).toContain("PUT");

    const fetch500 = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    const store2 = httpStore({ getUrl: "http://x", putUrl: "http://x", fetchImpl: fetch500 });
    expect(await store2.load()).toBeNull();
  });

  it("#4 PoolBackend.ready awaits the warm-start before the first run()", async () => {
    let t = 0;
    const state = new PoolState(["w"], { w: { rpd: 1000 } }, { now: () => t });
    const snap: PoolStateSnapshot = {
      version: 1, updatedAt: 0,
      members: { w: memberState({ rpdCount: 5, totalRequests: 5, totalSuccess: 5 }) },
    };
    const store: StateStore = { async load() { return snap; }, async save() { /* noop */ } };
    const ready = store.load().then((s) => { if (s !== null) state.loadSnapshot(s); });
    const pool = new PoolBackend({ routes: [{ name: "w", match: "w", backend: ok("W") }], default: "w", state, store, ready });
    expect(state.getMemberState("w").rpdCount).toBe(0); // not yet loaded
    await pool.ready;
    expect(state.getMemberState("w").rpdCount).toBe(5); // persisted same-day rpd restored
    void t;
  });

  it("#5 definePool http member round-robins envKeys (through definePool, fake fetch)", async () => {
    process.env["KA"] = "keyA";
    process.env["KB"] = "keyB";
    const auths: string[] = [];
    const fakeFetch = (async (_url: unknown, init?: { headers?: Headers }) => {
      auths.push(init?.headers?.get("Authorization") ?? "");
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const pool = definePool({
      default: "h",
      members: [{ name: "h", match: "h", agent: "http", url: "http://x/v1/chat/completions", envKeys: ["KA", "KB"], fetchImpl: fakeFetch }],
    });
    await pool.run(req("h"));
    await pool.run(req("h"));
    await pool.run(req("h"));
    expect(auths).toEqual(["Bearer keyA", "Bearer keyB", "Bearer keyA"]); // counter-based round-robin
    delete process.env["KA"];
    delete process.env["KB"];
  });
});
