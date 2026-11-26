// Finding the Offset by voting over identical shapes (ADR 0001), against the ground truth.
import { describe, expect, it } from "vitest";
import { findOffset, findOffsetAsync, OffsetCancelled } from "./offset";
import { axisOf, type DrawnObject } from "./objects";
import { objectsOf, pair } from "../testing/groundtruth";

const line = (x0: number, y0: number, x1: number, y1: number, colour = "0.000,0.000,0.000"): DrawnObject => ({
  kind: "stroke",
  style: `stroke|${colour}|d0|0|1.00`,
  nums: [0.25],
  polys: [{ pts: [x0, y0, x1, y1], closed: false }],
  clip: null,
  halfWidth: 0.125,
});

describe("finding the Offset", () => {
  for (const name of ["down", "right"]) {
    it(`finds the ground-truth Offset of the ${name} pair as the best candidate`, () => {
      const gt = pair(name);
      const r = findOffset(objectsOf(gt.old.file), objectsOf(gt.new.file), {
        axis: axisOf(gt.timeDirection),
        bodyOld: gt.old.bodyMm,
        bodyNew: gt.new.bodyMm,
      });
      expect(r.candidates[0]!.offset).toBeCloseTo(gt.offsetMm, 2);
      expect(r.offset).toBe(r.candidates[0]!.offset);
    });
  }

  it("lists other candidates after the best, with fewer votes and at least 1 mm apart", () => {
    // Three short lines moved by 10 mm, one of them also repeats 30 mm further on.
    const old = [line(10, 50, 12, 52), line(20, 60, 25, 60), line(40, 70, 40, 75), line(40, 100, 40, 105)];
    const nu = [line(10, 40, 12, 42), line(20, 50, 25, 50), line(40, 60, 40, 65)];
    const r = findOffset(old, nu, { axis: "y", bodyOld: [0, 200], bodyNew: [0, 200] });
    expect(r.candidates.map((c) => [Math.round(c.offset * 1000) / 1000, c.votes])).toEqual([
      [10, 3],
      [40, 1],
    ]);
  });

  it("votes only along the Time direction: a shape moved across is no vote", () => {
    const old = [line(10, 50, 12, 52), line(20, 60, 25, 60)];
    const nu = [line(11, 40, 13, 42), line(20, 40, 25, 40)];
    const r = findOffset(old, nu, { axis: "y", bodyOld: [0, 200], bodyNew: [0, 200] });
    expect(r.candidates).toEqual([{ offset: 20, votes: 1 }]);
  });

  it("leaves out the Header and Footer", () => {
    const old = [line(10, 5, 12, 6), line(20, 60, 25, 60)];
    const nu = [line(10, 5, 12, 6), line(20, 50, 25, 50)];
    const r = findOffset(old, nu, { axis: "y", bodyOld: [20, 200], bodyNew: [20, 200] });
    expect(r.candidates).toEqual([{ offset: 10, votes: 1 }]);
  });

  it("is 0 with no votes", () => {
    expect(findOffset([], [], { axis: "x", bodyOld: [0, 10], bodyNew: [0, 10] })).toEqual({ offset: 0, votes: 0, candidates: [] });
  });
});

describe("Ignored areas in the search", () => {
  const old = [line(10, 50, 12, 52), line(20, 60, 25, 60), line(40, 70, 40, 75)];
  const nu = [line(10, 40, 12, 42), line(20, 50, 25, 50), line(40, 60, 40, 65)];
  const opts = { axis: "y" as const, bodyOld: [0, 200] as [number, number], bodyNew: [0, 200] as [number, number] };

  it("leaves out an object whose middle is in an area of its own Plan", () => {
    // The Old line at y 60 has its middle at (22.5, 60); the New line at y 50 at (22.5, 50).
    const r = findOffset(old, nu, { ...opts, ignoredOld: [{ x0: 20, y0: 55, x1: 30, y1: 65 }] });
    expect(r.candidates).toEqual([{ offset: 10, votes: 2 }]);
    const r2 = findOffset(old, nu, { ...opts, ignoredNew: [{ x0: 20, y0: 45, x1: 30, y1: 55 }] });
    expect(r2.candidates).toEqual([{ offset: 10, votes: 2 }]);
  });

  it("keeps an object that an area only touches: the rule is the middle, as in the comparison", () => {
    const r = findOffset(old, nu, { ...opts, ignoredOld: [{ x0: 20, y0: 55, x1: 21, y1: 65 }] });
    expect(r.candidates).toEqual([{ offset: 10, votes: 3 }]);
  });
});

describe("the search that can be stopped", () => {
  const many = (dy: number) =>
    Array.from({ length: 600 }, (_, i) => line(10 + (i % 50), 20 + Math.floor(i / 50) * 7 + dy, 11 + (i % 50) + i * 0.02, 22 + Math.floor(i / 50) * 7 + dy));
  const opts = { axis: "y" as const, bodyOld: [0, 500] as [number, number], bodyNew: [0, 500] as [number, number] };

  it("finds what the plain search finds", async () => {
    const old = many(10),
      nu = many(0);
    const r = await findOffsetAsync(old, nu, opts, { pause: async () => {}, cancelled: () => false, chunk: 50 });
    expect(r).toEqual(findOffset(old, nu, opts));
    expect(r.offset).toBeCloseTo(10, 5);
  });

  it("gives the thread back between pieces", async () => {
    let pauses = 0;
    await findOffsetAsync(many(10), many(0), opts, { pause: async () => void pauses++, cancelled: () => false, chunk: 50 });
    expect(pauses).toBeGreaterThan(10);
  });

  it("stops when cancelled, and does no more work", async () => {
    let pauses = 0;
    const p = findOffsetAsync(many(10), many(0), opts, { pause: async () => void pauses++, cancelled: () => pauses >= 2, chunk: 50 });
    await expect(p).rejects.toBeInstanceOf(OffsetCancelled);
    expect(pauses).toBe(2);
  });
});
