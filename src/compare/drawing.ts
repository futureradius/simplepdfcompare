// Small tools for reading the drawing: colours, which objects touch, union-find. Ported from
// the comparison-view prototype (prototypes/comparison/activities.mjs).

import { outlineBox, type Box, type DrawnObject } from "./objects";

export const WHITE = "1.000,1.000,1.000";
export const BLACK = "0.000,0.000,0.000";

/** An object's colour (a hatch: the colour of its pattern). */
export function colourOf(o: DrawnObject): string {
  if (o.kind === "hatch") return /[sf](\d\.\d{3},\d\.\d{3},\d\.\d{3})/.exec(o.style)?.[1] ?? "?";
  return o.style.split("|")[o.kind === "glyph" ? 3 : 1] ?? "?";
}

export interface UnionFind {
  find(i: number): number;
  join(a: number, b: number): void;
}

export function unionFind(n: number): UnionFind {
  const p = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i: number) => {
    while (p[i] !== i) i = p[i] = p[p[i]!]!;
    return i;
  };
  return {
    find,
    join(a, b) {
      a = find(a);
      b = find(b);
      if (a !== b) p[a] = b;
    },
  };
}

/** Line pieces x0,y0,x1,y1 ... of an object: strokes, and the outline of a large area. Small areas and letters: null (their box). */
export function piecesOf(o: DrawnObject): number[] | null {
  if (o.kind === "glyph") return null;
  if (o.kind !== "stroke") {
    const b = outlineBox(o);
    if (b.x1 - b.x0 < 20 && b.y1 - b.y0 < 20) return null;
  }
  const s: number[] = [];
  for (const p of o.polys) {
    const k = p.pts,
      n = k.length / 2,
      m = p.closed || o.kind !== "stroke" ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % n;
      s.push(k[2 * i]!, k[2 * i + 1]!, k[2 * j]!, k[2 * j + 1]!);
    }
  }
  return s;
}

const OFF = 10000;
/** A grid cell (c mm) as one number. */
export const cellKey = (cx: number, cy: number) => (cx + OFF) * 1e6 + cy + OFF;
export const cellXY = (k: number): [number, number] => {
  const x = Math.floor(k / 1e6);
  return [x - OFF, k - x * 1e6 - OFF];
};

/** The grid cells (c mm) a drawing covers: along its line pieces, else over its box. */
export function cellsOf(pieces: readonly number[] | null, box: Box, c: number): Set<number> {
  const out = new Set<number>();
  if (pieces) {
    for (let q = 0; q + 3 < pieces.length; q += 4) {
      const x0 = pieces[q]!,
        y0 = pieces[q + 1]!,
        dx = pieces[q + 2]! - x0,
        dy = pieces[q + 3]! - y0;
      const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (c / 2)));
      for (let j = 0; j <= n; j++) out.add(cellKey(Math.floor((x0 + (dx * j) / n) / c), Math.floor((y0 + (dy * j) / n) / c)));
    }
  } else {
    for (let x = Math.floor(box.x0 / c); x <= Math.floor(box.x1 / c); x++)
      for (let y = Math.floor(box.y0 / c); y <= Math.floor(box.y1 / c); y++) out.add(cellKey(x, y));
  }
  return out;
}

export const objectCells = (o: DrawnObject, c: number) => cellsOf(piecesOf(o), outlineBox(o), c);

/**
 * Joins everything whose cells meet or neighbour. `layer(i)`: only things of the same layer
 * touch (a small number, such as a Plan and a colour).
 */
export function touchUnion(n: number, cellsFor: (i: number) => Iterable<number>, u: UnionFind, layer: (i: number) => number = () => 0): void {
  const L = 1e11;
  const cells = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const p = layer(i) * L;
    for (const c of cellsFor(i)) {
      const key = p + c,
        r = cells.get(key);
      if (r === undefined) cells.set(key, i);
      else u.join(i, r);
    }
  }
  for (const [key, r] of cells) {
    const p = Math.floor(key / L) * L,
      [x, y] = cellXY(key - p);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const q = cells.get(p + cellKey(x + dx, y + dy));
        if (q !== undefined) u.join(r, q);
      }
  }
}

/** The groups of objects that touch (within about `c` mm, chained): a group number per object. */
export function touching(objs: readonly DrawnObject[], c: number): number[] {
  const u = unionFind(objs.length);
  touchUnion(objs.length, (i) => objectCells(objs[i]!, c), u);
  return objs.map((_, i) => u.find(i));
}

/** Even-odd test of a point against a closed polygon (flat x, y list). */
export function inPolygon(px: number, py: number, k: readonly number[]): boolean {
  let inside = false;
  for (let a = 0, b = k.length - 2; a < k.length; b = a, a += 2) {
    const ya = k[a + 1]!,
      yb = k[b + 1]!;
    if (ya > py !== yb > py && px < ((k[b]! - k[a]!) * (py - ya)) / (yb - ya) + k[a]!) inside = !inside;
  }
  return inside;
}
