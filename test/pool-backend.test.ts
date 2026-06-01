/**
 * Tests for pool-backend.ts — PoolScheduler, PoolBackend, classifyError.
 *
 * All tests use MockBackend and injected `now` clocks so no real network/LLM.
 */

import { describe, it, expect } from "vitest";
import { MockBackend } from "../src/backend.js";
import type { AgentBackend, AgentRequest, AgentResponse } from "../src/types.js";
import { PoolState } from "../src/pool-state.js";
import { memoryStore } from "../src/pool-state.js";
import {
  PoolScheduler,
  PoolBackend,
  classifyError,
} from "../src/pool-backend.js";
import type { PoolRoute } from "../src/pool-backend.js";

// ---------- helpers ----------

function makeReq(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return {
    prompt: "test prompt",
    agentId: "agent-1",
    ...overrides,
  };
}

function makeRoutes(): PoolRoute[] {
  return [
    { name: "primary", match: ["worker", "glm"], backend: new MockBackend(), priority: 50, rpm: 10, rpd: 100, concurrency: 4 },
    { name: "secondary", match: "secondary", backend: new MockBackend(), priority: 30 },
    { name: "fallback", match: "fallback-only", backend: new MockBackend(), priority: 10 },
  ];
}

function makeState(routes: PoolRoute[], now?: () => number): PoolState {
  const names = routes.map((r) => r.name);
  const limits: Record<string, { rpm?: number; rpd?: number; concurrency?: number; priority?: number }> = {};
  for (const r of routes) {
    limits[r.name] = {
      rpm: r.rpm,
      rpd: r.rpd,
      concurrency: r.concurrency,
      priority: r.priority,
    };
  }
  return new PoolState(names, limits, { now });
}

// ---------- classifyError ----------

describe("classifyError", () => {
  it("classifies 429 error as is429+retryable", () => {
    const result = classifyError(new Error("HTTP 429 Too Many Requests"));
    expect(result.is429).toBe(true);
    expect(result.retryable).toBe(true);
    expect(result.fatal).toBe(false);
  });

  it("classifies 'rate limit' as is429+retryable", () => {
    const result = classifyError(new Error("rate limit exceeded"));
    expect(result.is429).toBe(true);
    expect(result.retryable).toBe(true);
  });

  it("classifies 'Too Many Requests' as is429", () => {
    const result = classifyError(new Error("Too Many Requests"));
    expect(result.is429).toBe(true);
  });

  it("parses Retry-After seconds from error message", () => {
    const result = classifyError(new Error("429 Retry-After: 30 seconds"));
    expect(result.is429).toBe(true);
    expect(result.retryAfterMs).toBe(30_000);
  });

  it("classifies 401 as fatal", () => {
    const result = classifyError(new Error("401 Unauthorized"));
    expect(result.fatal).toBe(true);
    expect(result.retryable).toBe(false);
    expect(result.is429).toBe(false);
  });

  it("classifies 403 as fatal", () => {
    const result = classifyError(new Error("403 Forbidden"));
    expect(result.fatal).toBe(true);
  });

  it("classifies 404 as fatal", () => {
    const result = classifyError(new Error("HTTP 404 not found"));
    expect(result.fatal).toBe(true);
  });

  it("classifies access denied as fatal", () => {
    const result = classifyError(new Error("access denied"));
    expect(result.fatal).toBe(true);
    expect(result.retryable).toBe(false);
  });

  it("defaults unknown errors to retryable, not fatal, not 429", () => {
    const result = classifyError(new Error("unexpected server error"));
    expect(result.retryable).toBe(true);
    expect(result.fatal).toBe(false);
    expect(result.is429).toBe(false);
  });

  it("handles non-Error values", () => {
    const result = classifyError("some string error");
    expect(result.retryable).toBe(true);
    expect(result.is429).toBe(false);
    expect(result.fatal).toBe(false);
  });

  it("classifies ratelimit (no space) as 429", () => {
    const result = classifyError(new Error("ratelimit hit"));
    expect(result.is429).toBe(true);
  });
});

// ---------- PoolScheduler.resolveCandidates ----------

describe("PoolScheduler.resolveCandidates", () => {
  it("matches req.model against route match labels", () => {
    const routes = makeRoutes();
    const state = makeState(routes);
    const sched = new PoolScheduler({ routes, default: "fallback", state });
    const candidates = sched.resolveCandidates(makeReq({ model: "worker" }));
    expect(candidates).toContain("primary");
  });

  it("matches req.agentType against route match labels", () => {
    const routes = makeRoutes();
    const state = makeState(routes);
    const sched = new PoolScheduler({ routes, default: "fallback", state });
    const candidates = sched.resolveCandidates(makeReq({ agentType: "glm" }));
    expect(candidates).toContain("primary");
  });

  it("falls back to default route when no labels match", () => {
    const routes = makeRoutes();
    const state = makeState(routes);
    const sched = new PoolScheduler({ routes, default: "fallback", state });
    const candidates = sched.resolveCandidates(makeReq({ model: "unknown-model" }));
    expect(candidates).toEqual(["fallback"]);
  });

  it("returns empty array when nothing matches and default is not a valid route", () => {
    const routes = makeRoutes();
    const state = makeState(routes);
    const sched = new PoolScheduler({ routes, default: "nonexistent", state });
    const candidates = sched.resolveCandidates(makeReq({ model: "unknown-model" }));
    expect(candidates).toEqual([]);
  });

  it("sorts by priority descending", () => {
    const routes: PoolRoute[] = [
      { name: "low", match: "shared", backend: new MockBackend(), priority: 10 },
      { name: "high", match: "shared", backend: new MockBackend(), priority: 90 },
      { name: "mid", match: "shared", backend: new MockBackend(), priority: 50 },
    ];
    const state = makeState(routes);
    const sched = new PoolScheduler({ routes, default: "low", state });
    const candidates = sched.resolveCandidates(makeReq({ model: "shared" }));
    expect(candidates[0]).toBe("high");
    expect(candidates[1]).toBe("mid");
    expect(candidates[2]).toBe("low");
  });

  it("breaks priority ties by inFlight (lower first)", () => {
    const routes: PoolRoute[] = [
      {
        name: "busy",
        match: "shared",
        backend: new MockBackend({ delayMs: 50 }),
        priority: 50,
      },
      { name: "idle", match: "shared", backend: new MockBackend(), priority: 50 },
    ];
    const state = makeState(routes);
    // Manually simulate inFlight on "busy"
    state.rollWindows("busy");
    state.onDispatch("busy"); // inFlight = 1
    const sched = new PoolScheduler({ routes, default: "idle", state });
    const candidates = sched.resolveCandidates(makeReq({ model: "shared" }));
    // idle should come first (lower inFlight)
    expect(candidates[0]).toBe("idle");
  });
});

// ---------- PoolScheduler.pick ----------

describe("PoolScheduler.pick", () => {
  it("returns the highest-priority eligible member", () => {
    const routes: PoolRoute[] = [
      { name: "a", match: "shared", backend: new MockBackend(), priority: 90 },
      { name: "b", match: "shared", backend: new MockBackend(), priority: 10 },
    ];
    const state = makeState(routes);
    const sched = new PoolScheduler({ routes, default: "a", state });
    const picked = sched.pick(makeReq({ model: "shared" }));
    expect(picked).toBe("a");
  });

  it("skips ineligible members (access denied)", () => {
    const routes: PoolRoute[] = [
      { name: "denied", match: "shared", backend: new MockBackend(), priority: 90 },
      { name: "ok", match: "shared", backend: new MockBackend(), priority: 10 },
    ];
    const state = makeState(routes);
    // Mark "denied" as access denied via a fatal failure
    state.onDispatch("denied");
    state.onFailure("denied", { fatal: true });

    const sched = new PoolScheduler({ routes, default: "ok", state });
    const picked = sched.pick(makeReq({ model: "shared" }));
    expect(picked).toBe("ok");
  });

  it("returns null when no eligible candidates exist", () => {
    // Exhaust inFlight via onDispatch (concurrency limit = Infinity by default, so use rpd)
    const limitedRoutes: PoolRoute[] = [
      { name: "a", match: "shared", backend: new MockBackend(), rpd: 1 },
    ];
    const limitedState = makeState(limitedRoutes);
    limitedState.onDispatch("a"); // rpdCount = 1, at limit
    const sched = new PoolScheduler({ routes: limitedRoutes, default: "a", state: limitedState });
    // Request to same member — should be ineligible
    const picked = sched.pick(makeReq({ model: "shared" }));
    expect(picked).toBeNull();
  });
});

// ---------- PoolBackend.run ----------

describe("PoolBackend.run — success path", () => {
  it("forwards request to the backend and returns the response", async () => {
    const routes = makeRoutes();
    const state = makeState(routes);
    const backend = new PoolBackend({ routes, default: "primary", state });
    const resp = await backend.run(makeReq({ model: "worker" }));
    expect(typeof resp.output).toBe("string");
    expect(resp.inputTokens).toBeGreaterThan(0);
    expect(resp.outputTokens).toBeGreaterThan(0);
  });

  it("updates state on success (inFlight back to 0, totalSuccess incremented)", async () => {
    const routes = makeRoutes();
    const state = makeState(routes);
    const backend = new PoolBackend({ routes, default: "primary", state });
    await backend.run(makeReq({ model: "worker" }));
    const ms = state.getMemberState("primary");
    expect(ms.inFlight).toBe(0);
    expect(ms.totalSuccess).toBe(1);
    expect(ms.totalRequests).toBe(1);
  });

  it("flushes state to store on success", async () => {
    const routes = makeRoutes();
    const state = makeState(routes);
    const store = memoryStore();
    const backend = new PoolBackend({ routes, default: "primary", state, store });
    await backend.run(makeReq({ model: "worker" }));
    // Allow the async save to settle
    await new Promise<void>((res) => setTimeout(res, 10));
    const saved = await store.load();
    expect(saved).not.toBeNull();
    expect(saved!.members["primary"].totalSuccess).toBe(1);
  });
});

describe("PoolBackend.run — failure and fallback", () => {
  it("falls through to next candidate on transient failure", async () => {
    const failBackend: AgentBackend = {
      async run(_req: AgentRequest): Promise<AgentResponse> {
        throw new Error("temporary network error");
      },
    };
    const successBackend = new MockBackend({
      responder: () => "fallback result",
    });

    const routes: PoolRoute[] = [
      { name: "a", match: "shared", backend: failBackend, priority: 90 },
      { name: "b", match: "shared", backend: successBackend, priority: 10 },
    ];
    const state = makeState(routes);
    const backend = new PoolBackend({ routes, default: "b", state });

    const resp = await backend.run(makeReq({ model: "shared" }));
    expect(resp.output).toBe("fallback result");
  });

  it("tries fallback names declared in route.fallback", async () => {
    const failBackend: { run: (req: AgentRequest) => Promise<AgentResponse> } = {
      async run(_req: AgentRequest): Promise<AgentResponse> {
        throw new Error("primary failed");
      },
    };
    const fallbackBackend = new MockBackend({ responder: () => "from-fallback" });

    const routes: PoolRoute[] = [
      { name: "primary", match: "shared", backend: failBackend, priority: 90, fallback: ["fallbk"] },
      { name: "fallbk", match: "never-matched-directly", backend: fallbackBackend, priority: 0 },
    ];
    const state = makeState(routes);
    const backend = new PoolBackend({ routes, default: "primary", state });

    const resp = await backend.run(makeReq({ model: "shared" }));
    expect(resp.output).toBe("from-fallback");
    const fallbkState = state.getMemberState("fallbk");
    expect(fallbkState.totalSuccess).toBe(1);
  });

  it("marks access=denied on 403 and skips the member", async () => {
    const forbiddenBackend: { run: (req: AgentRequest) => Promise<AgentResponse> } = {
      async run(_req: AgentRequest): Promise<AgentResponse> {
        throw new Error("403 Forbidden");
      },
    };
    const goodBackend = new MockBackend({ responder: () => "ok" });

    const routes: PoolRoute[] = [
      { name: "forbidden", match: "shared", backend: forbiddenBackend, priority: 90 },
      { name: "good", match: "shared", backend: goodBackend, priority: 10 },
    ];
    const state = makeState(routes);
    const backend = new PoolBackend({ routes, default: "good", state });

    const resp = await backend.run(makeReq({ model: "shared" }));
    expect(resp.output).toBe("ok");

    const fs = state.getMemberState("forbidden");
    expect(fs.access).toBe("denied");
  });

  it("throws last error when all candidates fail", async () => {
    const fail: { run: (req: AgentRequest) => Promise<AgentResponse> } = {
      async run(_req: AgentRequest): Promise<AgentResponse> {
        throw new Error("always fails");
      },
    };

    const routes: PoolRoute[] = [
      { name: "only", match: "shared", backend: fail },
    ];
    const state = makeState(routes);
    const backend = new PoolBackend({ routes, default: "only", state });

    await expect(backend.run(makeReq({ model: "shared" }))).rejects.toThrow("always fails");
  });

  it("throws when no eligible candidates exist at all", async () => {
    const routes: PoolRoute[] = [
      { name: "limited", match: "shared", backend: new MockBackend(), rpd: 0 },
    ];
    const state = makeState(routes);
    // rpd=0 means never eligible
    const backend = new PoolBackend({ routes, default: "limited", state });

    await expect(backend.run(makeReq({ model: "shared" }))).rejects.toThrow();
  });

  it("counts 429 in total429 counter", async () => {
    const rateLimited: { run: (req: AgentRequest) => Promise<AgentResponse> } = {
      async run(_req: AgentRequest): Promise<AgentResponse> {
        throw new Error("429 Too Many Requests");
      },
    };
    const good = new MockBackend({ responder: () => "ok" });

    const routes: PoolRoute[] = [
      { name: "rl", match: "shared", backend: rateLimited, priority: 90 },
      { name: "good", match: "shared", backend: good, priority: 10 },
    ];
    const state = makeState(routes);
    const backend = new PoolBackend({ routes, default: "good", state });

    await backend.run(makeReq({ model: "shared" }));
    const rlState = state.getMemberState("rl");
    expect(rlState.total429).toBe(1);
  });

  it("increments totalErrors for non-429 failures", async () => {
    const errBackend: { run: (req: AgentRequest) => Promise<AgentResponse> } = {
      async run(_req: AgentRequest): Promise<AgentResponse> {
        throw new Error("internal server error");
      },
    };
    const good = new MockBackend({ responder: () => "ok" });

    const routes: PoolRoute[] = [
      { name: "bad", match: "shared", backend: errBackend, priority: 90 },
      { name: "good", match: "shared", backend: good, priority: 10 },
    ];
    const state = makeState(routes);
    const backend = new PoolBackend({ routes, default: "good", state });

    await backend.run(makeReq({ model: "shared" }));
    const badState = state.getMemberState("bad");
    expect(badState.totalErrors).toBe(1);
  });

  it("passes request through unchanged to the backend", async () => {
    const capturer = new MockBackend();
    const routes: PoolRoute[] = [
      { name: "cap", match: "shared", backend: capturer },
    ];
    const state = makeState(routes);
    const backend = new PoolBackend({ routes, default: "cap", state });

    const req = makeReq({ model: "shared", prompt: "hello world", schema: { type: "string" } });
    await backend.run(req);

    expect(capturer.calls.length).toBe(1);
    expect(capturer.calls[0]!.prompt).toBe("hello world");
    expect(capturer.calls[0]!.schema).toEqual({ type: "string" });
  });
});

describe("PoolBackend.run — default route", () => {
  it("routes to default when model does not match any route", async () => {
    const defaultBackend = new MockBackend({ responder: () => "default response" });
    const routes: PoolRoute[] = [
      { name: "specific", match: "specific-model", backend: new MockBackend(), priority: 90 },
      { name: "def", match: "never", backend: defaultBackend, priority: 0 },
    ];
    const state = makeState(routes);
    const backend = new PoolBackend({ routes, default: "def", state });

    const resp = await backend.run(makeReq({ model: "unknown-model" }));
    expect(resp.output).toBe("default response");
  });
});

describe("PoolBackend — logging", () => {
  it("logs a message when a member fails and another is tried", async () => {
    const logs: string[] = [];
    const failBackend: { run: (req: AgentRequest) => Promise<AgentResponse> } = {
      async run(_req: AgentRequest): Promise<AgentResponse> {
        throw new Error("transient error");
      },
    };
    const goodBackend = new MockBackend({ responder: () => "ok" });

    const routes: PoolRoute[] = [
      { name: "fails", match: "shared", backend: failBackend, priority: 90 },
      { name: "ok", match: "shared", backend: goodBackend, priority: 10 },
    ];
    const state = makeState(routes);
    const backend = new PoolBackend({
      routes,
      default: "ok",
      state,
      log: (m) => logs.push(m),
    });

    await backend.run(makeReq({ model: "shared" }));

    // Should have logged at least one shed message
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]).toMatch(/pool: fails/);
  });
});
