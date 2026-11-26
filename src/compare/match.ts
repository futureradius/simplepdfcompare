// Placing a Plan's objects in the Old Plan's frame and matching them one to one (ADR 0001).
// Ported from the detection prototype (placeObjects, matchObjects).

import { clipPolygon, clipSegment } from "./geometry";
import { boxOfPoints, intersectBox, withoutColour, type Axis, type Box, type DrawnObject } from "./objects";

/** An object moved into the Old Plan's frame and clipped to what is compared. */
export interface Placed {
  o: DrawnObject;
  /**
   * In the Old frame. A line: its segments as x0,y0,x1,y1, ... An area: its polygons, each
   * followed by NaN,NaN. A letter: where it sits.
   */
  coords: number[];
  /** In the Old frame, with the line width. */
  box: Box;
  /** Same style and the same number of points. */
  key: string;
  /** The same, without colours. */
  keyWithoutColour: string;
}

/**
 * A Plan's objects moved by `shift` mm along the Time direction into the Old frame, clipped to
 * `window` (the overlap of both Bodies, in the Old frame) and to their own clip box. Whatever
 * lies outside is left out.
 */
export function placeObjects(objs: readonly DrawnObject[], axis: Axis, shift: number, window: readonly [number, number]): Placed[] {
  const t = axis === "y" ? 1 : 0;
  const band: Box = axis === "y" ? { x0: -1e9, x1: 1e9, y0: window[0], y1: window[1] } : { x0: window[0], x1: window[1], y0: -1e9, y1: 1e9 };
  const moveBox = (b: Box): Box => (t ? { ...b, y0: b.y0 + shift, y1: b.y1 + shift } : { ...b, x0: b.x0 + shift, x1: b.x1 + shift });
  const out: Placed[] = [];
  for (const o of objs) {
    let r = band;
    if (o.clip) {
      r = intersectBox(band, moveBox(o.clip));
      if (r.x0 > r.x1 || r.y0 > r.y1) continue;
    }
    if (o.kind === "glyph") {
      const x = o.origin[0] + (t ? 0 : shift),
        y = o.origin[1] + (t ? shift : 0);
      if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) continue;
      out.push({ o, coords: [x, y], box: moveBox(o.box), key: o.style, keyWithoutColour: withoutColour(o.style) });
      continue;
    }
    const coords: number[] = [];
    let parts = 0;
    for (const p of o.polys) {
      const f = p.pts.slice();
      for (let i = t; i < f.length; i += 2) f[i]! += shift;
      if (o.kind === "stroke") {
        const n = f.length / 2,
          segs = p.closed ? n : n - 1;
        for (let i = 0; i < segs; i++) {
          const j = (i + 1) % n;
          const s = clipSegment(f[2 * i]!, f[2 * i + 1]!, f[2 * j]!, f[2 * j + 1]!, r);
          if (s) {
            coords.push(...s);
            parts++;
          }
        }
      } else {
        const c = clipPolygon(f, r);
        if (c) {
          coords.push(...c, NaN, NaN);
          parts++;
        }
      }
    }
    if (!parts) continue;
    const b = boxOfPoints(coords),
      hw = o.kind === "stroke" ? o.halfWidth : 0;
    out.push({
      o,
      coords,
      box: { x0: b.x0 - hw, y0: b.y0 - hw, x1: b.x1 + hw, y1: b.y1 + hw },
      key: `${o.style}|${coords.length}`,
      keyWithoutColour: `${withoutColour(o.style)}|${coords.length}`,
    });
  }
  return out;
}

export interface MatchResult {
  oldLeft: Placed[];
  newLeft: Placed[];
  pairs: [Placed, Placed][];
}

/** How close two coordinates of the same object must be, mm (ADR 0001: exact in practice). */
export const MATCH_TOLERANCE = 0.05;
const CELL = 2;

/**
 * One-to-one match of placed Old and New objects: the same key, every coordinate within the
 * tolerance, and (with `numsToo`) the same line width, dashes and size within 0.01 mm.
 */
export function matchObjects(
  oldP: readonly Placed[],
  newP: readonly Placed[],
  keyOf: (p: Placed) => string = (p) => p.key,
  numsToo = true,
): MatchResult {
  const cellOf = (b: Box) => [Math.floor((b.x0 + b.x1) / 2 / CELL), Math.floor((b.y0 + b.y1) / 2 / CELL)] as const;
  const index = new Map<string, number[]>();
  newP.forEach((p, i) => {
    const [cx, cy] = cellOf(p.box),
      k = `${keyOf(p)}#${cx},${cy}`;
    let list = index.get(k);
    if (!list) index.set(k, (list = []));
    list.push(i);
  });
  const sameCoords = (a: number[], b: number[]) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (Number.isNaN(a[i]!)) {
        if (!Number.isNaN(b[i]!)) return false;
        continue;
      }
      if (Math.abs(a[i]! - b[i]!) > MATCH_TOLERANCE) return false;
    }
    return true;
  };
  // Sizes, line widths, dash lengths: equal within 0.01 mm (the UserUnit differs per Plan).
  const sameNums = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) <= 0.01);
  const used = new Uint8Array(newP.length);
  const oldLeft: Placed[] = [],
    pairs: [Placed, Placed][] = [];
  for (const p of oldP) {
    const [cx, cy] = cellOf(p.box),
      k = keyOf(p);
    let hit = -1;
    for (let dx = -1; dx <= 1 && hit < 0; dx++)
      for (let dy = -1; dy <= 1 && hit < 0; dy++) {
        const list = index.get(`${k}#${cx + dx},${cy + dy}`);
        if (!list) continue;
        for (const i of list) {
          const q = newP[i]!;
          if (!used[i] && (!numsToo || sameNums(p.o.nums, q.o.nums)) && sameCoords(p.coords, q.coords)) {
            hit = i;
            break;
          }
        }
      }
    if (hit >= 0) {
      used[hit] = 1;
      pairs.push([p, newP[hit]!]);
    } else oldLeft.push(p);
  }
  return { oldLeft, newLeft: newP.filter((_, i) => !used[i]), pairs };
}
