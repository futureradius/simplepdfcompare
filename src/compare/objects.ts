// The drawn objects of a Plan, as the comparison sees them (ADR 0001): lines, areas,
// hatched areas and letters, in page mm with the origin at the top left of the Plan's
// page. Extracted inside the Plan's worker (src/engine/extract.ts); everything in
// src/compare/ is pure logic on them, with no MuPDF and no DOM.

/** A box in mm. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** One subpath, as flat [x, y, x, y, ...] mm. Curves are flattened to 8 segments. */
export interface Poly {
  pts: number[];
  closed: boolean;
}

/**
 * The Time direction as the coordinate it runs along: "y" when time runs down, "x" when it
 * runs to the right.
 */
export type Axis = "x" | "y";

export type TimeDirection = "down" | "right";

export const axisOf = (d: TimeDirection): Axis => (d === "down" ? "y" : "x");

interface ObjectBase {
  /**
   * Everything about how the object is drawn except its numbers: kind, colour, dashes,
   * cap, alpha, font, letter. Two objects can only be the same when their styles are.
   * Colours are written as 0.123,0.456,... so they can be dropped (see withoutColour).
   */
  style: string;
  /** Line width, dash lengths, letter size or hatch cell, in mm: equal within 0.01 mm. */
  nums: number[];
  /** The rectangle the object is clipped to, if it is clipped to one. */
  clip: Box | null;
}

/** A stroked path: a line, possibly with bends, or an outline. */
export interface StrokeObject extends ObjectBase {
  kind: "stroke";
  polys: Poly[];
  /** Half the line width, mm. */
  halfWidth: number;
}

/** A filled area. */
export interface FillObject extends ObjectBase {
  kind: "fill";
  polys: Poly[];
}

/** An area filled with a hatch pattern. Its pattern is in style and nums, not its phase. */
export interface HatchObject extends ObjectBase {
  kind: "hatch";
  polys: Poly[];
}

/** One letter of a text. Words are runs of letters of one span between spaces. */
export interface GlyphObject extends ObjectBase {
  kind: "glyph";
  ch: string;
  /** Where the letter sits on its baseline. */
  origin: [number, number];
  box: Box;
  /** The text span the letter belongs to (a label line), numbered in drawing order. */
  span: number;
  /** Its place in the span. */
  index: number;
}

export type DrawnObject = StrokeObject | FillObject | HatchObject | GlyphObject;

export function boxOfPoints(flat: ArrayLike<number>): Box {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const x = flat[i]!,
      y = flat[i + 1]!;
    if (Number.isNaN(x)) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

export const unionBox = (a: Box, b: Box): Box => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
});

export const intersectBox = (a: Box, b: Box): Box => ({
  x0: Math.max(a.x0, b.x0),
  y0: Math.max(a.y0, b.y0),
  x1: Math.min(a.x1, b.x1),
  y1: Math.min(a.y1, b.y1),
});

export const boxesTouch = (a: Box, b: Box, pad = 0): boolean =>
  a.x0 - pad <= b.x1 && b.x0 - pad <= a.x1 && a.y0 - pad <= b.y1 && b.y0 - pad <= a.y1;

/** The box of an object as drawn on its own page (no clip, no line width). */
export function outlineBox(o: DrawnObject): Box {
  if (o.kind === "glyph") return o.box;
  let b: Box | undefined;
  for (const p of o.polys) {
    const pb = boxOfPoints(p.pts);
    b = b ? unionBox(b, pb) : pb;
  }
  return b ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
}

/** A style without its colours, to find recoloured objects. */
export const withoutColour = (style: string): string => style.replace(/\d+\.\d{3}(?:,\d+\.\d{3})*/g, "c");
