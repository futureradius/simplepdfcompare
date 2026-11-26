// Hand-made drawn objects for focused tests: lines, areas, hatches and labels in page mm.

import type { DrawnObject, GlyphObject } from "../compare/objects";

export const BLACK = "0.000,0.000,0.000",
  WHITE = "1.000,1.000,1.000",
  RED = "1.000,0.000,0.000",
  BLUE = "0.000,0.000,1.000";

export const line = (pts: number[], { colour = BLACK, width = 0.25, closed = false } = {}): DrawnObject => ({
  kind: "stroke",
  style: `stroke|${colour}|d0|0|1.00`,
  nums: [width],
  polys: [{ pts, closed }],
  clip: null,
  halfWidth: width / 2,
});

export const rect = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1];

export const area = (pts: number[], colour = BLACK): DrawnObject => ({
  kind: "fill",
  style: `fill|${colour}|0|1.00`,
  nums: [],
  polys: [{ pts, closed: true }],
  clip: null,
});

export const hatch = (pts: number[], colour = BLACK): DrawnObject => ({
  kind: "hatch",
  style: `hatch|s${colour}:2`,
  nums: [1.5, 1.5, 0.12],
  polys: [{ pts, closed: true }],
  clip: null,
});

let spanNo = 1000;
/**
 * A label line with its baseline at (x, y): letters `size` mm high and 0.6 × size wide.
 * Upright (reading upwards): the baseline runs up from (x, y), the letters to its left.
 */
export function text(s: string, x: number, y: number, { colour = BLACK, size = 2.5, up = false } = {}): GlyphObject[] {
  const span = ++spanNo,
    w = 0.6 * size;
  return [...s].map((ch, index) => ({
    kind: "glyph",
    style: `glyph|${ch}|Helvetica|${colour}`,
    nums: [size],
    ch,
    origin: up ? [x, y - w * index] : [x + w * index, y],
    box: up
      ? { x0: x - 0.8 * size, y0: y - w * (index + 1), x1: x + 0.2 * size, y1: y - w * index }
      : { x0: x + w * index, y0: y - 0.8 * size, x1: x + w * (index + 1), y1: y + 0.2 * size },
    span,
    index,
    clip: null,
  }));
}
