// The minimap's Places as pixels (ADR 0009, ADR 0011): each Place too small to show a shape
// is a dot, a larger one is its shown marks, each grown by half of a 3 px line. The minimap
// is a few hundred px tall for a 14 m Plan. Stroking thousands of marks with a 3 px line on a
// canvas that small is mostly overdraw: it held a frame for a hundred ms or more. Set as
// pixels in a mask, the same picture costs a few ms. Pure logic, no DOM.

import type { Box } from "../compare/objects";

/** What a pixel of the mask shows: nothing, Removed, or Added (Added lies over Removed). */
export const REMOVED = 1;
export const ADDED = 2;

/** A mark, as far as the minimap needs it (compare.ts Mark), in Old frame mm. */
export interface MaskMark {
  shape: "line" | "area" | "word";
  box: Box;
  /** line: x1,y1,x2,y2 per segment; area: x,y,… with NaN between the polygons. */
  coords: ArrayLike<number>;
}

export type MaskItem =
  /** A dot, in px of the mask. */
  | { colour: "added" | "removed"; dot: { x: number; y: number; d: number } }
  | { colour: "added" | "removed"; marks: readonly MaskMark[] };

export interface MaskOptions {
  /** px per mm. */
  scale: number;
  /** The mm at the mask's top left corner. */
  origin: { x: number; y: number };
  /** How far each mark is grown, px: half the line it is outlined with. */
  r: number;
  /** A mark under this on both sides (px) is set as its box; larger ones keep their own shape. */
  boxBelow?: number;
}

/** The Places as a w × h mask, row by row (REMOVED, ADDED or 0 per pixel). */
export function placesMask(w: number, h: number, items: readonly MaskItem[], o: MaskOptions): Uint8Array {
  const m = new Uint8Array(w * h);
  const { scale: s, r } = o,
    ox = o.origin.x,
    oy = o.origin.y,
    below = o.boxBelow ?? 2;
  let v = 0;
  const set = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (v === ADDED || m[i] === 0) m[i] = v;
  };
  /** The pixels whose middle lies in the box. */
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    const xa = Math.max(0, Math.ceil(x0 - 0.5)),
      xb = Math.min(w - 1, Math.floor(x1 - 0.5)),
      ya = Math.max(0, Math.ceil(y0 - 0.5)),
      yb = Math.min(h - 1, Math.floor(y1 - 0.5));
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) set(x, y);
  };
  const disc = (cx: number, cy: number, rad: number) => {
    const ya = Math.max(0, Math.ceil(cy - rad - 0.5)),
      yb = Math.min(h - 1, Math.floor(cy + rad - 0.5));
    for (let y = ya; y <= yb; y++) {
      const dy = y + 0.5 - cy,
        dx = Math.sqrt(Math.max(0, rad * rad - dy * dy));
      rect(cx - dx, y + 0.5, cx + dx, y + 0.5);
    }
  };
  /** The pixels within r of the segment. */
  const capsule = (ax: number, ay: number, bx: number, by: number) => {
    const xa = Math.max(0, Math.floor(Math.min(ax, bx) - r)),
      xb = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r)),
      ya = Math.max(0, Math.floor(Math.min(ay, by) - r)),
      yb = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r));
    const dx = bx - ax,
      dy = by - ay,
      len2 = dx * dx + dy * dy,
      r2 = r * r;
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const px = x + 0.5 - ax,
          py = y + 0.5 - ay;
        const t = len2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
        const ex = px - t * dx,
          ey = py - t * dy;
        if (ex * ex + ey * ey <= r2) set(x, y);
      }
    }
  };
  const X = (mm: number) => (mm - ox) * s,
    Y = (mm: number) => (mm - oy) * s;
  const mark = (k: MaskMark) => {
    const x0 = X(k.box.x0),
      y0 = Y(k.box.y0),
      x1 = X(k.box.x1),
      y1 = Y(k.box.y1);
    if (x1 < -r || y1 < -r || x0 > w + r || y0 > h + r) return;
    if (k.shape === "word" || (x1 - x0 < below && y1 - y0 < below)) return rect(x0 - r, y0 - r, x1 + r, y1 + r);
    const c = k.coords;
    if (k.shape === "line") {
      // A polyline of many short segments: runs that stay within a pixel are set as one, so a
      // line of a thousand segments costs what its course on the minimap costs.
      let sx = 0,
        sy = 0,
        ex = 0,
        ey = 0,
        open = false;
      for (let q = 0; q + 3 < c.length; q += 4) {
        const ax = X(c[q]!),
          ay = Y(c[q + 1]!),
          bx = X(c[q + 2]!),
          by = Y(c[q + 3]!);
        if (open && Math.abs(ax - ex) < 0.01 && Math.abs(ay - ey) < 0.01 && Math.hypot(bx - sx, by - sy) < 1) {
          ex = bx;
          ey = by;
          continue;
        }
        if (open) capsule(sx, sy, ex, ey);
        (sx = ax), (sy = ay), (ex = bx), (ey = by), (open = true);
      }
      if (open) capsule(sx, sy, ex, ey);
      return;
    }
    // An area: its edges, then its inside (even-odd, as it is filled on the Plan).
    const polys: number[][] = [[]];
    for (let q = 0; q + 1 < c.length; q += 2) {
      if (Number.isNaN(c[q]!)) polys.push([]);
      else polys[polys.length - 1]!.push(X(c[q]!), Y(c[q + 1]!));
    }
    for (const p of polys) for (let i = 0; i + 1 < p.length; i += 2) capsule(p[i]!, p[i + 1]!, p[(i + 2) % p.length]!, p[(i + 3) % p.length]!);
    if (x1 - x0 <= 2 * r || y1 - y0 <= 2 * r) return; // the edges cover it
    const ya = Math.max(0, Math.ceil(y0 - 0.5)),
      yb = Math.min(h - 1, Math.floor(y1 - 0.5));
    for (let y = ya; y <= yb; y++) {
      const cy = y + 0.5;
      // Where the polygons' edges cross this row: inside between every other crossing.
      const xs: number[] = [];
      for (const p of polys) {
        for (let i = 0; i + 1 < p.length; i += 2) {
          const ax = p[i]!,
            ay = p[i + 1]!,
            bx = p[(i + 2) % p.length]!,
            by = p[(i + 3) % p.length]!;
          if (ay <= cy !== by <= cy) xs.push(ax + ((cy - ay) * (bx - ax)) / (by - ay));
        }
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) rect(xs[i]!, cy, xs[i + 1]!, cy);
    }
  };
  // Removed first, so that Added lies over it wherever both are.
  for (const pass of ["removed", "added"] as const) {
    v = pass === "added" ? ADDED : REMOVED;
    for (const it of items) {
      if (it.colour !== pass) continue;
      if ("dot" in it) disc(it.dot.x, it.dot.y, it.dot.d / 2);
      else for (const k of it.marks) mark(k);
    }
  }
  return m;
}
