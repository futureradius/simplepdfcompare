import { describe, expect, it } from "vitest";
import { comparisonFrame, markMetrics, notCompared, rings } from "./compareframe";

// The synthetic 14 m pair's shape: the New Plan lies 560 mm further down in the Old frame.
const pages = { old: [1189, 13710] as const, new: [1189, 13990] as const };
const setup = { axis: "y" as const, offset: 560, old: { body: [100, 13600] as const, ignored: [] }, new: { body: [100, 13880] as const, ignored: [] } };

describe("comparisonFrame", () => {
  it("holds both Plans, the New Plan moved by the Offset", () => {
    expect(comparisonFrame(pages, "y", 560)).toEqual({ x0: 0, y0: 0, x1: 1189, y1: 14550 });
  });

  it("starts before the Old Plan when the Offset is negative, along x for a waagerecht Plan", () => {
    expect(comparisonFrame({ old: [600, 400], new: [650, 420] }, "x", -36)).toEqual({ x0: -36, y0: 0, x1: 614, y1: 420 });
  });
});

describe("notCompared", () => {
  const zones = notCompared(setup, [660, 13600], pages);
  const of = (plan: string, kind: string) => zones.filter((z) => z.plan === plan && z.kind === kind).map((z) => [z.rect.y0, z.rect.y1]);

  it("dims each Plan's Header and Footer, in the Old frame", () => {
    expect(of("old", "header")).toEqual([[0, 100]]);
    expect(of("old", "footer")).toEqual([[13600, 13710]]);
    expect(of("new", "header")).toEqual([[560, 660]]);
    expect(of("new", "footer")).toEqual([[14440, 14550]]);
  });

  it("hatches the Overhang: the Body with no counterpart in the other Plan", () => {
    expect(of("old", "overhang")).toEqual([[100, 660]]);
    expect(of("new", "overhang")).toEqual([[13600, 14440]]);
    expect(zones.find((z) => z.plan === "old" && z.kind === "overhang")!.label).toBe("nur im alten Plan");
    expect(zones.find((z) => z.plan === "new" && z.kind === "overhang")!.label).toBe("nur im neuen Plan");
  });

  it("runs across the whole Plan", () => {
    for (const z of zones) expect([z.rect.x0, z.rect.x1]).toEqual([0, 1189]);
  });

  it("has no Overhang when both Bodies cover the same timespan", () => {
    const same = notCompared({ ...setup, offset: 0, new: setup.old }, [100, 13600], { old: pages.old, new: pages.old });
    expect(same.filter((z) => z.kind === "overhang")).toEqual([]);
  });
});

describe("rings: Places smaller than 18 px get a ring, so nothing vanishes when zoomed out", () => {
  const view = { x0: 0, y0: 0, x1: 1000, y1: 1000 };
  const place = (no: number, x0: number, y0: number, w: number, h: number, added = true, removed = false) => ({
    no,
    box: { x0, y0, x1: x0 + w, y1: y0 + h },
    added,
    removed,
  });

  it("a Place 10 mm long gets a ring at 1 px per mm but not at 2", () => {
    const p = [place(1, 100, 200, 10, 5)];
    expect(rings(p, 1, view)).toEqual([{ no: 1, x: 105, y: 202.5, kind: "added" }]);
    expect(rings(p, 2, view)).toEqual([]);
  });

  it("18 px is big enough, by the longer side", () => {
    expect(rings([place(1, 0, 0, 18, 1)], 1, view)).toEqual([]);
    expect(rings([place(1, 0, 0, 17.9, 17.9)], 1, view)).toHaveLength(1);
  });

  it("the ring is red for Added, yellow for Removed, both for a Place with both", () => {
    const r = rings([place(1, 0, 0, 1, 1, true, false), place(2, 5, 5, 1, 1, false, true), place(3, 9, 9, 1, 1, true, true)], 1, view);
    expect(r.map((x) => x.kind)).toEqual(["added", "removed", "both"]);
  });

  it("only for Places in view, with a margin for the ring itself", () => {
    expect(rings([place(1, 1100, 500, 1, 1)], 1, view)).toEqual([]);
    expect(rings([place(1, 1010, 500, 1, 1)], 1, view)).toHaveLength(1);
  });
});

describe("markMetrics: outline width and x size stay the same on screen", () => {
  const settings = { outline: 6, xSize: 70 };
  for (const s of [0.05, 0.5, 8]) {
    it(`at ${s} px per mm`, () => {
      const m = markMetrics(settings, s, 1);
      expect(m.outlineMm * s).toBeCloseTo(6);
      expect(m.minLineMm * s).toBeCloseTo(1.5);
      expect(m.xxx.dashMm * s).toBeCloseTo(6.3);
      expect(m.xxx.gapMm * s).toBeCloseTo(6.3);
      expect(m.xxx.distanceMm * s).toBeCloseTo(6);
      expect(m.xxx.lineMm * s).toBeCloseTo(1.49);
      expect(m.xxx.crossHalfPx).toBeCloseTo(2.52);
    });
  }

  it("the x–x–x keeps 4 px from the object when there is no outline", () => {
    expect(markMetrics({ outline: 0, xSize: 70 }, 2, 1).xxx.distanceMm * 2).toBeCloseTo(4);
  });

  it("the x size scales the dashes and the crosses", () => {
    const m = markMetrics({ outline: 6, xSize: 100 }, 1, 1);
    expect(m.xxx.dashMm).toBeCloseTo(9);
    expect(m.xxx.crossHalfPx).toBeCloseTo(3.6);
  });

  it("counts in device pixels on a screen with 2 px per CSS px", () => {
    const m = markMetrics(settings, 4, 2);
    expect(m.outlineMm * 4).toBeCloseTo(12);
    expect(m.xxx.crossHalfPx).toBeCloseTo(5.04);
  });
});
