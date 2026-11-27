// One outline per Place and colour (ADR 0003): around the union of that Place's marks of
// one kind, each grown by a small margin. The words of a label merge into one outline, a
// hatch and its border make one shape, and a removed Activity with its leader and label is
// one unbroken line; parts far apart with nothing between them keep their own outlines.
//
// Made once per group (and again when the shown marks of a Place change), in Old frame mm,
// so the view only strokes it every frame. Pure logic, no DOM: a distance field around the
// marks on a grid, its contour at the margin traced with marching squares, then simplified.
// The grid is kept only in tiles near the marks, so the work follows the marks, not the box
// around them (a Place's words can lie far apart on the Plan).

import type { Mark } from "../compare/compare";
import type { Box } from "../compare/objects";

/** How far each mark is grown before the marks of a group are joined, mm. */
export const OUTLINE_MARGIN_MM = 1.2;
/**
 * About this many grid points per group at most: a very large group (lines all over the
 * Plan) gets a coarser grid, which at the zoom it is seen whole at shows no difference.
 */
const POINT_BUDGET = 200_000;
/** Simplifying the contour leaves out points closer than this to it, mm. */
const SIMPLIFY_MM = 0.03;

export interface Outline {
  /** Closed contours around the marks, as x,y,x,y ... in the Old frame (the first point not repeated). */
  outer: number[][];
  /** Closed contours of the empty insides (an empty frame's inside), same form. */
  holes: number[][];
  /** Of the outer contours. */
  box: Box;
}

type Shape = Pick<Mark, "shape" | "coords" | "lineWidth" | "box">;

/** The outline around `marks`, each grown by `marginMm`. */
export function outlineOf(marks: readonly Shape[], marginMm = OUTLINE_MARGIN_MM): Outline {
  const m = marginMm;
  let bb: Box | undefined;
  for (const k of marks) bb = bb ? { x0: Math.min(bb.x0, k.box.x0), y0: Math.min(bb.y0, k.box.y0), x1: Math.max(bb.x1, k.box.x1), y1: Math.max(bb.y1, k.box.y1) } : { ...k.box };
  if (!bb) return { outer: [], holes: [], box: { x0: 0, y0: 0, x1: 0, y1: 0 } };
  const field = new Field(bb, cellFor(marks, m), m);
  const polys: number[][][] = [];
  for (const k of marks) {
    if (k.shape === "word") field.rect(k.box);
    else if (k.shape === "line") {
      const p = k.coords,
        h = k.lineWidth / 2;
      for (let q = 0; q + 3 < p.length; q += 4) field.segment(p[q]!, p[q + 1]!, p[q + 2]!, p[q + 3]!, h);
    } else {
      const ps = polygonsOf(k.coords);
      for (const p of ps) for (let i = 0; i < p.length; i += 2) field.segment(p[i]!, p[i + 1]!, p[(i + 2) % p.length]!, p[(i + 3) % p.length]!, 0);
      if (ps.length) polys.push(ps);
    }
  }
  // The insides of the areas, once every tile near a mark is there.
  for (const ps of polys) field.fillInside(ps);
  field.areas = polys;
  const loops = trace(field, m);
  const outer: number[][] = [],
    holes: number[][] = [];
  let box: Box | undefined;
  for (const loop of loops) {
    const pts = simplifyClosed(loop, SIMPLIFY_MM);
    if (pts.length < 6) continue;
    // Traced with the inside on the same hand: around the marks the area is negative (y down).
    if (signedArea(pts) < 0) {
      outer.push(pts);
      for (let i = 0; i < pts.length; i += 2) {
        const x = pts[i]!,
          y = pts[i + 1]!;
        box = box ? { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) } : { x0: x, y0: y, x1: x, y1: y };
      }
    } else holes.push(pts);
  }
  return { outer, holes, box: box ?? bb };
}

/** The grid's cell, mm: half the margin, coarser when the marks would need too many points. */
function cellFor(marks: readonly Shape[], m: number): number {
  // The area near the marks, mm², at the finest cell (each point within r = 2 m of a mark).
  const r = 2 * m;
  let near = 0;
  for (const k of marks) {
    if (k.shape === "word") near += (k.box.x1 - k.box.x0 + 2 * r) * (k.box.y1 - k.box.y0 + 2 * r);
    else {
      const p = k.coords,
        step = k.shape === "line" ? 4 : 2;
      for (let q = 0; q + 3 < p.length; q += step) {
        if (Number.isNaN(p[q]!) || Number.isNaN(p[q + 2]!)) continue;
        near += (Math.sqrt((p[q + 2]! - p[q]!) ** 2 + (p[q + 3]! - p[q + 1]!) ** 2) + 2 * r) * (2 * r + k.lineWidth);
      }
    }
  }
  return Math.max(m / 2, Math.sqrt(near / POINT_BUDGET));
}

/**
 * A rough outline while the real one is not made yet: the box around the marks, grown by
 * the margin, with rounded corners. Drawn for a few frames at most.
 */
export function boxOutline(b: Box, marginMm = OUTLINE_MARGIN_MM): Outline {
  const m = marginMm,
    pts: number[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let k = 0; k <= 4; k++) {
      const a = a0 + (k * Math.PI) / 8;
      pts.push(cx + m * Math.cos(a), cy + m * Math.sin(a));
    }
  };
  // Anticlockwise on screen (y down), like the traced outer contours.
  corner(b.x0, b.y1, Math.PI / 2);
  corner(b.x0, b.y0, Math.PI);
  corner(b.x1, b.y0, (3 * Math.PI) / 2);
  corner(b.x1, b.y1, 0);
  // Reverse the order of the corners' arcs to turn anticlockwise.
  const out: number[] = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i]!, pts[i + 1]!);
  return { outer: [out], holes: [], box: { x0: b.x0 - m, y0: b.y0 - m, x1: b.x1 + m, y1: b.y1 + m } };
}

/** An area's polygons: x,y,x,y ... each, from coords where each polygon ends with NaN,NaN. */
function polygonsOf(k: readonly number[]): number[][] {
  const polys: number[][] = [];
  let cur: number[] = [];
  for (let q = 0; q + 1 < k.length; q += 2) {
    if (Number.isNaN(k[q]!)) {
      if (cur.length >= 6) polys.push(cur);
      cur = [];
    } else cur.push(k[q]!, k[q + 1]!);
  }
  if (cur.length >= 6) polys.push(cur);
  return polys;
}

/** Even-odd: is the point inside the polygons? */
function insidePolygons(polys: readonly number[][], x: number, y: number): boolean {
  let inside = false;
  for (const p of polys) {
    for (let i = 0, n = p.length; i < n; i += 2) {
      const j = (i + 2) % n,
        ya = p[i + 1]!,
        yb = p[j + 1]!;
      if (ya <= y !== yb <= y && x < p[i]! + ((y - ya) / (yb - ya)) * (p[j]! - p[i]!)) inside = !inside;
    }
  }
  return inside;
}

const SHIFT = 4,
  TILE = 1 << SHIFT,
  MASK = TILE - 1;

/**
 * The distance from grid points to the nearest mark, up to `r`. Kept in tiles of 16 × 16
 * points, only where some point is nearer than `r` to a mark. Every other tile is all inside
 * an area (0) or all outside (`r`): no contour runs through it.
 */
class Field {
  readonly c: number;
  /** Beyond this the distance is not kept: the margin and two cells. */
  readonly r: number;
  readonly x0: number;
  readonly y0: number;
  readonly nx: number;
  readonly ny: number;
  private readonly tx: number;
  /** Per tile: its slot in `pool`, or -1. */
  private readonly slot: Int32Array;
  private pool: Float32Array;
  private used = 0;
  /** The slots in use, by tile number. */
  readonly tiles: number[] = [];
  /** The areas' polygons, to tell an empty tile inside from one outside. */
  areas: number[][][] = [];
  private readonly empty = new Map<number, number>();

  constructor(bb: Box, c: number, m: number) {
    this.c = c;
    this.r = m + 2 * c;
    this.x0 = bb.x0 - this.r;
    this.y0 = bb.y0 - this.r;
    this.nx = Math.ceil((bb.x1 - bb.x0 + 2 * this.r) / c) + 1;
    this.ny = Math.ceil((bb.y1 - bb.y0 + 2 * this.r) / c) + 1;
    this.tx = (this.nx >> SHIFT) + 1;
    this.slot = new Int32Array(this.tx * ((this.ny >> SHIFT) + 1)).fill(-1);
    this.pool = new Float32Array(8 * TILE * TILE);
  }

  /** The tile's values, made (all `r`) the first time. */
  private tileOf(t: number): number {
    let s = this.slot[t]!;
    if (s < 0) {
      s = this.used++;
      if (s * TILE * TILE >= this.pool.length) {
        const bigger = new Float32Array(this.pool.length * 2);
        bigger.set(this.pool);
        this.pool = bigger;
      }
      this.pool.fill(this.r, s * TILE * TILE, (s + 1) * TILE * TILE);
      this.slot[t] = s;
      this.tiles.push(t);
    }
    return s;
  }

  private lower(i: number, j: number, d: number): void {
    if (d >= this.r) return;
    const s = this.tileOf((j >> SHIFT) * this.tx + (i >> SHIFT)),
      at = s * TILE * TILE + ((j & MASK) << SHIFT) + (i & MASK);
    if (d < this.pool[at]!) this.pool[at] = d;
  }

  get(i: number, j: number): number {
    const t = (j >> SHIFT) * this.tx + (i >> SHIFT),
      s = this.slot[t]!;
    if (s >= 0) return this.pool[s * TILE * TILE + ((j & MASK) << SHIFT) + (i & MASK)]!;
    let v = this.empty.get(t);
    if (v === undefined) {
      const x = this.x0 + (((t % this.tx) << SHIFT) + TILE / 2) * this.c,
        y = this.y0 + ((Math.floor(t / this.tx) << SHIFT) + TILE / 2) * this.c;
      v = this.areas.some((ps) => insidePolygons(ps, x, y)) ? 0 : this.r;
      this.empty.set(t, v);
    }
    return v;
  }

  /** The first and last point of tile `t`, as i0, j0. */
  corner(t: number): [number, number] {
    return [(t % this.tx) << SHIFT, Math.floor(t / this.tx) << SHIFT];
  }

  rect(b: Box): void {
    const { c, r } = this;
    const i0 = Math.max(0, Math.floor((b.x0 - r - this.x0) / c)),
      j0 = Math.max(0, Math.floor((b.y0 - r - this.y0) / c)),
      i1 = Math.min(this.nx - 1, Math.ceil((b.x1 + r - this.x0) / c)),
      j1 = Math.min(this.ny - 1, Math.ceil((b.y1 + r - this.y0) / c));
    for (let j = j0; j <= j1; j++) {
      const y = this.y0 + j * c,
        dy = Math.max(b.y0 - y, 0, y - b.y1);
      for (let i = i0; i <= i1; i++) {
        const ex = Math.max(b.x0 - this.x0 - i * c, 0, this.x0 + i * c - b.x1);
        this.lower(i, j, Math.sqrt(ex * ex + dy * dy));
      }
    }
  }

  /** A segment `h` mm to each side. Each grid row only where the segment comes within reach. */
  segment(ax: number, ay: number, bx: number, by: number, h: number): void {
    const { c } = this,
      reach = this.r + h;
    const j0 = Math.max(0, Math.floor((Math.min(ay, by) - reach - this.y0) / c)),
      j1 = Math.min(this.ny - 1, Math.ceil((Math.max(ay, by) + reach - this.y0) / c));
    const ux = bx - ax,
      uy = by - ay,
      len2 = ux * ux + uy * uy;
    for (let j = j0; j <= j1; j++) {
      const y = this.y0 + j * c;
      // The part of the segment within `reach` of this row, and so the columns to look at.
      let t0 = 0,
        t1 = 1;
      if (uy) {
        const ta = (y - reach - ay) / uy,
          tb = (y + reach - ay) / uy;
        t0 = Math.max(0, Math.min(ta, tb));
        t1 = Math.min(1, Math.max(ta, tb));
        if (t0 > t1) continue;
      }
      const xa = ax + t0 * ux,
        xb = ax + t1 * ux;
      const i0 = Math.max(0, Math.floor((Math.min(xa, xb) - reach - this.x0) / c)),
        i1 = Math.min(this.nx - 1, Math.ceil((Math.max(xa, xb) + reach - this.x0) / c));
      for (let i = i0; i <= i1; i++) {
        const x = this.x0 + i * c;
        const t = len2 ? Math.min(1, Math.max(0, ((x - ax) * ux + (y - ay) * uy) / len2)) : 0;
        const px = x - ax - t * ux,
          py = y - ay - t * uy;
        this.lower(i, j, Math.max(0, Math.sqrt(px * px + py * py) - h));
      }
    }
  }

  /** An area's inside (even-odd) at 0, in the tiles that are kept; the others ask `areas`. */
  fillInside(polys: readonly number[][]): void {
    const { c } = this;
    let y0 = Infinity,
      y1 = -Infinity;
    for (const p of polys) for (let i = 1; i < p.length; i += 2) (y0 = Math.min(y0, p[i]!)), (y1 = Math.max(y1, p[i]!));
    const ja = Math.max(0, Math.ceil((y0 - this.y0) / c)),
      jb = Math.min(this.ny - 1, Math.floor((y1 - this.y0) / c));
    if (jb < ja) return;
    // Each edge listed at the rows it crosses: x at the row = x0 + (y - y0) * slope.
    const rows: number[][] = Array.from({ length: jb - ja + 1 }, () => []);
    for (const p of polys) {
      for (let i = 0; i < p.length; i += 2) {
        const n = (i + 2) % p.length,
          xa = p[i]!,
          ya = p[i + 1]!,
          xb = p[n]!,
          yb = p[n + 1]!;
        if (ya === yb) continue;
        const lo = Math.min(ya, yb),
          hi = Math.max(ya, yb);
        // Rows with lo <= y < hi.
        const r0 = Math.max(ja, Math.ceil((lo - this.y0) / c)),
          r1 = Math.min(jb, Math.ceil((hi - this.y0) / c) - 1);
        const slope = (xb - xa) / (yb - ya);
        for (let j = r0; j <= r1; j++) {
          const y = this.y0 + j * c;
          if (y < lo || y >= hi) continue;
          rows[j - ja]!.push(xa + (y - ya) * slope);
        }
      }
    }
    for (let j = ja; j <= jb; j++) {
      const xs = rows[j - ja]!,
        row = (j >> SHIFT) * this.tx;
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const ia = Math.max(0, Math.ceil((xs[q]! - this.x0) / c)),
          ib = Math.min(this.nx - 1, Math.floor((xs[q + 1]! - this.x0) / c));
        for (let i = ia; i <= ib; i++) {
          const s = this.slot[row + (i >> SHIFT)]!;
          if (s < 0) {
            i |= MASK; // a tile not kept: skip to its end
            continue;
          }
          this.pool[s * TILE * TILE + ((j & MASK) << SHIFT) + (i & MASK)] = 0;
        }
      }
    }
  }
}

/**
 * The contours of the field at `level` (marching squares), in the tiles that are kept. Each
 * cell's corners are walked clockwise on screen; where the walk goes into the inside a
 * contour enters the cell, where it leaves the inside the contour leaves. A neighbour walks a
 * shared edge the other way, so one cell's exit is the next cell's entry and the pieces chain
 * into closed loops.
 */
function trace(f: Field, level: number): number[][] {
  const { nx, ny } = f;
  const H = (i: number, j: number) => 2 * (j * nx + i),
    V = (i: number, j: number) => 2 * (j * nx + i) + 1;
  // Only the edges the contour crosses: from each, the edge it goes on to.
  const next = new Map<number, number>();
  const crossings: { edge: number; enter: boolean }[] = [];
  const ins = [false, false, false, false],
    vals = [0, 0, 0, 0],
    edges = [0, 0, 0, 0];
  for (const t of f.tiles) {
    const [ti, tj] = f.corner(t);
    for (let j = tj; j < tj + TILE && j + 1 < ny; j++) {
      for (let i = ti; i < ti + TILE && i + 1 < nx; i++) {
        vals[0] = f.get(i, j);
        vals[1] = f.get(i + 1, j);
        vals[2] = f.get(i + 1, j + 1);
        vals[3] = f.get(i, j + 1);
        let n = 0;
        for (let e = 0; e < 4; e++) n += (ins[e] = vals[e]! < level) ? 1 : 0;
        if (n === 0 || n === 4) continue;
        edges[0] = H(i, j);
        edges[1] = V(i + 1, j);
        edges[2] = H(i, j + 1);
        edges[3] = V(i, j);
        crossings.length = 0;
        for (let e = 0; e < 4; e++) {
          const s = ins[e]!,
            u = ins[(e + 1) % 4]!;
          if (s !== u) crossings.push({ edge: edges[e]!, enter: u });
        }
        if (crossings.length === 2) {
          const [p, q] = crossings[0]!.enter ? [crossings[0]!, crossings[1]!] : [crossings[1]!, crossings[0]!];
          next.set(p.edge, q.edge);
        } else {
          // A saddle: the middle decides whether the two inside corners are joined.
          const s = crossings[0]!.enter ? 0 : 1;
          const e1 = crossings[s]!,
            x1 = crossings[s + 1]!,
            e2 = crossings[(s + 2) % 4]!,
            x2 = crossings[(s + 3) % 4]!;
          if ((vals[0]! + vals[1]! + vals[2]! + vals[3]!) / 4 < level) {
            next.set(e1.edge, x2.edge);
            next.set(e2.edge, x1.edge);
          } else {
            next.set(e1.edge, x1.edge);
            next.set(e2.edge, x2.edge);
          }
        }
      }
    }
  }
  const point = (edge: number, out: number[]) => {
    const at = Math.floor(edge / 2),
      i = at % nx,
      j = (at - i) / nx;
    const [i2, j2] = edge % 2 ? [i, j + 1] : [i + 1, j];
    const va = f.get(i, j),
      vb = f.get(i2, j2);
    const t = va === vb ? 0.5 : (level - va) / (vb - va);
    out.push(f.x0 + (i + t * (i2 - i)) * f.c, f.y0 + (j + t * (j2 - j)) * f.c);
  };
  const loops: number[][] = [];
  for (const start of next.keys()) {
    if (!next.has(start)) continue;
    const loop: number[] = [];
    let e: number | undefined = start;
    while (e !== undefined && next.has(e)) {
      point(e, loop);
      const n: number = next.get(e)!;
      next.delete(e);
      e = n;
    }
    loops.push(loop);
  }
  return loops;
}

/** Shoelace area of a closed contour x,y,x,y ... (y down: negative when it turns anticlockwise on screen). */
export function signedArea(p: readonly number[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i += 2) {
    const n = (i + 2) % p.length;
    a += p[i]! * p[n + 1]! - p[n]! * p[i + 1]!;
  }
  return a / 2;
}

/** Leaves out points of a closed contour within `tol` of it (Ramer–Douglas–Peucker). */
function simplifyClosed(p: readonly number[], tol: number): number[] {
  const n = p.length / 2;
  if (n < 4) return [...p];
  // Split at the first point and the one farthest from it.
  let far = 0,
    best = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(p[2 * i]! - p[0]!, p[2 * i + 1]! - p[1]!);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const keep = new Uint8Array(n + 1);
  keep[0] = keep[far] = keep[n] = 1;
  const at = (i: number) => (i % n) * 2;
  const stack: [number, number][] = [
    [0, far],
    [far, n],
  ];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    const ax = p[at(a)]!,
      ay = p[at(a) + 1]!,
      bx = p[at(b)]!,
      by = p[at(b) + 1]!;
    const ux = bx - ax,
      uy = by - ay,
      len = Math.hypot(ux, uy);
    let worst = -1,
      wi = -1;
    for (let i = a + 1; i < b; i++) {
      const x = p[at(i)]!,
        y = p[at(i) + 1]!;
      const d = len ? Math.abs((x - ax) * uy - (y - ay) * ux) / len : Math.hypot(x - ax, y - ay);
      if (d > worst) {
        worst = d;
        wi = i;
      }
    }
    if (worst > tol) {
      keep[wi] = 1;
      stack.push([a, wi], [wi, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[2 * i]!, p[2 * i + 1]!);
  return out;
}

/** The marks of one Place and one colour (a mark of no Place: alone). */
export interface OutlineGroup {
  /** Names the Place, the colour and the marks it holds: a new key, a new outline. */
  key: string;
  kind: Mark["kind"];
  place: number | null;
  marks: number[];
  /** Of the marks, not grown. */
  box: Box;
}

/** The groups to outline, of the marks `shown` lets through. */
export function outlineGroups(
  places: readonly { no: number; marks: readonly number[] }[],
  marks: readonly Pick<Mark, "kind" | "box">[],
  shown: (index: number) => boolean,
): OutlineGroup[] {
  const out: OutlineGroup[] = [];
  const inPlace = new Uint8Array(marks.length);
  const push = (place: number | null, kind: Mark["kind"], list: number[]) => {
    if (!list.length) return;
    let box: Box | undefined;
    for (const i of list) {
      const b = marks[i]!.box;
      box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : { ...b };
    }
    out.push({ key: `${place ?? "-"}:${kind}:${list.join(",")}`, kind, place, marks: list, box: box! });
  };
  for (const p of places) {
    for (const i of p.marks) inPlace[i] = 1;
    for (const kind of ["Added", "Removed"] as const) push(p.no, kind, p.marks.filter((i) => marks[i]!.kind === kind && shown(i)));
  }
  for (let i = 0; i < marks.length; i++) if (!inPlace[i] && shown(i)) push(null, marks[i]!.kind, [i]);
  return out;
}
