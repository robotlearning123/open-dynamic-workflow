import { describe, it, expect } from "vitest";
import { Limiter, defaultConcurrency, MAX_TOTAL_AGENTS } from "../src/concurrency.js";

describe("MAX_TOTAL_AGENTS", () => {
  it("equals 1000", () => {
    expect(MAX_TOTAL_AGENTS).toBe(1000);
  });
});

describe("defaultConcurrency", () => {
  it("returns a number between 1 and 16 inclusive", () => {
    const v = defaultConcurrency();
    expect(v).toBeGreaterThanOrEqual(1);
    expect(v).toBeLessThanOrEqual(16);
  });
});

describe("Limiter", () => {
  /** Create a deferred: a Promise plus its resolve function. */
  function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  it("runs at most max tasks concurrently (max=2, 5 tasks)", async () => {
    const limiter = new Limiter(2);
    let peakActive = 0;

    // Each task: increment a shared counter, record peak, await its deferred, decrement.
    const gates = Array.from({ length: 5 }, () => deferred<void>());
    const activeCounter = { value: 0 };

    const promises = gates.map(({ promise }, i) =>
      limiter.run(async () => {
        activeCounter.value++;
        if (activeCounter.value > peakActive) {
          peakActive = activeCounter.value;
        }
        await promise;
        activeCounter.value--;
        return i;
      }),
    );

    // Let the event loop settle so tasks that can start do start.
    await Promise.resolve();
    await Promise.resolve();

    // Only 2 should be running now; 3 should be queued.
    expect(limiter.active).toBe(2);
    expect(limiter.queued).toBe(3);

    // Release all gates in sequence, checking active count stays ≤ 2.
    for (const gate of gates) {
      gate.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(limiter.active).toBeLessThanOrEqual(2);
    }

    const results = await Promise.all(promises);
    expect(results).toEqual([0, 1, 2, 3, 4]);
    expect(peakActive).toBeLessThanOrEqual(2);
  });

  it("all 5 tasks complete", async () => {
    const limiter = new Limiter(2);
    const gates = Array.from({ length: 5 }, () => deferred<void>());

    const promises = gates.map(({ promise }, i) =>
      limiter.run(async () => {
        await promise;
        return i;
      }),
    );

    // Release all gates immediately.
    for (const gate of gates) {
      gate.resolve();
    }

    const results = await Promise.all(promises);
    expect(results).toHaveLength(5);
    expect(results).toEqual([0, 1, 2, 3, 4]);
  });

  it("FIFO: tasks start in submission order", async () => {
    const limiter = new Limiter(1); // max=1 so we can observe queue order
    const startOrder: number[] = [];
    const gates = Array.from({ length: 5 }, () => deferred<void>());

    const promises = gates.map(({ promise }, i) =>
      limiter.run(async () => {
        startOrder.push(i);
        await promise;
        return i;
      }),
    );

    // Settle: task 0 should be running, 1-4 queued.
    await Promise.resolve();
    await Promise.resolve();

    // Release each gate in order; next task in queue should start.
    for (const gate of gates) {
      gate.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    await Promise.all(promises);
    expect(startOrder).toEqual([0, 1, 2, 3, 4]);
  });

  it("active and queued counts reflect limiter state", async () => {
    const limiter = new Limiter(2);
    const gates = Array.from({ length: 4 }, () => deferred<void>());

    const promises = gates.map(({ promise }) =>
      limiter.run(async () => {
        await promise;
      }),
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(limiter.active).toBe(2);
    expect(limiter.queued).toBe(2);

    // Release one.
    gates[0].resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(limiter.active).toBe(2); // slot immediately refilled
    expect(limiter.queued).toBe(1);

    // Release remaining.
    for (const g of gates.slice(1)) g.resolve();
    await Promise.all(promises);

    expect(limiter.active).toBe(0);
    expect(limiter.queued).toBe(0);
  });

  it("propagates errors without breaking subsequent tasks", async () => {
    const limiter = new Limiter(1);
    const gate = deferred<void>();

    const failPromise = limiter.run(async () => {
      await gate.promise;
      throw new Error("task failed");
    });

    const okPromise = limiter.run(async () => "ok");

    gate.resolve();
    await Promise.resolve();
    await Promise.resolve();

    await expect(failPromise).rejects.toThrow("task failed");
    expect(await okPromise).toBe("ok");
  });

  it("sync-throw rejects AND releases the slot (no leak)", async () => {
    const limiter = new Limiter(1);
    await expect(
      limiter.run(() => {
        throw new Error("sync boom");
      }),
    ).rejects.toThrow("sync boom");
    expect(limiter.active).toBe(0);
    expect(await limiter.run(async () => "ok")).toBe("ok");
  });
});
