/**
 * pool-backend.ts — PoolScheduler + PoolBackend (data plane routing).
 *
 * Runs OUTSIDE the node:vm sandbox. No engine primitives imported.
 * This is a pure composition layer over existing AgentBackend implementations.
 */

import type { AgentBackend, AgentRequest, AgentResponse } from "./types.js";
import type { StateStore } from "./pool-state.js";
import { PoolState } from "./pool-state.js";

// ---------- PoolRoute ----------

/**
 * A single routing entry. `match` is a logical label (or labels) that this
 * backend handles. When `req.model` or `req.agentType` matches one of these
 * labels, this route is a candidate.
 */
export interface PoolRoute {
  /** Unique name for this member/backend. */
  name: string;
  /** Label(s) that this route handles — matched against req.model / req.agentType. */
  match: string | string[];
  /** The actual backend implementation for this member. */
  backend: AgentBackend;
  /** Routing priority — higher is preferred. Default 0. */
  priority?: number;
  /** Max requests per minute for this member. */
  rpm?: number;
  /** Max requests per day for this member. */
  rpd?: number;
  /** Max concurrent requests for this member. */
  concurrency?: number;
  /**
   * Additional fallback member names to try (in order) when this route is
   * exhausted or fails. Fallbacks are consulted AFTER the main candidate list
   * derived from resolveCandidates() — they extend the retry chain.
   */
  fallback?: string[];
}

// ---------- classifyError ----------

export interface ErrorClassification {
  /** Whether the error is transient and another member should be tried. */
  retryable: boolean;
  /**
   * How long to cool down this member before retrying (ms). Parsed from a
   * "Retry-After: N" hint in the error message when present.
   */
  retryAfterMs?: number;
  /** Whether this member has permanently lost access (401/403/404/access denied). */
  fatal: boolean;
  /** Whether this is a rate-limit (429) response. */
  is429: boolean;
}

/**
 * Heuristic error classifier. Inspects the error message/string for known
 * signals — no network calls.
 */
export function classifyError(err: unknown): ErrorClassification {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  // --- 429 / rate-limit ---
  const is429 =
    lower.includes("429") ||
    lower.includes("too many requests") ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("ratelimit");

  if (is429) {
    // Attempt to parse "Retry-After: N" seconds from the error message.
    const match = /retry-after[:\s]+(\d+)/i.exec(msg);
    const retryAfterMs = match !== null && match[1] !== undefined
      ? parseInt(match[1], 10) * 1000
      : undefined;
    return { retryable: true, is429: true, fatal: false, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
  }

  // --- Fatal / access denied ---
  const isFatal =
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("404") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("access denied") ||
    lower.includes("not found") ||
    lower.includes("access") && lower.includes("denied");

  if (isFatal) {
    return { retryable: false, is429: false, fatal: true };
  }

  // Default: transient, retryable.
  return { retryable: true, is429: false, fatal: false };
}

// ---------- PoolScheduler ----------

interface SchedulerOptions {
  routes: PoolRoute[];
  default: string;
  state: PoolState;
  log?: (message: string) => void;
}

/**
 * Deterministic data-plane scheduler. Resolves candidates from routes, picks
 * the best eligible one. No LLM involvement.
 */
export class PoolScheduler {
  private readonly _routes: PoolRoute[];
  private readonly _default: string;
  private readonly _state: PoolState;
  private readonly _log: (m: string) => void;
  /** name → route (fast lookup) */
  private readonly _byName: Map<string, PoolRoute>;

  constructor(opts: SchedulerOptions) {
    this._routes = opts.routes;
    this._default = opts.default;
    this._state = opts.state;
    this._log = opts.log ?? (() => undefined);

    this._byName = new Map();
    for (const r of opts.routes) {
      this._byName.set(r.name, r);
    }
  }

  /**
   * Resolve the ordered list of candidate member names for a request.
   *
   * Rules (from the spec):
   * 1. candidates = members whose match (string|array) includes req.model OR req.agentType.
   * 2. If none match → [default].
   * 3. Sort by priority descending; ties: lowest inFlight first, then lowest latencyEwmaMs.
   */
  resolveCandidates(req: AgentRequest): string[] {
    const target = new Set<string>();
    if (req.model !== undefined) target.add(req.model);
    if (req.agentType !== undefined) target.add(req.agentType);

    let matched: PoolRoute[] = [];
    for (const route of this._routes) {
      const labels = Array.isArray(route.match) ? route.match : [route.match];
      const hits = labels.some((l) => target.has(l));
      if (hits) matched.push(route);
    }

    if (matched.length === 0) {
      // Fall back to the default route if it exists.
      const def = this._byName.get(this._default);
      matched = def !== undefined ? [def] : [];
    }

    // Sort: priority desc, then inFlight asc, then latencyEwmaMs asc (nulls last).
    matched.sort((a, b) => {
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pa !== pb) return pb - pa; // higher priority first

      // Roll windows before reading state so counts are fresh.
      this._state.rollWindows(a.name);
      this._state.rollWindows(b.name);

      const sa = this._state.getMemberState(a.name);
      const sb = this._state.getMemberState(b.name);

      if (sa.inFlight !== sb.inFlight) return sa.inFlight - sb.inFlight; // lower first

      // Latency: null means no data yet — treat as 0 (optimistically prefer unknown).
      const la = sa.latencyEwmaMs ?? 0;
      const lb = sb.latencyEwmaMs ?? 0;
      return la - lb; // lower first
    });

    return matched.map((r) => r.name);
  }

  /**
   * Pick the first eligible candidate (state.isEligible) from the resolved list, or null.
   */
  pick(req: AgentRequest): string | null {
    const candidates = this.resolveCandidates(req);
    for (const name of candidates) {
      this._state.rollWindows(name);
      if (this._state.isEligible(name)) return name;
    }
    return null;
  }

  /** Expose internals for PoolBackend. */
  getRoute(name: string): PoolRoute | undefined {
    return this._byName.get(name);
  }

  getLog(): (m: string) => void {
    return this._log;
  }

  getState(): PoolState {
    return this._state;
  }

  getDefault(): string {
    return this._default;
  }
}

// ---------- PoolBackend ----------

interface PoolBackendOptions {
  routes: PoolRoute[];
  default: string;
  state: PoolState;
  store?: StateStore;
  log?: (message: string) => void;
  /**
   * Resolves once any persisted state has been loaded from the store. Callers
   * that need accurate daily-budget (rpd)/cooldown state before the first
   * dispatch should `await pool.ready` first. Defaults to already-resolved.
   */
  ready?: Promise<void>;
}

/**
 * Blind exponential backoff base (ms) for retries when no Retry-After is known.
 * Doubles each attempt: 500 → 1000 → 2000 → …
 */
const BACKOFF_BASE_MS = 500;

/**
 * AgentBackend implementation that routes requests across a heterogeneous pool.
 *
 * Walk eligible candidates (including fallbacks) in priority order.
 * For each chosen member: onDispatch → run → onSuccess → flush state.
 * On failure: classifyError → onFailure → log → try next.
 * If all fail: throw the last error.
 */
export class PoolBackend implements AgentBackend {
  private readonly _scheduler: PoolScheduler;
  private readonly _state: PoolState;
  private readonly _store: StateStore | undefined;
  private readonly _log: (m: string) => void;
  /** Resolves once persisted state has loaded. `await pool.ready` before the first run() if daily-budget accuracy matters. */
  readonly ready: Promise<void>;

  constructor(opts: PoolBackendOptions) {
    this._state = opts.state;
    this._store = opts.store;
    this._log = opts.log ?? (() => undefined);
    this.ready = opts.ready ?? Promise.resolve();
    this._scheduler = new PoolScheduler({
      routes: opts.routes,
      default: opts.default,
      state: opts.state,
      log: this._log,
    });
  }

  async run(req: AgentRequest): Promise<AgentResponse> {
    // Build the full try list: primary candidates + fallback names appended in order.
    const primary = this._scheduler.resolveCandidates(req);
    const tryList = this._buildTryList(primary, req);

    let lastError: unknown = new Error("pool: no eligible candidates for request");
    let attemptIndex = 0;

    for (const name of tryList) {
      // Guard unknown names (e.g. a `fallback` referencing an undeclared member)
      // BEFORE touching PoolState — otherwise rollWindows/isEligible would throw
      // "unknown member" out of run() instead of skipping gracefully.
      const route = this._scheduler.getRoute(name);
      if (route === undefined) continue;

      this._state.rollWindows(name);
      if (!this._state.isEligible(name)) continue;

      // No global backoff sleep here: per-member exponential backoff is encoded in
      // cooldownUntil (set in onFailure for 429-without-Retry-After) and enforced by
      // isEligible, so a fresh fallback member is tried immediately with no artificial delay.

      this._state.onDispatch(name);
      const start = Date.now();

      try {
        const resp = await route.backend.run(req);
        const latencyMs = Date.now() - start;
        this._state.onSuccess(name, latencyMs);

        // Flush state best-effort — do not let a store failure abort the response.
        if (this._store !== undefined) {
          this._store.save(this._state.toSnapshot()).catch((e: unknown) => {
            this._log(`pool: store.save failed: ${e instanceof Error ? e.message : String(e)}`);
          });
        }

        return resp;
      } catch (err: unknown) {
        const latencyMs = Date.now() - start;
        const cls = classifyError(err);

        // Apply backoff hint from the error if present.
        const retryAfterMs = cls.retryAfterMs ?? (cls.is429 ? BACKOFF_BASE_MS * Math.pow(2, attemptIndex) : undefined);
        this._state.onFailure(name, {
          ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
          fatal: cls.fatal,
          is429: cls.is429,
        });
        this._state.setLastError(name, err instanceof Error ? err.message : String(err));

        const coolMs = retryAfterMs ?? 0;
        this._log(`pool: ${name} cooling ${coolMs}ms (latency ${latencyMs}ms) → trying next`);

        lastError = err;
        attemptIndex++;
      }
    }

    // All candidates exhausted — re-throw the last error.
    throw lastError;
  }

  /**
   * Build the ordered try list: primary candidates first, then fallback members
   * declared on any primary route (deduped, preserving order).
   */
  private _buildTryList(primary: string[], _req: AgentRequest): string[] {
    const seen = new Set<string>();
    const list: string[] = [];

    const add = (name: string): void => {
      if (!seen.has(name)) {
        seen.add(name);
        list.push(name);
      }
    };

    for (const name of primary) {
      add(name);
    }

    // Append fallback names declared on primary routes (in the order the routes appear).
    for (const name of primary) {
      const route = this._scheduler.getRoute(name);
      if (route?.fallback !== undefined) {
        for (const fb of route.fallback) {
          add(fb);
        }
      }
    }

    return list;
  }
}
