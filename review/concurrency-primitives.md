> Historical adversarial-review artifact. This is not the current vulnerability list; see `review/README.md` and `PROGRESS.md` for current status.

Both defects are fully confirmed. Here is my report:

---

## Concurrency-Primitives Review — Findings

### 1. Limiter silent deadlock on invalid `max` (0, negative, NaN) — **MED**

**File:** `src/concurrency.ts:23-25` (constructor), `src/primitives.ts:24` (no validation)

**What:** `new Limiter(max)` stores `max` without validation. When `max ≤ 0` or `max` is `NaN`, the while-loop guard `this._active < this._max` in `_drain()` is immediately false, so no entry is ever dequeued. Every `run()` call returns a forever-pending promise with **no error, no timeout**.

**Confirmed by:**
```
$ node -e "
  const {Limiter} = require('./dist/concurrency.js');
  const l = new Limiter(0);
  let r = false;
  l.run(async () => 'x').then(() => r = true);
  setTimeout(() => { console.log(r); }, 200);
"
false
```
The promise never settles; `active=0, queued=1` — the entry is trapped forever.

The path is reachable from user config: `src/primitives.ts:24` — `const concurrency = cfg.concurrency ?? defaultConcurrency();` — passes `0` (or `NaN`) straight through because `0 ?? default` evaluates to `0`.

**Fix:**
```ts
// src/concurrency.ts — constructor
constructor(max: number) {
  if (!Number.isFinite(max) || max < 1) {
    throw new RangeError(`Limiter max must be a positive integer, got ${max}`);
  }
  this._max = max;
}
```

---

### 2. Limiter slot leak when `fn()` throws synchronously — **MED**

**File:** `src/concurrency.ts:43-46` (`_drain` method)

**What:** In `_drain()`, `_active` is incremented **before** `entry.fn()` is called (line 45). If `fn()` throws synchronously (instead of returning a rejected promise), the `.then(resolve, reject)` on line 46 is never attached, so `_active` is never decremented. The slot is permanently leaked. With `max=1`, this deadlocks **every subsequent `run()` call**.

**Confirmed by:**
```
$ node -e "
  const {Limiter} = require('./dist/concurrency.js');
  const l = new Limiter(1);
  l.run(() => { throw new Error('sync'); }).catch(() => {});
  setTimeout(() => {
    console.log('active=' + l.active);  // 1 (leaked)
    let ok = false;
    l.run(async () => 'x').then(() => ok = true);
    setTimeout(() => console.log('deadlock=' + !ok), 100);
  }, 50);
"
active=1
deadlock=true
```

Not reachable through the current `agent()` path (it always passes `async () => {…}` to `limiterRun`, and async functions never throw synchronously). However `Limiter` is **exported** from `src/index.ts` and used directly in tests, so it is part of the public contract.

**Fix:**
```ts
// src/concurrency.ts — _drain(), replace entry.fn().then(...) with:
let p: Promise<T>;
try {
  p = entry.fn();
} catch (syncErr) {
  this._active--;
  entry.reject(syncErr);
  this._drain();
  continue;
}
p.then(
  (value) => { this._active--; entry.resolve(value); this._drain(); },
  (err)   => { this._active--; entry.reject(err);   this._drain(); },
);
```
