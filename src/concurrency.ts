import os from "node:os";

export const MAX_TOTAL_AGENTS = 1000;

/** Default concurrency cap: min(16, max(1, cpus-2)). Empirically observed in ANALYSIS §3.3. */
export function defaultConcurrency(): number {
  return Math.min(16, Math.max(1, os.cpus().length - 2));
}

type QueueEntry<T> = {
  fn: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

/** FIFO concurrency limiter. Slots are acquired before running; released on completion. */
export class Limiter {
  private readonly _max: number;
  private _active: number = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly _queue: QueueEntry<any>[] = [];

  constructor(max: number) {
    // Validate: max <= 0 / NaN would silently deadlock (`_active < _max` never true → forever-pending).
    if (!Number.isFinite(max) || max < 1) {
      throw new RangeError(`Limiter max must be a positive integer, got ${max}`);
    }
    this._max = Math.floor(max);
  }

  get active(): number {
    return this._active;
  }

  get queued(): number {
    return this._queue.length;
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this._queue.push({ fn, resolve, reject });
      this._drain();
    });
  }

  private _drain(): void {
    while (this._active < this._max && this._queue.length > 0) {
      const entry = this._queue.shift()!;
      this._active++;
      let promise: Promise<unknown>;
      try {
        promise = entry.fn();
      } catch (syncErr) {
        // fn() threw synchronously — release the slot (otherwise it leaks and deadlocks the limiter)
        // and reject; `continue` re-enters the loop to run the next queued entry.
        this._active--;
        entry.reject(syncErr);
        continue;
      }
      promise.then(
        (value) => {
          this._active--;
          entry.resolve(value);
          this._drain();
        },
        (err) => {
          this._active--;
          entry.reject(err);
          this._drain();
        },
      );
    }
  }
}
