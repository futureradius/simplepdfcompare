// The same ink cut into other pieces (ADR 0001, ADR 0005): exports cut one line into
// different pieces in each Plan (one long grid line in one, several short ones in the other),
// and each Plan clips a shape differently at the edge of the compared Body. Such objects are
// not matched one to one, yet nothing changed. Ported from the comparison-view prototype
// (prototype/comparison-view, prototypes/alignment/engine.mjs: sameInk).

import type { Placed } from "./match";

const CELL = 5;
/** How close a point must lie to a line of the other Plan, mm. */
const ON_LINE = 0.06;
/** Lines are sampled every 2 mm, areas on a grid of 2 mm (at least 5 × 5). */
const STEP = 2;

const cellKey = (x: number, y: number) => Math.floor(x / CELL) * 1e6 + Math.floor(y / CELL);
const colourOf = (p: Placed) => p.o.style.split("|")[1];
const isLineOrArea = (p: Placed) => p.o.kind === "stroke" || p.o.kind === "fill";
/** White on white paper is no ink. */
const isWhite = (p: Placed) => isLineOrArea(p) && colourOf(p) === "1.000,1.000,1.000";

function onSegment(px: number, py: number, q: readonly number[]): boolean {
  const dx = q[2]! - q[0]!,
    dy = q[3]! - q[1]!,
    l2 = dx * dx + dy * dy;
  if (!l2) return Math.hypot(px - q[0]!, py - q[1]!) < ON_LINE;
  const u = ((px - q[0]!) * dx + (py - q[1]!) * dy) / l2;
  return u > -0.001 && u < 1.001 && Math.hypot(px - q[0]! - u * dx, py - q[1]! - u * dy) < ON_LINE;
}

/** Even-odd over the polygons of an area (NaN pairs separate them). */
function inArea(px: number, py: number, k: readonly number[]): boolean {
  let inside = false,
    start = 0;
  for (let i = 0; i <= k.length; i += 2) {
    if (i === k.length || Number.isNaN(k[i]!)) {
      for (let a = start, b = i - 2; a < i; b = a, a += 2) {
        const ya = k[a + 1]!,
          yb = k[b + 1]!;
        if (ya > py !== yb > py && px < ((k[b]! - k[a]!) * (py - ya)) / (yb - ya) + k[a]!) inside = !inside;
      }
      start = i + 2;
    }
  }
  return inside;
}

/**
 * The objects of `left` whose ink the other Plan draws too, only cut into other pieces: a
 * line whose every piece lies on lines of the same style (colour, dashes, cap, width) in
 * `other`, an area whose inside is covered by areas of the same colour. White lines and
 * areas count as no ink. With `anyColour`, the other Plan's lines may have another colour.
 */
export function sameInk(left: readonly Placed[], other: readonly Placed[], anyColour = false): Set<Placed> {
  const out = new Set<Placed>();
  const styleOf = (p: Placed) =>
    `${anyColour ? p.o.style.replace(/\d\.\d{3},\d\.\d{3},\d\.\d{3}/g, "c") : p.o.style}|${p.o.nums.length ? p.o.nums[0]!.toFixed(3) : ""}`;
  const todo = left.filter((p) => {
    if (isWhite(p)) {
      out.add(p);
      return false;
    }
    return isLineOrArea(p);
  });
  const wanted = new Set(todo.map(styleOf));
  if (!wanted.size) return out;

  // The other Plan's lines (as segments) and areas of those styles, on a grid per style.
  const grids = new Map<string, Map<number, (number[] | Placed)[]>>();
  const put = (style: string, cell: number, v: number[] | Placed) => {
    let g = grids.get(style);
    if (!g) grids.set(style, (g = new Map()));
    let l = g.get(cell);
    if (!l) g.set(cell, (l = []));
    l.push(v);
  };
  for (const p of other) {
    if (!isLineOrArea(p)) continue;
    const s = styleOf(p);
    if (!wanted.has(s)) continue;
    const k = p.coords;
    if (p.o.kind === "stroke") {
      for (let i = 0; i + 3 < k.length; i += 4) {
        const seg = [k[i]!, k[i + 1]!, k[i + 2]!, k[i + 3]!];
        const n = Math.max(1, Math.ceil(Math.hypot(seg[2]! - seg[0]!, seg[3]! - seg[1]!) / (CELL / 2)));
        const seen = new Set<number>();
        for (let j = 0; j <= n; j++) {
          const c = cellKey(seg[0]! + ((seg[2]! - seg[0]!) * j) / n, seg[1]! + ((seg[3]! - seg[1]!) * j) / n);
          if (!seen.has(c)) {
            seen.add(c);
            put(s, c, seg);
          }
        }
      }
    } else {
      const b = p.box;
      for (let x = Math.floor(b.x0 / CELL); x <= Math.floor(b.x1 / CELL); x++)
        for (let y = Math.floor(b.y0 / CELL); y <= Math.floor(b.y1 / CELL); y++) put(s, x * 1e6 + y, p);
    }
  }
  // A line crossing a cell's corner may have no sample in it: look in the neighbours too.
  const near = (g: Map<number, (number[] | Placed)[]>, x: number, y: number) => {
    const cx = Math.floor(x / CELL),
      cy = Math.floor(y / CELL),
      found: number[][] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const l = g.get((cx + dx) * 1e6 + cy + dy);
        if (l) for (const v of l) found.push(v as number[]);
      }
    return found;
  };
  for (const p of todo) {
    const g = grids.get(styleOf(p));
    if (!g) continue;
    const k = p.coords;
    let all = true;
    if (p.o.kind === "stroke") {
      for (let i = 0; all && i + 3 < k.length; i += 4) {
        const n = Math.max(2, Math.ceil(Math.hypot(k[i + 2]! - k[i]!, k[i + 3]! - k[i + 1]!) / STEP));
        for (let j = 0; j <= n && all; j++) {
          const x = k[i]! + ((k[i + 2]! - k[i]!) * j) / n,
            y = k[i + 1]! + ((k[i + 3]! - k[i + 1]!) * j) / n;
          all = near(g, x, y).some((q) => onSegment(x, y, q));
        }
      }
    } else {
      const b = p.box,
        nx = Math.max(5, Math.ceil((b.x1 - b.x0) / STEP)),
        ny = Math.max(5, Math.ceil((b.y1 - b.y0) / STEP));
      for (let i = 0; i < nx && all; i++)
        for (let j = 0; j < ny && all; j++) {
          const x = b.x0 + ((i + 0.5) * (b.x1 - b.x0)) / nx,
            y = b.y0 + ((j + 0.5) * (b.y1 - b.y0)) / ny;
          if (!inArea(x, y, k)) continue;
          all = (g.get(cellKey(x, y)) ?? []).some((q) => inArea(x, y, (q as Placed).coords));
        }
    }
    if (all) out.add(p);
  }
  return out;
}
