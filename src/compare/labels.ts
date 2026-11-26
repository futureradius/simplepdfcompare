// Reading the text and leader lines of one Plan, to name its Places (ADR 0006): its text
// lines (spans), a Label read whole over several lines, a leader line followed to the text at
// its free end or back to what it labels, a text beside a shape, and the shape's own name.
// All in that Plan's own page mm.
//
// Ported from the comparison-view prototype (prototypes/comparison/naming.mjs: planIndex,
// wholeLine, wholeBlock, followLine, followBack, besideText, splitSeeds, shapeOf;
// prototypes/comparison/activities.mjs: labelOf).

import type { Activity } from "./activities";
import { colourOf } from "./drawing";
import { boxOfPoints, unionBox, type Box, type DrawnObject, type GlyphObject } from "./objects";

/** A line end touches another line within this many mm. */
const TOL = 0.4;
/** A leader's free end reaches a text within this many mm. */
const TEXT_REACH = 2;
/** A text this near a shape is beside it, mm. */
const BESIDE = 3;
/** More connected lines than this are a grid, not a leader. */
const MAX_CHAIN = 8;
/** Longer lines are grid or Activities, never leaders, mm. */
const LEADER_MAX = 150;
const CELL = 5;
const SPAN_CELL = 10;

/** One text line as drawn (a span of letters). */
export interface Span {
  id: number;
  /** The letters' drawing-order numbers, in reading order. */
  letters: number[];
  text: string;
  box: Box;
  colour: string;
}

export interface TextIndex {
  objs: readonly DrawnObject[];
  spans: Map<number, Span>;
  /** Short open lines (possible leaders) by 5 mm cell. */
  lines: Map<number, number[]>;
  /** Spans by 10 mm cell. */
  spanGrid: Map<number, Span[]>;
  /** Drawn objects (not text) by colour and 5 mm cell, built on first use. */
  byColour: Map<string, Map<number, number[]>>;
}

const ck = (cx: number, cy: number) => cx * 100000 + cy;
const isOpen = (o: DrawnObject) => o.kind === "stroke" && o.polys.every((p) => !p.closed);
const distPtBox = (px: number, py: number, b: Box) => Math.hypot(Math.max(b.x0 - px, 0, px - b.x1), Math.max(b.y0 - py, 0, py - b.y1));
function distPtSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax,
    dy = by - ay,
    l2 = dx * dx + dy * dy;
  const u = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - u * dx, py - ay - u * dy);
}

/** Edges of an object's subpaths: [ax, ay, bx, by, ...]. */
function edgesOf(o: DrawnObject): number[] {
  if (o.kind === "glyph") return [o.box.x0, o.box.y0, o.box.x1, o.box.y0, o.box.x1, o.box.y0, o.box.x1, o.box.y1, o.box.x1, o.box.y1, o.box.x0, o.box.y1, o.box.x0, o.box.y1, o.box.x0, o.box.y0];
  const out: number[] = [];
  for (const p of o.polys) {
    const k = p.pts,
      n = k.length / 2;
    for (let i = 0; i + 1 < n; i++) out.push(k[2 * i]!, k[2 * i + 1]!, k[2 * i + 2]!, k[2 * i + 3]!);
    if (p.closed && n > 2) out.push(k[2 * n - 2]!, k[2 * n - 1]!, k[0]!, k[1]!);
  }
  return out;
}
/** Points every `step` mm along edges, both ends included. */
function along(e: readonly number[], step = CELL / 2): [number, number][] {
  const out: [number, number][] = [];
  for (let q = 0; q + 3 < e.length; q += 4) {
    const len = Math.hypot(e[q + 2]! - e[q]!, e[q + 3]! - e[q + 1]!),
      n = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j <= n; j++) out.push([e[q]! + ((e[q + 2]! - e[q]!) * j) / n, e[q + 1]! + ((e[q + 3]! - e[q + 1]!) * j) / n]);
  }
  return out;
}
const lengthOf = (o: DrawnObject) => {
  const e = edgesOf(o);
  let len = 0;
  for (let q = 0; q + 3 < e.length; q += 4) len += Math.hypot(e[q + 2]! - e[q]!, e[q + 3]! - e[q + 1]!);
  return len;
};
export const boxOfObject = (o: DrawnObject): Box => (o.kind === "glyph" ? o.box : boxOfPoints(o.polys.flatMap((p) => p.pts)));
export const boxOfObjects = (objs: readonly DrawnObject[]): Box | null => (objs.length ? objs.map(boxOfObject).reduce(unionBox) : null);
const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
};

/** The text lines and short open lines of a Plan. */
export function indexText(objs: readonly DrawnObject[]): TextIndex {
  const spans = new Map<number, Span>(),
    lines = new Map<number, number[]>(),
    spanGrid = new Map<number, Span[]>();
  objs.forEach((o, i) => {
    if (o.kind === "glyph") {
      let s = spans.get(o.span);
      if (!s) spans.set(o.span, (s = { id: o.span, letters: [], text: "", box: { ...o.box }, colour: colourOf(o) }));
      s.letters.push(i);
      s.box = unionBox(s.box, o.box);
      return;
    }
    if (!isOpen(o) || lengthOf(o) > LEADER_MAX) return;
    const seen = new Set<number>();
    for (const [x, y] of along(edgesOf(o))) {
      const k = ck(Math.floor(x / CELL), Math.floor(y / CELL));
      if (seen.has(k)) continue;
      seen.add(k);
      push(lines, k, i);
    }
  });
  for (const s of spans.values()) {
    s.letters.sort((a, b) => (objs[a] as GlyphObject).index - (objs[b] as GlyphObject).index);
    s.text = s.letters
      .map((j) => (objs[j] as GlyphObject).ch)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    for (let cx = Math.floor(s.box.x0 / SPAN_CELL); cx <= Math.floor(s.box.x1 / SPAN_CELL); cx++)
      for (let cy = Math.floor(s.box.y0 / SPAN_CELL); cy <= Math.floor(s.box.y1 / SPAN_CELL); cy++) push(spanGrid, ck(cx, cy), s);
  }
  return { objs, spans, lines, spanGrid, byColour: new Map() };
}

function linesNear(ix: TextIndex, x: number, y: number): Set<number> {
  const out = new Set<number>(),
    cx = Math.floor(x / CELL),
    cy = Math.floor(y / CELL);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const o of ix.lines.get(ck(cx + dx, cy + dy)) ?? []) out.add(o);
  return out;
}
function spansNear(ix: TextIndex, x: number, y: number, r: number): [Span, number][] {
  const out: [Span, number][] = [],
    seen = new Set<Span>();
  for (let cx = Math.floor((x - r) / SPAN_CELL); cx <= Math.floor((x + r) / SPAN_CELL); cx++)
    for (let cy = Math.floor((y - r) / SPAN_CELL); cy <= Math.floor((y + r) / SPAN_CELL); cy++)
      for (const s of ix.spanGrid.get(ck(cx, cy)) ?? []) {
        if (seen.has(s)) continue;
        seen.add(s);
        const d = distPtBox(x, y, s.box);
        if (d <= r) out.push([s, d]);
      }
  return out;
}
const sizeOf = (b: Box) => Math.min(b.y1 - b.y0, b.x1 - b.x0) || 2;
const seqsOf = (spans: readonly Span[]) => spans.flatMap((s) => s.letters);

export interface Block {
  text: string;
  spans: Span[];
}

/** Text lines that continue each other on one baseline, at the same text size (a Label line in pieces). */
export function wholeLine(ix: TextIndex, s: Span): Block {
  const h = sizeOf(s.box),
    parts = [s];
  for (let grow = true; grow; ) {
    grow = false;
    const b = parts.map((p) => p.box).reduce(unionBox);
    for (const [q] of spansNear(ix, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2 + h)) {
      if (parts.includes(q) || !q.text) continue;
      const sameLine =
        Math.abs(sizeOf(q.box) - h) < h * 0.2 && Math.abs(q.box.y1 - s.box.y1) < h * 0.3 && (Math.abs(q.box.x0 - b.x1) < h * 1.2 || Math.abs(b.x0 - q.box.x1) < h * 1.2);
      if (sameLine) {
        parts.push(q);
        grow = true;
      }
    }
  }
  parts.sort((a, b) => a.box.x0 - b.box.x0);
  return { text: parts.map((p) => p.text).join(" "), spans: parts };
}

/**
 * The whole Label a text line belongs to: the lines above and below of the same text size and
 * colour that line up with it (same left edge, or centred), at most 1 mm apart and at most 4
 * objects apart in the drawing order, read top down.
 */
export function wholeBlock(ix: TextIndex, s: Span): Block {
  const rows = [wholeLine(ix, s)],
    h = sizeOf(s.box);
  const bb = (r: Block) => r.spans.map((p) => p.box).reduce(unionBox);
  for (let grow = true; grow && rows.length < 8; ) {
    grow = false;
    const top = bb(rows[0]!),
      bot = bb(rows[rows.length - 1]!);
    for (const [edge, y, above] of [
      [top, top.y0 - h / 2, true],
      [bot, bot.y1 + h / 2, false],
    ] as const) {
      for (const [q] of spansNear(ix, (edge.x0 + edge.x1) / 2, y, (edge.x1 - edge.x0) / 2 + h)) {
        if (!q.text || rows.some((r) => r.spans.includes(q)) || Math.abs(sizeOf(q.box) - h) > h * 0.2 || q.colour !== s.colour) continue;
        // one Label is drawn in one go: its lines follow each other in the drawing order
        const seqs = rows.flatMap((r) => seqsOf(r.spans));
        const lo = Math.min(...seqs),
          hi = Math.max(...seqs),
          q0 = Math.min(...q.letters),
          q1 = Math.max(...q.letters);
        if (q0 - hi > 4 || lo - q1 > 4) continue;
        const ql = wholeLine(ix, q),
          qb = bb(ql);
        const across = Math.abs(qb.x0 - edge.x0) < h || Math.abs(qb.x0 + qb.x1 - (edge.x0 + edge.x1)) < 2 * h;
        const gap = above ? edge.y0 - q.box.y1 : q.box.y0 - edge.y1;
        if (across && gap > -h * 0.3 && gap < 1) {
          if (above) rows.unshift(ql);
          else rows.push(ql);
          grow = true;
          break;
        }
      }
      if (grow) break;
    }
  }
  return { text: rows.map((r) => r.text.trim()).join(" "), spans: rows.flatMap((r) => r.spans) };
}

/** The span a letter (by drawing order) belongs to. */
export const spanOfLetter = (ix: TextIndex, no: number): Span | undefined => {
  const o = ix.objs[no];
  return o?.kind === "glyph" ? ix.spans.get(o.span) : undefined;
};

/** The text line at a box (a word's box in this Plan's page mm). */
export function spanAt(ix: TextIndex, box: Box): Span | null {
  const x = (box.x0 + box.x1) / 2,
    y = (box.y0 + box.y1) / 2;
  let best: Span | null = null,
    bd = 0.5;
  for (const [s, d] of spansNear(ix, x, y, 0.5))
    if (d <= bd && s.text) {
      best = s;
      bd = d;
    }
  return best;
}

const endsOf = (o: DrawnObject): [number, number][] =>
  o.kind === "glyph" ? [] : o.polys.flatMap((p) => [[p.pts[0]!, p.pts[1]!] as [number, number], [p.pts[p.pts.length - 2]!, p.pts[p.pts.length - 1]!] as [number, number]]);

export interface Followed {
  /** Texts at the leader's free ends, nearest first. */
  hits: { span: Span; d: number }[];
  /** The leader lines followed. */
  leaders: number[];
}

/** From the seed objects, follow short open lines of their colour that start on them to texts at their free ends. */
export function followLine(ix: TextIndex, seeds: readonly number[]): Followed {
  const objs = ix.objs;
  const cols = new Set(seeds.map((i) => colourOf(objs[i]!)));
  const seedSet = new Set(seeds);
  const ok = (i: number) => !seedSet.has(i) && cols.has(colourOf(objs[i]!));
  const seedEdges = seeds.flatMap((i) => edgesOf(objs[i]!));
  const nearSeed = (x: number, y: number) => {
    for (let q = 0; q + 3 < seedEdges.length; q += 4) if (distPtSeg(x, y, seedEdges[q]!, seedEdges[q + 1]!, seedEdges[q + 2]!, seedEdges[q + 3]!) < TOL) return true;
    return false;
  };
  const none: Followed = { hits: [], leaders: [] };
  const reached = new Set<number>();
  for (const [x, y] of along(seedEdges)) {
    for (const i of linesNear(ix, x, y)) if (!reached.has(i) && ok(i) && endsOf(objs[i]!).some(([ex, ey]) => nearSeed(ex, ey))) reached.add(i);
    if (reached.size > MAX_CHAIN) return none;
  }
  // and the lines whose end touches those (a leader drawn in pieces)
  const queue = [...reached];
  while (queue.length) {
    const i = queue.shift()!;
    for (const [ex, ey] of endsOf(objs[i]!))
      for (const q of linesNear(ix, ex, ey)) {
        if (reached.has(q) || !ok(q)) continue;
        if (endsOf(objs[q]!).some(([qx, qy]) => Math.hypot(qx - ex, qy - ey) < TOL)) {
          reached.add(q);
          queue.push(q);
        }
      }
    if (reached.size > MAX_CHAIN) return none;
  }
  if (!reached.size) return none;
  const all = [...reached],
    hits = new Map<Span, number>();
  for (const i of all)
    for (const [ex, ey] of endsOf(objs[i]!)) {
      if (nearSeed(ex, ey)) continue;
      if (all.some((q) => q !== i && endsOf(objs[q]!).some(([qx, qy]) => Math.hypot(qx - ex, qy - ey) < TOL))) continue;
      for (const [s, d] of spansNear(ix, ex, ey, TEXT_REACH)) if (s.text && (!hits.has(s) || hits.get(s)! > d)) hits.set(s, d);
    }
  return { hits: [...hits].map(([span, d]) => ({ span, d })).sort((a, b) => a.d - b.d), leaders: all };
}

/** Is a text no name: a single letter, a bare number, a km marker or a dimension (ADR 0006)? */
export const isNoName = (t: string) =>
  t.trim().length <= 2 || /^[\d.,:\s-]+$/.test(t) || /^(km\s*)?[\d.,]+\s*\+\s*\d+$|^km\s*[\d.,]+$|^\d+\s*m$/.test(t.trim());

/** The nearest text beside the objects, within 3 mm. */
export function besideText(ix: TextIndex, seeds: readonly number[]): Span | null {
  let best: Span | null = null,
    bd = BESIDE;
  for (const [x, y] of along(
    seeds.flatMap((i) => edgesOf(ix.objs[i]!)),
    2,
  ))
    for (const [s, d] of spansNear(ix, x, y, bd))
      if (s.text && d < bd && !isNoName(s.text)) {
        best = s;
        bd = d;
      }
  return best;
}

/** Drawn objects (not text) of one colour by cell, built on first use. */
function colourGrid(ix: TextIndex, col: string): Map<number, number[]> {
  let g = ix.byColour.get(col);
  if (g) return g;
  g = new Map();
  ix.objs.forEach((o, i) => {
    if (o.kind === "glyph" || !o.polys.length || (o.kind !== "hatch" && colourOf(o) !== col)) return;
    const seen = new Set<number>();
    for (const [x, y] of along(edgesOf(o))) {
      const k = ck(Math.floor(x / CELL), Math.floor(y / CELL));
      if (!seen.has(k)) {
        seen.add(k);
        push(g!, k, i);
      }
    }
  });
  ix.byColour.set(col, g);
  return g;
}

/** From a Label, follow its leader back to what it labels: the drawn objects at the leader's other end. */
export function followBack(ix: TextIndex, spans: readonly Span[]): number[] {
  const objs = ix.objs,
    box = spans.map((s) => s.box).reduce(unionBox);
  const start = new Set<number>();
  for (let x = box.x0 - TEXT_REACH; x <= box.x1 + TEXT_REACH + CELL; x += CELL)
    for (let y = box.y0 - TEXT_REACH; y <= box.y1 + TEXT_REACH + CELL; y += CELL)
      for (const i of linesNear(ix, x, y)) if (endsOf(objs[i]!).some(([ex, ey]) => distPtBox(ex, ey, box) < TEXT_REACH)) start.add(i);
  if (!start.size || start.size > 2) return [];
  const col = colourOf(objs[[...start][0]!]!),
    chain = new Set(start),
    queue = [...start];
  while (queue.length && chain.size <= MAX_CHAIN) {
    const i = queue.shift()!;
    for (const [ex, ey] of endsOf(objs[i]!))
      for (const q of linesNear(ix, ex, ey))
        if (!chain.has(q) && colourOf(objs[q]!) === col && endsOf(objs[q]!).some(([qx, qy]) => Math.hypot(qx - ex, qy - ey) < TOL)) {
          chain.add(q);
          queue.push(q);
        }
  }
  if (chain.size > MAX_CHAIN) return [];
  const g = colourGrid(ix, col),
    found = new Set<number>();
  for (const i of chain)
    for (const [ex, ey] of endsOf(objs[i]!)) {
      if (distPtBox(ex, ey, box) < TEXT_REACH) continue;
      const cx = Math.floor(ex / CELL),
        cy = Math.floor(ey / CELL);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const q of g.get(ck(cx + dx, cy + dy)) ?? []) {
            if (chain.has(q) || found.has(q) || colourOf(objs[q]!) !== col) continue;
            const e = edgesOf(objs[q]!);
            for (let k = 0; k + 3 < e.length; k += 4)
              if (distPtSeg(ex, ey, e[k]!, e[k + 1]!, e[k + 2]!, e[k + 3]!) < TOL) {
                found.add(q);
                break;
              }
          }
    }
  // the whole drawn thing: the hatches and areas under the outline found
  for (const i of [...found]) {
    const b = boxOfObject(objs[i]!);
    for (let x = b.x0; x <= b.x1 + CELL; x += CELL)
      for (let y = b.y0; y <= b.y1 + CELL; y += CELL)
        for (const q of g.get(ck(Math.floor(x / CELL), Math.floor(y / CELL))) ?? []) {
          if (found.has(q) || chain.has(q) || objs[q]!.kind === "stroke") continue;
          const qb = boxOfObject(objs[q]!);
          if (Math.abs(qb.x0 - b.x0) < 0.5 && Math.abs(qb.x1 - b.x1) < 0.5 && Math.abs(qb.y0 - b.y0) < 0.5 && Math.abs(qb.y1 - b.y1) < 0.5) found.add(q);
        }
  }
  return [...found];
}

const lineWidthOf = (o: DrawnObject) => (o.kind === "stroke" ? o.nums[0]! : 0);
const sizeOfObject = (o: DrawnObject) => {
  const b = boxOfObject(o);
  return Math.hypot(b.x1 - b.x0, b.y1 - b.y0);
};
/** The drawn thing itself, without the thin short open lines that may be its leader. */
export function splitSeeds(objs: readonly DrawnObject[], seeds: readonly number[]): number[] {
  const maxLw = Math.max(0, ...seeds.map((i) => lineWidthOf(objs[i]!)));
  const thin = (i: number) => {
    const o = objs[i]!;
    return isOpen(o) && lengthOf(o) < LEADER_MAX && (seeds.some((s) => objs[s]!.kind !== "stroke") || lineWidthOf(o) < 0.75 * maxLw);
  };
  const core = seeds.filter((i) => !thin(i));
  return core.length ? core : [seeds.reduce((a, i) => (sizeOfObject(objs[i]!) > sizeOfObject(objs[a]!) ? i : a))];
}

function isRect(k: readonly number[]): boolean {
  const b = boxOfPoints(k);
  for (let i = 0; i < k.length; i += 2)
    if (!((Math.abs(k[i]! - b.x0) < 0.01 || Math.abs(k[i]! - b.x1) < 0.01) && (Math.abs(k[i + 1]! - b.y0) < 0.01 || Math.abs(k[i + 1]! - b.y1) < 0.01))) return false;
  return true;
}

/** What a drawn thing is, in the list's words: Schraffur, Linie, Linienzug, Rechteck, Raute, Kreis, Oval, Fläche, Text. */
export function shapeOf(objs: readonly DrawnObject[]): string {
  const drawn = objs.filter((o) => o.kind !== "glyph");
  if (!drawn.length) return "Text";
  if (drawn.some((o) => o.kind === "hatch")) return "Schraffur";
  const main = drawn.reduce((a, o) => (sizeOfObject(o) > sizeOfObject(a) ? o : a));
  const p = main.polys[0],
    k = p ? p.pts : [],
    n = k.length / 2;
  const closed = main.kind !== "stroke" || main.polys.every((q) => q.closed);
  if (!closed) return main.polys.length === 1 && n === 2 ? "Linie" : n === 2 ? "Linien" : "Linienzug";
  if (n >= 4 && n <= 5 && isRect(k)) return "Rechteck";
  const b = boxOfPoints(k);
  if (n >= 12) return Math.abs(b.x1 - b.x0 - (b.y1 - b.y0)) / Math.max(b.x1 - b.x0, b.y1 - b.y0) < 0.12 ? "Kreis" : "Oval";
  if (n === 4) {
    const mid = (i: number) => Math.abs(k[2 * i]! - (b.x0 + b.x1) / 2) < 0.05 || Math.abs(k[2 * i + 1]! - (b.y0 + b.y1) / 2) < 0.05;
    return [0, 1, 2, 3].every(mid) ? "Raute" : "Viereck";
  }
  return "Fläche";
}

export interface ActivityLabel {
  /** Its longest text block, read whole; null when it has none. */
  name: string | null;
  /** Its hatched shape: the underlay and the hatch (not its links or feet). */
  shape: number[];
}

/** An Activity's name and shape: its longest text block (lines that overlap across and touch along, ≤ 1 mm apart). */
export function labelOf(ix: TextIndex, a: Activity): ActivityLabel {
  const objs = ix.objs,
    lines = new Map<number, { text: string; box: Box }>();
  for (const j of a.objects) {
    const o = objs[j]!;
    if (o.kind !== "glyph") continue;
    const s = ix.spans.get(o.span)!;
    if (!lines.has(o.span)) lines.set(o.span, { text: s.text, box: s.box });
  }
  const sorted = [...lines.values()].filter((l) => l.text).sort((p, q) => p.box.y0 - q.box.y0 || p.box.x0 - q.box.x0);
  const blocks: { text: string; box: Box }[][] = [];
  for (const l of sorted) {
    const b = blocks.find((k) => {
      const t = k[k.length - 1]!.box;
      return l.box.x0 < t.x1 && l.box.x1 > t.x0 && l.box.y0 - t.y1 < 1 && l.box.y0 >= t.y0;
    });
    if (b) b.push(l);
    else blocks.push([l]);
  }
  const best = blocks.map((k) => k.map((l) => l.text.trim()).join(" ")).reduce((x, y) => (y.length > x.length ? y : x), "");
  return { name: best || null, shape: [a.start, a.hatch] };
}
