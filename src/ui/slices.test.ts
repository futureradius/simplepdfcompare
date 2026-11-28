import { describe, expect, it } from "vitest";
import { BatchSizer, batchEnd, SliceRunner } from "./slices";

describe("batchEnd: where a batch ends, by what its items cost", () => {
  const costs = [1, 1, 1, 500, 1, 1];
  const cost = (i: number) => costs[i]!;

  it("takes items while their cost fits in the budget", () => {
    expect(batchEnd(cost, 0, costs.length, 3)).toBe(3);
  });

  it("ends before a heavy item that does not fit, so heavy items clustering cannot blow a batch up", () => {
    expect(batchEnd(cost, 0, costs.length, 100)).toBe(3);
  });

  it("takes at least one item, even one heavier than the whole budget", () => {
    expect(batchEnd(cost, 3, costs.length, 100)).toBe(4);
  });

  it("stops at the end of the items", () => {
    expect(batchEnd(cost, 4, costs.length, Infinity)).toBe(6);
  });
});

describe("BatchSizer: how many items the next batch draws, so that it takes about the target time", () => {
  it("starts small, and grows at most twofold a batch while batches stay quick", () => {
    const b = new BatchSizer(8, { first: 16 });
    expect(b.size()).toBe(16);
    b.took(16, 0.5); // far under the target
    expect(b.size()).toBe(32);
    b.took(32, 0);
    expect(b.size()).toBe(64);
  });

  it("shrinks to what fits in the target when a batch took too long", () => {
    const b = new BatchSizer(8, { first: 100 });
    b.took(100, 40); // 0.4 ms an item: 20 fit in 8 ms
    expect(b.size()).toBe(20);
  });

  it("is never less than one item", () => {
    const b = new BatchSizer(8, { first: 4 });
    b.took(4, 500);
    expect(b.size()).toBe(1);
  });
});

/** A clock the test moves: each step of a job takes the time it says; `later` is run by `flush`. */
function fakeClock() {
  let t = 0;
  const queue: (() => void)[] = [];
  return {
    now: () => t,
    later: (fn: () => void) => void queue.push(fn),
    advance: (ms: number) => void (t += ms),
    /** Runs the scheduled slices one at a time; returns how many ran. */
    flush(max = 1000) {
      let n = 0;
      while (queue.length && n < max) {
        queue.shift()!();
        n++;
      }
      return n;
    },
  };
}

/** A job of `steps` steps, each taking `ms` on the clock; it logs each step. */
function* job(clock: { advance(ms: number): void }, log: string[], name: string, steps: number, ms: number) {
  for (let i = 0; i < steps; i++) {
    clock.advance(ms);
    log.push(`${name}${i}`);
    yield;
  }
}

describe("SliceRunner: paints in slices, the view's tiles first", () => {
  it("runs a lane's jobs one after the other, in slices no longer than the budget", () => {
    const c = fakeClock(),
      log: string[] = [];
    const r = new SliceRunner(c, { sliceMs: 10 });
    r.set("view", [
      { key: "a", start: () => job(c, log, "a", 3, 4) },
      { key: "b", start: () => job(c, log, "b", 2, 4) },
    ]);
    expect(log).toEqual([]); // nothing runs inside `set`
    c.flush(1);
    expect(log).toEqual(["a0", "a1"]); // 8 ms: a third step would end at 12 ms
    c.flush(1);
    expect(log).toEqual(["a0", "a1", "a2", "b0"]);
    c.flush();
    expect(r.idle).toBe(true);
  });

  it("puts the view's tiles first: a tile painted ahead waits, and goes on from where it was", () => {
    const c = fakeClock(),
      log: string[] = [];
    const r = new SliceRunner(c, { sliceMs: 10 });
    r.set("ahead", [{ key: "x", start: () => job(c, log, "x", 4, 6) }]);
    c.flush(1);
    expect(log).toEqual(["x0"]);
    r.set("view", [{ key: "v", start: () => job(c, log, "v", 1, 3) }]);
    c.flush();
    expect(log).toEqual(["x0", "v0", "x1", "x2", "x3"]);
  });

  it("keeps a started job that is still wanted, and stops the ones no longer wanted", () => {
    const c = fakeClock(),
      log: string[] = [];
    const r = new SliceRunner(c, { sliceMs: 10 });
    let starts = 0,
      stopped = false;
    const a = () => {
      starts++;
      return (function* () {
        try {
          yield* job(c, log, "a", 4, 6);
        } finally {
          stopped = true;
        }
      })();
    };
    r.set("view", [{ key: "a", start: a }]);
    c.flush(1);
    // The view moved: "a" is still in view, "b" came in.
    r.set("view", [
      { key: "b", start: () => job(c, log, "b", 1, 1) },
      { key: "a", start: a },
    ]);
    c.flush(1);
    expect(starts).toBe(1);
    expect(log).toEqual(["a0", "a1"]); // the started one goes on first, from where it was
    r.set("view", [{ key: "b", start: () => job(c, log, "b", 1, 1) }]);
    expect(stopped).toBe(true);
    c.flush();
    expect(log).toEqual(["a0", "a1", "b0"]);
  });

  it("paints ahead only while it may (the view rests), and goes on when kicked", () => {
    const c = fakeClock(),
      log: string[] = [];
    let moving = true;
    const r = new SliceRunner(c, { sliceMs: 10, may: (lane) => lane === "view" || !moving });
    r.set("ahead", [{ key: "x", start: () => job(c, log, "x", 2, 1) }]);
    r.set("view", [{ key: "v", start: () => job(c, log, "v", 1, 1) }]);
    c.flush();
    expect(log).toEqual(["v0"]);
    expect(c.flush()).toBe(0); // nothing scheduled while it waits
    moving = false;
    r.kick();
    c.flush();
    expect(log).toEqual(["v0", "x0", "x1"]);
  });

  it("stops every job when what the tiles show changed", () => {
    const c = fakeClock(),
      log: string[] = [];
    const r = new SliceRunner(c, { sliceMs: 10 });
    r.set("view", [{ key: "v", start: () => job(c, log, "v", 3, 6) }]);
    r.set("ahead", [{ key: "x", start: () => job(c, log, "x", 3, 6) }]);
    c.flush(1);
    r.clear();
    c.flush();
    expect(log).toEqual(["v0"]);
    expect(r.idle).toBe(true);
  });

  it("does not start a step that, judged by the last one, would overrun the slice", () => {
    const c = fakeClock(),
      log: string[] = [];
    const r = new SliceRunner(c, { sliceMs: 10 });
    r.set("view", [{ key: "v", start: () => job(c, log, "v", 4, 6) }]);
    c.flush(1);
    expect(log).toEqual(["v0"]); // 6 ms spent, the next would end at 12 ms
    c.flush(1);
    expect(log).toEqual(["v0", "v1"]);
  });

  it("takes shorter slices while told to (the view moves, and frames come first)", () => {
    const c = fakeClock(),
      log: string[] = [];
    let moving = true;
    const r = new SliceRunner(c, { sliceMs: () => (moving ? 4 : 10) });
    r.set("view", [{ key: "v", start: () => job(c, log, "v", 6, 3) }]);
    c.flush(1);
    expect(log).toEqual(["v0"]); // a second 3 ms step would end at 6 ms
    moving = false;
    c.flush(1);
    expect(log).toEqual(["v0", "v1", "v2", "v3"]);
  });

  it("drops a job that fails, and goes on with the next", () => {
    const c = fakeClock(),
      log: string[] = [];
    const errors: unknown[] = [];
    const r = new SliceRunner(c, { sliceMs: 10, onError: (e) => errors.push(e) });
    r.set("view", [
      {
        key: "bad",
        start: () =>
          (function* () {
            yield;
            throw new Error("lost the canvas");
          })(),
      },
      { key: "v", start: () => job(c, log, "v", 1, 1) },
    ]);
    c.flush();
    expect(errors).toHaveLength(1);
    expect(log).toEqual(["v0"]);
  });
});
