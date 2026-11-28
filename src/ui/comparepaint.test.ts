import { describe, expect, it } from "vitest";
import { areaCost, costIn } from "./comparepaint";

describe("areaCost: filling costs by the pixels filled", () => {
  // 1 device px per mm, a 100 × 100 px tile at the origin.
  const v = { x0: 0, y0: 0, s: 1, w: 100, h: 100, dpr: 1 };

  it("is the part of a box on the tile, in thousands of device px", () => {
    expect(areaCost({ x0: 0, y0: 0, x1: 50, y1: 40 }, v)).toBe(2);
    expect(areaCost({ x0: 50, y0: 50, x1: 500, y1: 500 }, v)).toBe(2.5); // only 50 × 50 on the tile
  });

  it("is nothing for a box off the tile", () => {
    expect(areaCost({ x0: 200, y0: 0, x1: 300, y1: 10 }, v)).toBe(0);
  });
});

describe("costIn: what drawing a mark into a tile costs, for sizing the batches", () => {
  const view = { x0: 0, y0: 0, x1: 100, y1: 100 };

  it("is the number of a line's segments that touch the view", () => {
    // Three segments in view, one far outside.
    const coords = [0, 0, 10, 10, 10, 10, 20, 20, 20, 20, 30, 30, 500, 500, 510, 510];
    expect(costIn({ shape: "line", coords }, view)).toBe(3);
  });

  it("is the number of an area's edges that touch the view, the closing edge included", () => {
    const coords = [10, 10, 20, 10, 20, 20, 10, 20];
    expect(costIn({ shape: "area", coords }, view)).toBe(4);
  });

  it("counts each polygon of an area on its own (NaN between them)", () => {
    const coords = [10, 10, 20, 10, 20, 20, NaN, NaN, 300, 300, 310, 300, 310, 310];
    expect(costIn({ shape: "area", coords }, view)).toBe(3);
  });

  it("is at least one, also for a word or a mark just outside", () => {
    expect(costIn({ shape: "word", coords: [] }, view)).toBe(1);
    expect(costIn({ shape: "line", coords: [200, 200, 210, 210] }, view)).toBe(1);
  });
});
