// Picking Places on the Plan (ADR 0003): what lies under the pointer, and the CAD-style
// selection box (dragged to the right it takes what lies fully inside, to the left what it
// touches). Geometry in mm in the Old frame; only the shown marks of the shown Places take part.
//
// Ported from the comparison-view prototype (prototypes/comparison/variant-a.mjs: placeAt,
// itemNear, touches, encloses, segTouches).

import type { Mark } from "../compare/compare";
import type { Box } from "../compare/objects";

export type PickMark = Pick<Mark, "shape" | "coords" | "lineWidth" | "box">;

/** A Place as the Plan shows it now: the box of its shown marks and those marks. */
export interface Pickable {
  no: number;
  box: Box;
  marks: readonly PickMark[];
}

const boxesOverlap = (b: Box, r: Box) => b.x0 <= r.x1 && b.x1 >= r.x0 && b.y0 <= r.y1 && b.y1 >= r.y0;
const boxInside = (b: Box, r: Box) => b.x0 >= r.x0 && b.x1 <= r.x1 && b.y0 >= r.y0 && b.y1 <= r.y1;

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax,
    dy = by - ay,
    len = dx * dx + dy * dy;
  const u = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - ax - u * dx, py - ay - u * dy);
}

/** Liang–Barsky: does the segment touch the rectangle? */
function segmentTouches(x0: number, y0: number, x1: number, y1: number, r: Box): boolean {
  let t0 = 0,
    t1 = 1;
  const dx = x1 - x0,
    dy = y1 - y0;
  for (const [p, q] of [
    [-dx, x0 - r.x0],
    [dx, r.x1 - x0],
    [-dy, y0 - r.y0],
    [dy, r.y1 - y0],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

/** Is the point on this mark: near one of a line's segments (`tol` mm and half its width), or inside an area's or word's box. */
export function markNearPoint(m: PickMark, p: { x: number; y: number }, tol: number): boolean {
  const b = m.box;
  if (p.x < b.x0 - tol || p.x > b.x1 + tol || p.y < b.y0 - tol || p.y > b.y1 + tol) return false;
  if (m.shape !== "line") return true;
  const k = m.coords,
    reach = tol + m.lineWidth / 2;
  for (let q = 0; q + 3 < k.length; q += 4) if (distanceToSegment(p.x, p.y, k[q]!, k[q + 1]!, k[q + 2]!, k[q + 3]!) <= reach) return true;
  return false;
}

/** Does the rectangle touch this mark: a line by its segments, an area or word by its box. */
export function markTouchesRect(m: PickMark, r: Box): boolean {
  if (!boxesOverlap(m.box, r)) return false;
  if (m.shape !== "line") return true;
  const k = m.coords,
    h = m.lineWidth / 2;
  const grown = { x0: r.x0 - h, y0: r.y0 - h, x1: r.x1 + h, y1: r.y1 + h };
  for (let q = 0; q + 3 < k.length; q += 4) if (segmentTouches(k[q]!, k[q + 1]!, k[q + 2]!, k[q + 3]!, grown)) return true;
  return false;
}

export const markInsideRect = (m: PickMark, r: Box): boolean => boxInside(m.box, r);

const area = (b: Box) => (b.x1 - b.x0) * (b.y1 - b.y0);

/**
 * The smallest Place under the point, or null. `ringHit` lets a Place count that has no mark
 * under the point but a ring there (a Place too small to hit).
 */
export function placeAt(places: readonly Pickable[], p: { x: number; y: number }, tolMm: number, ringHit?: (p: Pickable) => boolean): number | null {
  let best: Pickable | null = null;
  for (const pl of places) {
    const hit = (ringHit?.(pl) ?? false) || (pl.marks.some((m) => markNearPoint(m, p, tolMm)));
    if (hit && (!best || area(pl.box) < area(best.box))) best = pl;
  }
  return best ? best.no : null;
}

/** The Places a selection box takes: with `crossing` (dragged to the left) those it touches, else those fully inside. */
export function boxSelect(places: readonly Pickable[], r: Box, crossing: boolean): number[] {
  return places.filter((p) => (crossing ? p.marks.some((m) => markTouchesRect(m, r)) : p.marks.length > 0 && p.marks.every((m) => markInsideRect(m, r)))).map((p) => p.no);
}
