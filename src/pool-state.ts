/**
 * Pool state — per-member live status, persistable via StateStore.
 *
 * Pool code runs OUTSIDE the node:vm sandbox; wall clock is fine, but we inject
 * `now: () => number` so tests can advance time deterministically.
 */

import { readFile, writeFile } from "node:fs/promises";

// ---------- per-member live status ----------

export interface MemberState {
  /** How many requests dispatched in the current rpm window. */
  rpmCount: number;
  /** Epoch ms at which the current rpm window started. */
  rpmWindowStart: number;
  /** How many requests dispatched today (UTC). */
  rpdCount: number;
  /** The UTC date string ("YYYY-MM-DD") for which rpdCount is valid. */
  rpdDay: string;
  /** Consecutive failures without a success; reset to 0 on success. */
  consecutiveFailures: number;
  /** Circuit breaker state. */
  circuit: "closed" | "open" | "half-open";
  /** Epoch ms before which this member must not be dispatched (cooldown). */
  cooldownUntil: number;
  /** Whether API access to this member is believed usable ('ok') or revoked ('denied'). */
  access: "ok" | "denied";
  /** Exponential moving average of response latency (ms). null until first success. */
  latencyEwmaMs: number | null;
  /** Quality score assigned by a grader (0–1 range recommended). null until graded. */
  qualityScore: number | null;
  /** Number of requests currently in flight. */
  inFlight: number;
  /** Total requests ever dispatched to this member. */
  totalRequests: number;
  /** Total successful responses. */
  totalSuccess: number;
  /** Total 429 (rate-limit) responses. */
  total429: number;
  /** Total error responses (excluding 429). */
  totalErrors: number;
  /** Last error message, if any. */
  lastError?: string;
  /** Epoch ms of the last successful dispatch. */
  lastUsedAt?: number;
}

// ---------- snapshot (serialisable) ----------

export interface PoolStateSnapshot {
  version: 1;
  updatedAt: number; // epoch ms
  members: Record<string, MemberState>;
}

// ---------- StateStore interface ----------

export interface StateStore {
  load(): Promise<PoolStateSnapshot | null>;
  save(s: PoolStateSnapshot): Promise<void>;
}

// ---------- memoryStore ----------

/** In-memory store — suitable for tests and short-lived runs. */
export function memoryStore(): StateStore {
  let stored: PoolStateSnapshot | null = null;
  return {
    async load() {
      return stored;
    },
    async save(s) {
      stored = s;
    },
  };
}

// ---------- fileStore ----------

/** Persist state to a local JSON file. Tolerates a missing file (returns null). */
export function fileStore(path: string): StateStore {
  return {
    async load() {
      try {
        const text = await readFile(path, "utf8");
        return JSON.parse(text) as PoolStateSnapshot;
      } catch {
        return null;
      }
    },
    async save(s) {
      await writeFile(path, JSON.stringify(s, null, 2), "utf8");
    },
  };
}

// ---------- httpStore ----------

export interface HttpStoreOptions {
  /** URL to GET the snapshot from. */
  getUrl: string;
  /** URL to PUT the snapshot to. */
  putUrl: string;
  /** Optional extra headers (e.g. Authorization). */
  headers?: Record<string, string>;
  /** Injected fetch implementation — defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** Load/save state via HTTP (GET / PUT). Useful for shared team-wide pool state. */
export function httpStore(opts: HttpStoreOptions): StateStore {
  const fetchFn: typeof fetch = opts.fetchImpl ?? fetch;
  const headers = opts.headers ?? {};
  return {
    async load() {
      try {
        const res = await fetchFn(opts.getUrl, { method: "GET", headers });
        if (!res.ok) return null;
        const text = await res.text();
        return JSON.parse(text) as PoolStateSnapshot;
      } catch {
        return null;
      }
    },
    async save(s) {
      await fetchFn(opts.putUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(s),
      });
    },
  };
}

// ---------- per-member limits (config) ----------

export interface MemberLimits {
  /** Max requests per minute. undefined = unlimited. */
  rpm?: number;
  /** Max requests per day. undefined = unlimited. */
  rpd?: number;
  /** Max in-flight requests. undefined = unlimited. */
  concurrency?: number;
  /** Routing priority (higher = preferred). Default 0. */
  priority?: number;
}

// ---------- PoolState ----------

function todayUtc(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

const EWMA_ALPHA = 0.3;

export class PoolState {
  private readonly _members: Map<string, MemberState>;
  private readonly _limits: Map<string, Required<MemberLimits>>;
  private readonly _now: () => number;
  private readonly _breakerThreshold: number;
  private readonly _halfOpenAfterMs: number;

  /**
   * @param memberNames     Array of all member names in the pool.
   * @param limits          Per-member budget/priority config.
   * @param now             Clock injection — default returns Date.now().
   * @param breakerThreshold Consecutive failures before circuit opens. Default 4.
   * @param halfOpenAfterMs  How long to wait in 'open' before trying 'half-open'. Default 60_000.
   */
  constructor(
    memberNames: string[],
    limits: Record<string, MemberLimits>,
    opts?: {
      now?: () => number;
      breakerThreshold?: number;
      halfOpenAfterMs?: number;
    },
  ) {
    this._now = opts?.now ?? (() => Date.now());
    this._breakerThreshold = opts?.breakerThreshold ?? 4;
    this._halfOpenAfterMs = opts?.halfOpenAfterMs ?? 60_000;

    this._members = new Map();
    this._limits = new Map();

    for (const name of memberNames) {
      const lim = limits[name] ?? {};
      this._limits.set(name, {
        rpm: lim.rpm ?? Infinity,
        rpd: lim.rpd ?? Infinity,
        concurrency: lim.concurrency ?? Infinity,
        priority: lim.priority ?? 0,
      });
      this._members.set(name, this._freshMemberState());
    }
  }

  private _freshMemberState(): MemberState {
    const now = this._now();
    return {
      rpmCount: 0,
      rpmWindowStart: now,
      rpdCount: 0,
      rpdDay: todayUtc(now),
      consecutiveFailures: 0,
      circuit: "closed",
      cooldownUntil: 0,
      access: "ok",
      latencyEwmaMs: null,
      qualityScore: null,
      inFlight: 0,
      totalRequests: 0,
      totalSuccess: 0,
      total429: 0,
      totalErrors: 0,
    };
  }

  private _get(name: string): MemberState {
    const s = this._members.get(name);
    if (s === undefined) throw new Error(`PoolState: unknown member "${name}"`);
    return s;
  }

  // ---------- rollWindows ----------

  /**
   * Roll rpm window (if >60s elapsed) and rpd day (if UTC date changed).
   * Call before hasBudget / isEligible to ensure fresh counts.
   */
  rollWindows(name: string): void {
    const s = this._get(name);
    const now = this._now();

    // rpm: reset if more than 60 seconds have elapsed since window start
    if (now - s.rpmWindowStart >= 60_000) {
      s.rpmCount = 0;
      s.rpmWindowStart = now;
    }

    // rpd: reset if UTC date has changed
    const today = todayUtc(now);
    if (s.rpdDay !== today) {
      s.rpdCount = 0;
      s.rpdDay = today;
    }

    // Circuit: open → half-open once cooldown elapses — but NOT when access is denied
    // (a 401/403 member stays blocked until an operator clears access; half-open would
    // falsely signal "recovering" while isEligible still blocks it).
    if (s.circuit === "open" && now >= s.cooldownUntil && s.access === "ok") {
      s.circuit = "half-open";
    }
  }

  // ---------- hasBudget ----------

  /** Returns true when rpm/rpd budget remains AND in-flight < concurrency limit. */
  hasBudget(name: string): boolean {
    const s = this._get(name);
    const lim = this._limits.get(name)!;
    return s.rpmCount < lim.rpm && s.rpdCount < lim.rpd && s.inFlight < lim.concurrency;
  }

  // ---------- isEligible ----------

  /**
   * Returns true when the member can accept a new request:
   * circuit is closed or half-open, cooldown has elapsed, access is 'ok', budget remains.
   */
  isEligible(name: string): boolean {
    const s = this._get(name);
    const now = this._now();
    if (s.circuit === "open") return false;
    // Single-probe in half-open: allow at most ONE concurrent trial request through,
    // matching the standard circuit-breaker contract (the spec's half-open → ok → closed).
    if (s.circuit === "half-open" && s.inFlight > 0) return false;
    if (now < s.cooldownUntil) return false;
    if (s.access !== "ok") return false;
    return this.hasBudget(name);
  }

  // ---------- onDispatch ----------

  /** Call immediately before sending a request to this member. */
  onDispatch(name: string): void {
    const s = this._get(name);
    s.inFlight++;
    s.rpmCount++;
    s.rpdCount++;
    s.totalRequests++;
  }

  // ---------- onSuccess ----------

  /** Call when a response arrives successfully. */
  onSuccess(name: string, latencyMs: number): void {
    const s = this._get(name);
    s.inFlight = Math.max(0, s.inFlight - 1);

    // EWMA latency (alpha ~0.3)
    if (s.latencyEwmaMs === null) {
      s.latencyEwmaMs = latencyMs;
    } else {
      s.latencyEwmaMs = EWMA_ALPHA * latencyMs + (1 - EWMA_ALPHA) * s.latencyEwmaMs;
    }

    s.totalSuccess++;
    s.consecutiveFailures = 0;

    // Close circuit (handles half-open → closed)
    s.circuit = "closed";
    s.lastUsedAt = this._now();
  }

  // ---------- onFailure ----------

  /**
   * Call when a request fails.
   * @param retryAfterMs  Cooldown duration in ms (e.g. from Retry-After header).
   * @param fatal         If true, mark access='denied' (401/403/404 — no point retrying).
   * @param is429         If true, increment total429 (rate-limit hit).
   */
  onFailure(
    name: string,
    opts?: { retryAfterMs?: number; fatal?: boolean; is429?: boolean },
  ): void {
    const s = this._get(name);
    s.inFlight = Math.max(0, s.inFlight - 1);

    const now = this._now();
    const retryAfter = opts?.retryAfterMs ?? 0;
    s.cooldownUntil = Math.max(s.cooldownUntil, now + retryAfter);

    if (opts?.is429) {
      s.total429++;
    } else {
      s.totalErrors++;
    }

    s.consecutiveFailures++;

    if (opts?.fatal) {
      s.access = "denied";
      // Long cooldown for fatal errors (effectively permanent until operator resets)
      s.cooldownUntil = Math.max(s.cooldownUntil, now + 24 * 60 * 60 * 1000);
    }

    // Trip circuit breaker after threshold consecutive failures
    if (s.consecutiveFailures >= this._breakerThreshold && s.circuit !== "open") {
      s.circuit = "open";
      // Set cooldown for half-open transition
      s.cooldownUntil = Math.max(s.cooldownUntil, now + this._halfOpenAfterMs);
    }
  }

  /** Record the last error message for observability. */
  setLastError(name: string, message: string): void {
    this._get(name).lastError = message;
  }

  /** Set quality score (0–1 recommended). Assigned by an out-of-band grader. */
  setQualityScore(name: string, score: number): void {
    this._get(name).qualityScore = score;
  }

  /** Get the current state snapshot for a specific member. */
  getMemberState(name: string): Readonly<MemberState> {
    return this._get(name);
  }

  /** Get all member names. */
  get memberNames(): string[] {
    return Array.from(this._members.keys());
  }

  // ---------- toSnapshot / loadSnapshot ----------

  /** Produce a serialisable snapshot of the current state. */
  toSnapshot(): PoolStateSnapshot {
    const members: Record<string, MemberState> = {};
    for (const [name, state] of this._members) {
      // Shallow clone to avoid external mutation
      members[name] = { ...state };
    }
    return { version: 1, updatedAt: this._now(), members };
  }

  /**
   * Merge a persisted snapshot into live state.
   *
   * Rules:
   * - rpd: preserved as-is when the snapshot's rpdDay matches today (same UTC day).
   *   Reset to 0 otherwise (new day).
   * - rpm: if the snapshot's rpmWindowStart is within the current 60s window,
   *   preserve the count; otherwise reset.
   * - All other fields (circuit, cooldownUntil, access, latency, quality, totals) are
   *   taken directly from the snapshot — they represent real observed state.
   */
  loadSnapshot(snap: PoolStateSnapshot): void {
    const now = this._now();
    const today = todayUtc(now);

    for (const [name, saved] of Object.entries(snap.members)) {
      if (!this._members.has(name)) continue; // member removed from config — skip

      const live = this._get(name);

      // rpd: preserve same-day count; reset on date change
      if (saved.rpdDay === today) {
        live.rpdCount = saved.rpdCount;
        live.rpdDay = saved.rpdDay;
      } else {
        live.rpdCount = 0;
        live.rpdDay = today;
      }

      // rpm: preserve if still within the same 60s window
      if (now - saved.rpmWindowStart < 60_000) {
        live.rpmCount = saved.rpmCount;
        live.rpmWindowStart = saved.rpmWindowStart;
      } else {
        live.rpmCount = 0;
        live.rpmWindowStart = now;
      }

      // Circuit breaker: advance open → half-open if cooldown elapsed
      let circuit = saved.circuit;
      if (circuit === "open" && now >= saved.cooldownUntil) {
        circuit = "half-open";
      }
      live.circuit = circuit;
      live.cooldownUntil = saved.cooldownUntil;
      live.access = saved.access;
      live.consecutiveFailures = saved.consecutiveFailures;

      // Latency + quality
      live.latencyEwmaMs = saved.latencyEwmaMs;
      live.qualityScore = saved.qualityScore;

      // Totals (cumulative — always take from snapshot)
      live.totalRequests = saved.totalRequests;
      live.totalSuccess = saved.totalSuccess;
      live.total429 = saved.total429;
      live.totalErrors = saved.totalErrors;

      // Optional fields — assign only when present (forward-compatible with
      // exactOptionalPropertyTypes; that flag is not enabled repo-wide because the
      // existing engine predates it — see PR notes).
      if (saved.lastError !== undefined) {
        live.lastError = saved.lastError;
      }
      if (saved.lastUsedAt !== undefined) {
        live.lastUsedAt = saved.lastUsedAt;
      }

      // inFlight: always reset to 0 on load (in-flight state is lost across restarts)
      live.inFlight = 0;
    }
  }
}
