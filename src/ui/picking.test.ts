import { describe, expect, it } from "vitest";
import type { Mark } from "../compare/compare";
import { boxSelect, markInsideRect, markNearPoint, markTouchesRect, placeAt, type Pickable } from "./picking";

type M = Pick<Mark, "shape" | "coords" | "lineWidth" | "box">;
const line = (x0: number, y0: number, x1: number, y1: number, lineWidth = 0.4): M => ({
  shape: "line",
  coords: [x0, y0, x1, y1],
  lineWidth,
  box: { x0: Math.min(x0, x1) - lineWidth / 2, y0: Math.min(y0, y1) - lineWidth / 2, x1: Math.max(x0, x1) + lineWidth / 2, y1: Math.max(y0, y1) + lineWidth / 2 },
});
const area = (x0: number, y0: number, x1: number, y1: number): M => ({ shape: "area", coords: [x0, y0, x1, y0, x1, y1, x0, y1, NaN, NaN], lineWidth: 0, box: { x0, y0, x1, y1 } });
const rect = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

describe("what lies under the pointer", () => {
  it("hits a line near it, not the empty corner of its box", () => {
    const diagonal = line(0, 0, 100, 100);
    expect(markNearPoint(diagonal, { x: 50, y: 50.5 }, 1)).toBe(true);
    expect(markNearPoint(diagonal, { x: 90, y: 10 }, 1)).toBe(false);
  });

  it("hits an area or a word inside its box", () => {
    expect(markNearPoint(area(0, 0, 10, 10), { x: 5, y: 5 }, 1)).toBe(true);
    expect(markNearPoint(area(0, 0, 10, 10), { x: 12, y: 5 }, 1)).toBe(false);
  });

  it("picks the smallest Place under the pointer", () => {
    const big: Pickable = { no: 1, box: rect(0, 0, 100, 100), marks: [area(0, 0, 100, 100)] };
    const small: Pickable = { no: 2, box: rect(40, 40, 60, 60), marks: [area(40, 40, 60, 60)] };
    expect(placeAt([big, small], { x: 50, y: 50 }, 1)).toBe(2);
    expect(placeAt([big, small], { x: 10, y: 10 }, 1)).toBe(1);
    expect(placeAt([big, small], { x: 200, y: 10 }, 1)).toBeNull();
  });

  it("lets a ring stand for a Place too small to hit", () => {
    const tiny: Pickable = { no: 3, box: rect(0, 0, 0.2, 0.2), marks: [area(0, 0, 0.2, 0.2)] };
    expect(placeAt([tiny], { x: 5, y: 5 }, 1)).toBeNull();
    expect(placeAt([tiny], { x: 5, y: 5 }, 1, (p) => p.no === 3)).toBe(3);
  });
});

describe("selection boxes, as in CAD", () => {
  const a: Pickable = { no: 1, box: rect(10, 10, 30, 30), marks: [area(10, 10, 30, 12), line(10, 30, 30, 30)] };
  const b: Pickable = { no: 2, box: rect(100, 100, 120, 120), marks: [line(100, 100, 120, 120)] };
  const places = [a, b];

  it("takes what lies fully inside, when dragged to the right", () => {
    expect(boxSelect(places, rect(0, 0, 40, 40), false)).toEqual([1]);
    expect(boxSelect(places, rect(0, 0, 25, 40), false)).toEqual([]); // a part is outside
    expect(boxSelect(places, rect(0, 0, 200, 200), false)).toEqual([1, 2]);
  });

  it("takes what it touches, when dragged to the left", () => {
    expect(boxSelect(places, rect(0, 0, 25, 40), true)).toEqual([1]);
    expect(boxSelect(places, rect(105, 95, 112, 99.9), true)).toEqual([]);
    expect(boxSelect(places, rect(95, 95, 105, 105), true)).toEqual([2]);
  });

  it("does not touch a Place by the empty corner of a diagonal line's box", () => {
    expect(boxSelect([b], rect(100, 115, 105, 120), true)).toEqual([]);
    expect(markTouchesRect(b.marks[0]!, rect(100, 115, 105, 120))).toBe(false);
    expect(markTouchesRect(b.marks[0]!, rect(108, 108, 112, 112))).toBe(true);
  });

  it("tells inside from touching for one mark", () => {
    expect(markInsideRect(a.marks[0]!, rect(0, 0, 40, 40))).toBe(true);
    expect(markInsideRect(a.marks[0]!, rect(0, 0, 20, 40))).toBe(false);
  });
});
