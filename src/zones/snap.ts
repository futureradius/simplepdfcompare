// Snap (ADR 0002): while a zone edge is dragged it jumps to a straight line drawn in the Plan
// that runs alongside it, as Clip edges do in simplepdfclipper (adapted from its snap.ts, here
// over one index of straight segments). Header and Footer lines snap to lines across the Plan.
// The index is built on first use, in the Plan's worker.

import type { Box, DrawnObject } from "../compare/objects";
import type { Handle } from "./model";

/** Shortest straight segment that counts, mm. */
export const MIN_SEGMENT_MM = 2;
/** "Straight": the other coordinate differs by less than this, mm. */
const STRAIGHT_MM = 0.05;

/** Flat triples: [position, from, to, ...] sorted by position. h: [y, x0, x1]; v: [x, y0, y1]. */
export interface Segments {
  h: Float64Array;
  v: Float64Array;
}

/** Straight horizontal and vertical segments of the drawing (lines, area edges; not text). */
export function buildSegments(objs: readonly DrawnObject[]): Segments {
  const hs: number[][] = [],
    vs: number[][] = [];
  for (const o of objs) {
    if (o.kind === "glyph") continue;
    for (const p of o.polys) {
      const pts = p.pts,
        n = pts.length;
      const edge = (x0: number, y0: number, x1: number, y1: number) => {
        if (Math.abs(y1 - y0) < STRAIGHT_MM && Math.abs(x1 - x0) >= MIN_SEGMENT_MM) hs.push([y0, Math.min(x0, x1), Math.max(x0, x1)]);
        else if (Math.abs(x1 - x0) < STRAIGHT_MM && Math.abs(y1 - y0) >= MIN_SEGMENT_MM) vs.push([x0, Math.min(y0, y1), Math.max(y0, y1)]);
      };
      for (let i = 0; i + 3 < n; i += 2) edge(pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!);
      if (p.closed && n >= 6) edge(pts[n - 2]!, pts[n - 1]!, pts[0]!, pts[1]!);
    }
  }
  const flat = (list: number[][]) => Float64Array.from(list.sort((a, b) => a[0]! - b[0]!).flat());
  return { h: flat(hs), v: flat(vs) };
}

export interface Guide {
  /** A vertical guide runs along y at x = pos. */
  vertical: boolean;
  pos: number;
  a: number;
  b: number;
}

export class SegmentIndex {
  private constructor(
    private readonly h: Float64Array,
    private readonly v: Float64Array,
  ) {}

  static from(s: Segments): SegmentIndex {
    return new SegmentIndex(s.h, s.v);
  }

  /** @internal */
  list(dir: "x" | "y"): Float64Array {
    return dir === "x" ? this.v : this.h;
  }
}

/**
 * The segment nearest to an edge at `pos` ("x": a vertical edge, "y": a horizontal one) within
 * `tol` mm, that runs alongside the edge's extent [lo, hi]. Ties go to the longer segment.
 */
export function snapEdge(idx: SegmentIndex, dir: "x" | "y", pos: number, lo: number, hi: number, tol: number): Guide | null {
  const l = idx.list(dir),
    n = l.length / 3;
  let a = 0,
    b = n;
  while (a < b) {
    const m = (a + b) >> 1;
    if (l[m * 3]! < pos - tol) a = m + 1;
    else b = m;
  }
  let best: Guide | null = null,
    bd = Infinity;
  for (let i = a; i < n && l[i * 3]! <= pos + tol; i++) {
    const from = l[i * 3 + 1]!,
      to = l[i * 3 + 2]!;
    if (to < lo || from > hi) continue;
    const d = Math.abs(l[i * 3]! - pos);
    if (d < bd || (d === bd && best && to - from > best.b - best.a)) {
      bd = d;
      best = { vertical: dir === "x", pos: l[i * 3]!, a: from, b: to };
    }
  }
  return best;
}

/** The nearest of the sorted `targets` within `tol`, else the value itself (Header and Footer lines). */
export function snapLine(targets: readonly number[], v: number, tol: number): number {
  let lo = 0,
    hi = targets.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (targets[m]! < v) lo = m + 1;
    else hi = m;
  }
  let best = v,
    bd = tol;
  for (const i of [lo - 1, lo]) {
    const t = targets[i];
    if (t !== undefined && Math.abs(t - v) <= bd) (bd = Math.abs(t - v)), (best = t);
  }
  return best;
}

/** Snaps the edges `handle` moves (all four sides for "move": the nearer one per axis wins). */
export function snapBox(b: Box, handle: Handle, idx: SegmentIndex, tol: number, visible?: Box): { box: Box; guides: Guide[] } {
  let { x0, y0, x1, y1 } = b;
  const guides: Guide[] = [];
  // Only what the user sees attracts: the part of the edge on screen is what must run alongside.
  const span = (lo: number, hi: number, vlo: number | undefined, vhi: number | undefined): [number, number] =>
    vlo === undefined || vhi === undefined || Math.max(lo, vlo) > Math.min(hi, vhi) ? [lo, hi] : [Math.max(lo, vlo), Math.min(hi, vhi)];
  const v = (x: number) => snapEdge(idx, "x", x, ...span(y0, y1, visible?.y0, visible?.y1), tol);
  const hz = (y: number) => snapEdge(idx, "y", y, ...span(x0, x1, visible?.x0, visible?.x1), tol);
  if (handle === "move") {
    const pick = (g0: Guide | null, g1: Guide | null, e0: number, e1: number) => {
      const d0 = g0 ? g0.pos - e0 : Infinity,
        d1 = g1 ? g1.pos - e1 : Infinity;
      return Math.abs(d0) <= Math.abs(d1) ? ([d0, g0] as const) : ([d1, g1] as const);
    };
    const [dx, gx] = pick(v(x0), v(x1), x0, x1);
    const [dy, gy] = pick(hz(y0), hz(y1), y0, y1);
    if (gx) (x0 += dx), (x1 += dx), guides.push(gx);
    if (gy) (y0 += dy), (y1 += dy), guides.push(gy);
  } else {
    if (handle.includes("w")) {
      const g = v(x0);
      if (g) (x0 = g.pos), guides.push(g);
    }
    if (handle.includes("e")) {
      const g = v(x1);
      if (g) (x1 = g.pos), guides.push(g);
    }
    if (handle.includes("n")) {
      const g = hz(y0);
      if (g) (y0 = g.pos), guides.push(g);
    }
    if (handle.includes("s")) {
      const g = hz(y1);
      if (g) (y1 = g.pos), guides.push(g);
    }
  }
  return { box: { x0, y0, x1, y1 }, guides };
}
