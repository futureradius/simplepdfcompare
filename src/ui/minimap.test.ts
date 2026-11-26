import { describe, expect, it } from "vitest";
import { minimapShapes, minimapSize, minimapToMm, showsWholePlan } from "./minimap";
import { placeSpots } from "./compareframe";

describe("minimapSize", () => {
  it("a tall Plan is limited by 1/3 of the view height", () => {
    const s = minimapSize(1188.9, 14270.9, 1080, 850);
    expect(s.height).toBeCloseTo(850 / 3);
    expect(s.width / s.height).toBeCloseTo(1188.9 / 14270.9);
  });

  it("a wide Plan is limited by 1/3 of the view width", () => {
    const s = minimapSize(5000, 800, 1080, 850);
    expect(s.width).toBeCloseTo(360);
    expect(s.height).toBeLessThan(850 / 3);
  });
});

describe("showsWholePlan", () => {
  it("is true only when the whole Plan is inside the visible area", () => {
    expect(showsWholePlan({ x0: -100, y0: -10, x1: 1300, y1: 14300 }, 1188.9, 14270.9)).toBe(true);
    expect(showsWholePlan({ x0: 0, y0: 0, x1: 1188.9, y1: 14000 }, 1188.9, 14270.9)).toBe(false);
    expect(showsWholePlan({ x0: 10, y0: -10, x1: 1300, y1: 14300 }, 1188.9, 14270.9)).toBe(false);
  });

  it("measures from the frame's origin when it does not start at 0", () => {
    expect(showsWholePlan({ x0: -40, y0: -5, x1: 620, y1: 425 }, 650, 420, { x: -36, y: 0 })).toBe(true);
    expect(showsWholePlan({ x0: -30, y0: -5, x1: 620, y1: 425 }, 650, 420, { x: -36, y: 0 })).toBe(false);
  });
});

describe("Places on the minimap (ADR 0009)", () => {
  const spot = (no: number, x0: number, y0: number, w: number, h: number, added: boolean, removed: boolean) => ({ no, box: { x0, y0, x1: x0 + w, y1: y0 + h }, added, removed });
  const origin = { x: 0, y: 0 };

  it("a Place too small to show a shape is a circle 3 px across, at its middle", () => {
    const [s] = minimapShapes([spot(1, 1000, 2000, 20, 40, true, false)], 0.02, origin);
    expect(s).toMatchObject({ type: "dot", no: 1, d: 3, colour: "added" });
    if (s!.type !== "dot") return;
    expect(s.x).toBeCloseTo(20.2);
    expect(s.y).toBeCloseTo(40.4);
  });

  it("a bigger Place is its own shape, outlined to at least 3 px in every direction", () => {
    const [s] = minimapShapes([spot(1, 0, 1000, 1189, 2, false, true)], 0.02, origin);
    expect(s!.type).toBe("shape");
    if (s!.type !== "shape") return;
    expect(s.strokePx).toBe(3);
    expect(s.box.y1 - s.box.y0).toBeGreaterThanOrEqual(3);
    expect(s.box.x0).toBeCloseTo(-1.5);
    expect(s.box.x1).toBeCloseTo(23.78 + 1.5);
  });

  it("is red if the Place has any Added part, yellow if it is only Removed", () => {
    const shapes = minimapShapes([spot(1, 0, 0, 1, 1, true, true), spot(2, 0, 0, 1, 1, false, true), spot(3, 0, 0, 1, 1, true, false)], 0.02, origin);
    expect(shapes.map((s) => s.colour)).toEqual(["added", "removed", "added"]);
  });

  it("lies in the comparison frame, which may start before the Old Plan", () => {
    const [s] = minimapShapes([spot(1, -36, 10, 1, 1, true, false)], 1, { x: -36, y: 0 });
    expect(s).toMatchObject({ x: 0.5, y: 10.5 });
  });
});

describe("Places on the minimap follow the filter and hiding", () => {
  const places = [
    { no: 1, marks: [0, 1] },
    { no: 2, marks: [2] },
  ];
  const box = (y: number) => ({ x0: 0, y0: y, x1: 10, y1: y + 10 });
  const marks = [
    { kind: "Added" as const, box: box(0) },
    { kind: "Removed" as const, box: box(100) },
    { kind: "Removed" as const, box: box(500) },
  ];

  it("every Place, with all its marks, when nothing is filtered or hidden", () => {
    expect(placeSpots(places, marks, {})).toEqual([
      { no: 1, box: { x0: 0, y0: 0, x1: 10, y1: 110 }, added: true, removed: true },
      { no: 2, box: box(500), added: false, removed: true },
    ]);
  });

  it("a hidden or filtered-out Place is left out", () => {
    expect(placeSpots(places, marks, { place: (no) => no !== 2 }).map((s) => s.no)).toEqual([1]);
  });

  it("a mark filtered out by its own kind no longer counts: the Place turns yellow and shrinks", () => {
    expect(placeSpots(places, marks, { mark: (i) => i !== 0 })[0]).toEqual({ no: 1, box: box(100), added: false, removed: true });
  });

  it("a Place whose marks are all filtered out is left out", () => {
    expect(placeSpots(places, marks, { mark: (i) => i !== 2 }).map((s) => s.no)).toEqual([1]);
  });
});

describe("a click on the minimap centres the view there", () => {
  it("from minimap px to Old frame mm", () => {
    expect(minimapToMm({ x: 50, y: 100 }, 0.02, { x: 0, y: 0 })).toEqual({ x: 2500, y: 5000 });
    expect(minimapToMm({ x: 0, y: 10 }, 0.5, { x: -36, y: 0 })).toEqual({ x: -36, y: 20 });
  });
});
