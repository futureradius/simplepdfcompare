import { describe, expect, it } from "vitest";
import type { Mark } from "../compare/compare";
import type { Box } from "../compare/objects";
import { boxOutline, OUTLINE_MARGIN_MM, outlineGroups, outlineOf, signedArea } from "./outlines";

const word = (x0: number, y0: number, x1: number, y1: number, kind: Mark["kind"] = "Removed"): Mark => ({
  kind,
  shape: "word",
  coords: [],
  lineWidth: 0,
  box: { x0, y0, x1, y1 },
  restyled: false,
  plan: kind === "Removed" ? "old" : "new",
  objects: [0],
  text: "w",
});

/** A line through the points, `w` mm wide. */
const line = (pts: number[], w = 0.3, kind: Mark["kind"] = "Removed"): Mark => {
  const coords: number[] = [];
  for (let i = 0; i + 3 < pts.length; i += 2) coords.push(pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!);
  const xs = pts.filter((_, i) => i % 2 === 0),
    ys = pts.filter((_, i) => i % 2 === 1);
  const box = { x0: Math.min(...xs) - w / 2, y0: Math.min(...ys) - w / 2, x1: Math.max(...xs) + w / 2, y1: Math.max(...ys) + w / 2 };
  return { kind, shape: "line", coords, lineWidth: w, box, restyled: false, plan: "old", objects: [0] };
};

const area = (b: Box, kind: Mark["kind"] = "Removed"): Mark => ({
  kind,
  shape: "area",
  coords: [b.x0, b.y0, b.x1, b.y0, b.x1, b.y1, b.x0, b.y1, NaN, NaN],
  lineWidth: 0,
  box: b,
  restyled: false,
  plan: "old",
  objects: [0],
});

const boxOf = (c: number[]): Box => {
  const xs = c.filter((_, i) => i % 2 === 0),
    ys = c.filter((_, i) => i % 2 === 1);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};

const distToRect = (x: number, y: number, b: Box) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));

describe("outlineOf: one outline around the marks, each grown by a small margin", () => {
  const m = OUTLINE_MARGIN_MM;

  it("goes around a word at the margin", () => {
    const b = { x0: 10, y0: 20, x1: 22, y1: 23 };
    const o = outlineOf([word(b.x0, b.y0, b.x1, b.y1)]);
    expect(o.outer).toHaveLength(1);
    expect(o.holes).toHaveLength(0);
    const c = o.outer[0]!;
    for (let i = 0; i < c.length; i += 2) expect(Math.abs(distToRect(c[i]!, c[i + 1]!, b) - m)).toBeLessThan(0.08);
    const ob = boxOf(c);
    expect(ob.x0).toBeCloseTo(b.x0 - m, 1);
    expect(ob.y1).toBeCloseTo(b.y1 + m, 1);
    expect(o.box.x0).toBeLessThanOrEqual(ob.x0);
  });

  it("merges the words of a label into one outline", () => {
    const o = outlineOf([word(0, 0, 8, 3), word(9, 0, 15, 3), word(0, 4, 12, 7)]);
    expect(o.outer).toHaveLength(1);
    expect(o.holes).toHaveLength(0);
  });

  it("keeps parts far apart, with nothing between them, apart", () => {
    const o = outlineOf([word(0, 0, 8, 3), word(40, 0, 48, 3)]);
    expect(o.outer).toHaveLength(2);
  });

  it("makes a hatch and its border one shape, with no line inside the hatch", () => {
    const b = { x0: 0, y0: 0, x1: 60, y1: 6 };
    const o = outlineOf([area(b), line([b.x0, b.y0, b.x1, b.y0, b.x1, b.y1, b.x0, b.y1, b.x0, b.y0], 0.35)]);
    expect(o.outer).toHaveLength(1);
    expect(o.holes).toHaveLength(0);
  });

  it("makes a removed bar, its leader and its label one unbroken shape", () => {
    const o = outlineOf([area({ x0: 0, y0: 10, x1: 80, y1: 14 }), line([40, 10, 46, 2], 0.25), word(46, -1, 60, 2), word(61, -1, 70, 2)]);
    expect(o.outer).toHaveLength(1);
  });

  it("an empty frame keeps its inside as a hole", () => {
    const o = outlineOf([line([0, 0, 40, 0, 40, 40, 0, 40, 0, 0], 0.3)]);
    expect(o.outer).toHaveLength(1);
    expect(o.holes).toHaveLength(1);
    const h = boxOf(o.holes[0]!);
    expect(h.x0).toBeCloseTo(0.15 + m, 1);
    expect(h.x1).toBeCloseTo(40 - 0.15 - m, 1);
  });

  it("stays small for a long line", () => {
    const o = outlineOf([line([0, 0, 14000, 0], 0.5)]);
    expect(o.outer).toHaveLength(1);
    expect(o.outer[0]!.length / 2).toBeLessThan(400);
    expect(boxOf(o.outer[0]!).x1).toBeCloseTo(14000 + 0.25 + m, 0);
  });
});

describe("boxOutline: the rough outline until the real one is made", () => {
  it("goes around the box at the margin, turning the way the real outer contours do", () => {
    const b = { x0: 10, y0: 20, x1: 30, y1: 24 };
    const o = boxOutline(b);
    expect(o.outer).toHaveLength(1);
    expect(signedArea(o.outer[0]!)).toBeLessThan(0);
    expect(signedArea(outlineOf([word(10, 20, 30, 24)]).outer[0]!)).toBeLessThan(0);
    const ob = boxOf(o.outer[0]!);
    expect(ob.x0).toBeCloseTo(b.x0 - OUTLINE_MARGIN_MM, 6);
    expect(ob.y1).toBeCloseTo(b.y1 + OUTLINE_MARGIN_MM, 6);
  });
});

describe("outlineGroups: per Place and colour, of the shown marks", () => {
  const marks = [
    word(0, 0, 1, 1, "Added"),
    word(0, 0, 1, 1, "Removed"),
    word(2, 0, 3, 1, "Removed"),
    word(50, 0, 51, 1, "Removed"),
    word(90, 0, 91, 1, "Added"),
  ];
  const places = [
    { no: 1, marks: [0, 1, 2] },
    { no: 2, marks: [3] },
  ];

  it("one group per Place and colour, a mark of no Place alone", () => {
    const g = outlineGroups(places, marks, () => true);
    expect(g.map((x) => [x.place, x.kind, x.marks])).toEqual([
      [1, "Added", [0]],
      [1, "Removed", [1, 2]],
      [2, "Removed", [3]],
      [null, "Added", [4]],
    ]);
    expect(g[1]!.box).toEqual({ x0: 0, y0: 0, x1: 3, y1: 1 });
  });

  it("leaves out what is not shown, and its key names the marks it holds", () => {
    const all = outlineGroups(places, marks, () => true);
    const some = outlineGroups(places, marks, (i) => i !== 2 && i !== 3);
    expect(some.map((x) => [x.place, x.kind, x.marks])).toEqual([
      [1, "Added", [0]],
      [1, "Removed", [1]],
      [null, "Added", [4]],
    ]);
    expect(some[1]!.key).not.toBe(all[1]!.key);
    expect(some[0]!.key).toBe(all[0]!.key);
  });
});
