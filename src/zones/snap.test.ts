import { describe, expect, it } from "vitest";
import type { DrawnObject } from "../compare/objects";
import { buildSegments, snapBox, snapLine, snapEdge, SegmentIndex } from "./snap";

const stroke = (...pts: number[]): DrawnObject => ({ kind: "stroke", polys: [{ pts, closed: false }], halfWidth: 0.1, style: "s", nums: [0.2], clip: null });
const rect = (x0: number, y0: number, x1: number, y1: number): DrawnObject => ({
  kind: "fill",
  polys: [{ pts: [x0, y0, x1, y0, x1, y1, x0, y1], closed: true }],
  style: "f",
  nums: [],
  clip: null,
});
const glyph = (): DrawnObject => ({ kind: "glyph", ch: "I", origin: [50, 50], box: { x0: 50, y0: 40, x1: 51, y1: 50 }, span: 0, index: 0, style: "g", nums: [], clip: null });

const index = (objs: DrawnObject[]) => SegmentIndex.from(buildSegments(objs));

describe("buildSegments", () => {
  it("keeps straight horizontal and vertical segments of at least 2 mm, not text", () => {
    const s = buildSegments([stroke(10, 100, 60, 100), stroke(20, 5, 20, 6), stroke(0, 0, 30, 40), glyph(), rect(200, 300, 260, 340)]);
    // horizontals: the stroke at y=100 and the rectangle's two; verticals: the rectangle's two (the 1 mm one is too short)
    expect(s.h.length / 3).toBe(3);
    expect(s.v.length / 3).toBe(2);
  });
});

describe("snapEdge", () => {
  const idx = index([stroke(0, 100, 50, 100), stroke(0, 103, 5, 103)]);
  it("finds the nearest segment alongside the edge within the tolerance", () => {
    expect(snapEdge(idx, "y", 101, 10, 40, 2)).toMatchObject({ pos: 100 });
  });
  it("ignores a segment that does not run alongside the edge", () => {
    expect(snapEdge(idx, "y", 103.5, 20, 40, 2)).toBeNull();
  });
  it("finds nothing beyond the tolerance", () => {
    expect(snapEdge(idx, "y", 110, 0, 40, 2)).toBeNull();
  });
});

describe("snapBox", () => {
  const idx = index([stroke(100, 0, 100, 500), stroke(0, 300, 400, 300)]);
  it("snaps the edges the handle moves and reports a guide per edge", () => {
    const r = snapBox({ x0: 40, y0: 250, x1: 101.5, y1: 301 }, "se", idx, 3);
    expect(r.box).toEqual({ x0: 40, y0: 250, x1: 100, y1: 300 });
    expect(r.guides.map((g) => g.vertical).sort()).toEqual([false, true]);
  });
  it("does not touch edges the handle does not move", () => {
    const r = snapBox({ x0: 99, y0: 250, x1: 200, y1: 301 }, "s", idx, 3);
    expect(r.box.x0).toBe(99);
    expect(r.box.y1).toBe(300);
  });
  it("moves a whole box so that its nearer edge sits on the line", () => {
    const r = snapBox({ x0: 51, y0: 200, x1: 98.5, y1: 280 }, "move", idx, 3);
    expect(r.box.x1).toBe(100);
    expect(r.box.x0).toBeCloseTo(52.5);
  });
});

describe("snapBox and the visible part of the Plan", () => {
  // A tall box beside a line that lies far off screen: only what the user sees may attract.
  const idx = index([stroke(100, 5000, 100, 5200)]);
  const tall = { x0: 40, y0: 0, x1: 101, y1: 9000 };
  it("ignores lines outside the visible area", () => {
    const r = snapBox(tall, "e", idx, 3, { x0: 0, y0: 0, x1: 500, y1: 800 });
    expect(r.box.x1).toBe(101);
    expect(r.guides).toEqual([]);
  });
  it("uses lines inside it", () => {
    const r = snapBox(tall, "e", idx, 3, { x0: 0, y0: 4900, x1: 500, y1: 5500 });
    expect(r.box.x1).toBe(100);
  });
});

describe("snapLine", () => {
  it("jumps to the nearest line across the Plan within the tolerance", () => {
    expect(snapLine([100, 200, 300], 203, 5)).toBe(200);
    expect(snapLine([100, 200, 300], 220, 5)).toBe(220);
  });
});
