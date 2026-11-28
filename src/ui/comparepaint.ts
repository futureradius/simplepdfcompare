// Painting the comparison view's marks every frame as vector shapes on the canvas (ADR 0003,
// ADR 0004): the object itself, Added red, Removed yellow, grey where a Removed and an Added
// mark cover the same place (the Unchanged part), an outline that keeps its width on screen,
// Removed outlined with the dashed x–x–x line (or a soft yellow outline), changed words as
// their own ink tinted, and the not-compared parts dimmed and the Overhang hatched. The
// halo and the x–x–x go once around each Place's marks of one colour (outlines.ts); the
// marks themselves are filled one by one. A mark tile is painted the same way in steps, a batch
// of marks each (paintMarkSteps, ADR 0011).
//
// Ported from the comparison-view prototype (prototypes/comparison/common.mjs: paintCompare,
// drawOverlay) with the research branch's vector frame (proto-bench.mjs: vectorFrame) in
// place of the per-pixel loops: compositing, no per-pixel work (a tile painted in steps reads
// one pixel after each batch, only to make it rasterize then).

import type { Mark } from "../compare/compare";
import type { Box } from "../compare/objects";
import { RING_RADIUS_PX, type MarkMetrics, type NotCompared, type Ring, type ViewSettings } from "./compareframe";
import { crossesAlong, OUTLINE_MARGIN_MM, simplifiedOutline, xxxOffsetMm, type Outline } from "./outlines";

export const MARK_COLOURS = { Added: "#dc2a1e", Removed: "#f0be00", Unchanged: "#4a4a4a" } as const;
/** The x–x–x line and the Removed ring: the yellow, darker, so that it reads on white. */
export const REMOVED_INK = "#b88a00";

/** What the canvas shows, in the Old frame: mm of its top left corner and device px per mm. */
export interface Viewport {
  x0: number;
  y0: number;
  /** Device px per mm. */
  s: number;
  /** Device px. */
  w: number;
  h: number;
  dpr: number;
}

/** A mark ready to draw: its path in Old frame mm, made once. */
export interface PaintMark {
  index: number;
  mark: Mark;
  path: Path2D;
  closed: boolean;
}

export function paintMark(index: number, m: Mark): PaintMark {
  const path = new Path2D(),
    k = m.coords;
  if (m.shape === "word") {
    const b = m.box;
    path.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  } else if (m.shape === "line") {
    for (let q = 0; q + 3 < k.length; q += 4) {
      path.moveTo(k[q]!, k[q + 1]!);
      path.lineTo(k[q + 2]!, k[q + 3]!);
    }
  } else {
    let open = false;
    for (let q = 0; q + 1 < k.length; q += 2) {
      if (Number.isNaN(k[q]!)) {
        path.closePath();
        open = false;
      } else {
        if (!open) path.moveTo(k[q]!, k[q + 1]!);
        else path.lineTo(k[q]!, k[q + 1]!);
        open = true;
      }
    }
  }
  return { index, mark: m, path, closed: m.shape !== "line" };
}

/** One Place's outline of one colour, ready to draw: its paths in Old frame mm, made once per level of detail. */
export interface PaintOutline {
  kind: Mark["kind"];
  /** Of its outer contours. */
  box: Box;
  outline: Outline;
  /** By the simplification (mm) they were made with; 0: as traced. */
  levels: Map<number, OutlinePaths | null>;
}

export interface OutlinePaths {
  /** The outer contours. */
  around: Path2D;
  /** The outer contours and the holes: the shape the halo fills. */
  shape: Path2D;
  /** The outer contours as point lists, closed (the first point again at the end), for the crosses. */
  subpaths: number[][];
}

export function paintOutline(kind: Mark["kind"], o: Outline): PaintOutline {
  return { kind, box: o.box, outline: o, levels: new Map() };
}

/** The simplifications kept, mm: a frame draws the coarsest within half a device px. */
const LEVELS_MM = [0.1, 0.3, 1, 3, 10, 30, 100];
const LEVEL_PX = 0.5;

/** The outline's paths for `s` device px per mm, or null when it is too small to draw at all. */
export function outlinePaths(o: PaintOutline, s: number): OutlinePaths | null {
  let level = 0;
  for (const l of LEVELS_MM) if (l * s <= LEVEL_PX) level = l;
  if (o.levels.has(level)) return o.levels.get(level)!;
  const ol = level ? simplifiedOutline(o.outline, level) : o.outline;
  let paths: OutlinePaths | null = null;
  if (ol.outer.length) {
    const around = new Path2D(),
      shape = new Path2D(),
      subpaths: number[][] = [];
    const add = (path: Path2D, c: readonly number[]) => {
      path.moveTo(c[0]!, c[1]!);
      for (let i = 2; i < c.length; i += 2) path.lineTo(c[i]!, c[i + 1]!);
      path.closePath();
    };
    for (const c of ol.outer) {
      add(around, c);
      add(shape, c);
      subpaths.push([...c, c[0]!, c[1]!]);
    }
    for (const c of ol.holes) add(shape, c);
    paths = { around, shape, subpaths };
  }
  o.levels.set(level, paths);
  return paths;
}

/** Three scratch layers the size of the view, kept between frames. */
export class Layers {
  readonly a: CanvasRenderingContext2D;
  readonly b: CanvasRenderingContext2D;
  readonly c: CanvasRenderingContext2D;
  /** `willReadFrequently`: kept in memory and rasterized on the CPU (for tiles painted in slices, read after each batch). */
  constructor(opts: CanvasRenderingContext2DSettings = {}) {
    const make = () => document.createElement("canvas").getContext("2d", opts)!;
    this.a = make();
    this.b = make();
    this.c = make();
  }
  size(w: number, h: number): void {
    for (const l of [this.a, this.b, this.c]) {
      if (l.canvas.width !== w || l.canvas.height !== h) {
        l.canvas.width = w;
        l.canvas.height = h;
      }
    }
  }
}

const clear = (l: CanvasRenderingContext2D) => {
  l.setTransform(1, 0, 0, 1, 0, 0);
  l.globalCompositeOperation = "source-over";
  l.globalAlpha = 1;
  l.clearRect(0, 0, l.canvas.width, l.canvas.height);
};
const toMm = (l: CanvasRenderingContext2D, v: Viewport) => l.setTransform(v.s, 0, 0, v.s, -v.x0 * v.s, -v.y0 * v.s);

/** Of a line, the width it is drawn at. */
const lineWidthOf = (pm: PaintMark, met: MarkMetrics) => Math.max(pm.mark.lineWidth, met.minLineMm);

/**
 * How a painting in steps goes (ADR 0011). Painted at once (a frame, a thumbnail) every
 * batch holds all the items; a tile is painted in batches that each take a few ms: `size`
 * says how many items the next batch of a phase draws, `done` makes the batch rasterize now
 * (a canvas otherwise rasterizes all it was told at once, when its picture is first used)
 * and learns from the time it took, `flush` makes a full-layer step rasterize.
 */
export interface Pace {
  size(phase: string): number;
  done(phase: string, l: CanvasRenderingContext2D, n: number): void;
  flush(l: CanvasRenderingContext2D): void;
}

/** All at once: one batch per phase, nothing forced to rasterize. */
export const AT_ONCE: Pace = { size: () => Infinity, done: () => {}, flush: () => {} };

/** Draws `items` onto `l` in batches as `pace` says, a step each. */
function* batches<T>(items: readonly T[], phase: string, l: CanvasRenderingContext2D, pace: Pace, draw: (item: T) => void): Generator<void> {
  for (let i = 0; i < items.length; ) {
    const end = Math.min(items.length, i + pace.size(phase)),
      n = end - i;
    for (; i < end; i++) draw(items[i]!);
    pace.done(phase, l, n);
    yield;
  }
}

/** A full-layer step: rasterized now, a step of its own. */
function* flushed(l: CanvasRenderingContext2D, pace: Pace): Generator<void> {
  pace.flush(l);
  yield;
}

/** Draws the objects of one kind onto a layer, full colour. */
function* objectSteps(l: CanvasRenderingContext2D, marks: readonly PaintMark[], kind: Mark["kind"], v: Viewport, met: MarkMetrics, pace: Pace): Generator<void> {
  toMm(l, v);
  l.fillStyle = l.strokeStyle = MARK_COLOURS[kind];
  l.lineCap = "round";
  l.lineJoin = "round";
  // The word itself is its tinted ink, see wordSteps.
  const mine = marks.filter((pm) => pm.mark.kind === kind && pm.mark.shape !== "word");
  yield* batches(mine, "objects", l, pace, (pm) => {
    if (pm.mark.shape === "line") {
      l.lineWidth = lineWidthOf(pm, met);
      l.stroke(pm.path);
    } else l.fill(pm.path, "evenodd");
  });
}

/**
 * The halos of one kind onto a layer, full colour: each outline's shape, grown further so
 * that it reaches `outlineMm` beyond the marks once the margin it already has is used up.
 */
function* haloSteps(l: CanvasRenderingContext2D, outlines: readonly PaintOutline[], kind: Mark["kind"], v: Viewport, met: MarkMetrics, pace: Pace): Generator<void> {
  toMm(l, v);
  l.fillStyle = l.strokeStyle = MARK_COLOURS[kind];
  l.lineJoin = "round";
  const grow = met.outlineMm - OUTLINE_MARGIN_MM;
  if (grow > 0) l.lineWidth = 2 * grow;
  yield* batches(
    outlines.filter((o) => o.kind === kind),
    "halos",
    l,
    pace,
    (o) => {
      const p = outlinePaths(o, v.s);
      if (!p) return;
      l.fill(p.shape, "evenodd");
      if (grow > 0) l.stroke(p.shape);
    },
  );
}

/** Halos and marks of both kinds, and the Unchanged part grey where they overlap. */
function* shapeSteps(
  ctx: CanvasRenderingContext2D,
  layers: Layers,
  marks: readonly PaintMark[],
  outlines: readonly PaintOutline[],
  v: Viewport,
  met: MarkMetrics,
  settings: ViewSettings,
  pace: Pace,
): Generator<void> {
  const { a: rem, b: add, c: both } = layers;
  const lay = (l: CanvasRenderingContext2D, alpha = 1) => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(l.canvas, 0, 0);
    ctx.restore();
  };
  if (met.outlineMm > 0) {
    // Halos: one layer per kind at full colour, laid on at 30 %, so overlaps do not darken.
    clear(add);
    yield* haloSteps(add, outlines, "Added", v, met, pace);
    lay(add, 0.3);
    yield* flushed(ctx, pace);
    if (settings.removed === "soft") {
      clear(rem);
      yield* haloSteps(rem, outlines, "Removed", v, met, pace);
      lay(rem, 0.3);
      yield* flushed(ctx, pace);
    }
  }
  clear(rem);
  clear(add);
  yield* objectSteps(rem, marks, "Removed", v, met, pace);
  yield* objectSteps(add, marks, "Added", v, met, pace);
  lay(rem);
  lay(add);
  yield* flushed(ctx, pace);
  // Where both are drawn: the Unchanged part.
  clear(both);
  both.globalCompositeOperation = "copy";
  both.drawImage(rem.canvas, 0, 0);
  both.globalCompositeOperation = "destination-in";
  both.drawImage(add.canvas, 0, 0);
  both.globalCompositeOperation = "source-in";
  both.fillStyle = MARK_COLOURS.Unchanged;
  both.fillRect(0, 0, both.canvas.width, both.canvas.height);
  yield* flushed(both, pace);
  lay(both);
  yield* flushed(ctx, pace);
}

/**
 * Changed words: the Plan's own glyphs in the mark colour (the Plan drawn inside the word's
 * box, then the colour on top with "screen": black ink takes the colour, white stays white).
 */
function* wordSteps(ctx: CanvasRenderingContext2D, marks: readonly PaintMark[], v: Viewport, drawPlan: (role: "old" | "new") => void, pace: Pace): Generator<void> {
  const words = marks.filter((pm) => pm.mark.shape === "word");
  yield* batches(words, "words", ctx, pace, (pm) => {
    const b = pm.mark.box;
    const x = (b.x0 - v.x0) * v.s,
      y = (b.y0 - v.y0) * v.s,
      w = (b.x1 - b.x0) * v.s,
      h = (b.y1 - b.y0) * v.s;
    const colour = MARK_COLOURS[pm.mark.kind];
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (Math.min(w, h) < 2) {
      // Too small to show its ink: the word's box.
      ctx.fillStyle = colour;
      ctx.fillRect(x, y, Math.max(w, 1), Math.max(h, 1));
    } else {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      drawPlan(pm.mark.plan);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = colour;
      ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
  });
}

/**
 * Removed as x–x–x: a dashed line once around each Place's Removed marks (its outline), with
 * × in the gaps. The line keeps its distance from the marks on screen: when zoomed out it
 * lies further out than the outline's margin. All the lines go on first and the insides come
 * out after, so where two outlines come close their lines join and none runs inside another
 * Removed shape.
 */
function* xxxSteps(ctx: CanvasRenderingContext2D, layers: Layers, outlines: readonly PaintOutline[], v: Viewport, met: MarkMetrics, pace: Pace): Generator<void> {
  const ring = layers.c;
  const removed: OutlinePaths[] = [];
  yield* batches(
    outlines.filter((o) => o.kind === "Removed"),
    "paths",
    ring,
    pace,
    (o) => {
      const p = outlinePaths(o, v.s);
      if (p) removed.push(p);
    },
  );
  if (!removed.length) return;
  clear(ring);
  toMm(ring, v);
  ring.lineCap = "butt";
  ring.lineJoin = "round";
  ring.strokeStyle = REMOVED_INK;
  const { lineMm: t, dashMm: dash, gapMm: gap } = met.xxx;
  // From the outline to the middle of the dashed line.
  const off = xxxOffsetMm(met.xxx, v.s);
  ring.setLineDash([dash, gap]);
  ring.lineWidth = 2 * off + t;
  yield* batches(removed, "xxx", ring, pace, (p) => ring.stroke(p.around));
  ring.globalCompositeOperation = "destination-out";
  ring.setLineDash([]);
  const inner = 2 * off - t;
  if (inner > 0) ring.lineWidth = inner;
  yield* batches(removed, "xxx", ring, pace, (p) => {
    if (inner > 0) ring.stroke(p.around);
    ring.fill(p.around);
  });
  // × in the middle of each gap, on the outer side, then the insides out again: no × inside
  // another Removed shape.
  ring.globalCompositeOperation = "source-over";
  ring.setTransform(1, 0, 0, 1, 0, 0);
  ring.lineWidth = met.xxx.linePx;
  ring.lineCap = "round";
  const k = met.xxx.crossHalfPx,
    pad = (2 * k) / v.s;
  const x0 = v.x0 - pad,
    y0 = v.y0 - pad,
    x1 = v.x0 + v.w / v.s + pad,
    y1 = v.y0 + v.h / v.s + pad;
  const onScreen = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  yield* batches(removed, "crosses", ring, pace, (p) => {
    ring.beginPath();
    for (const sp of p.subpaths) {
      const xs = crossesAlong(sp, dash, gap, off, onScreen);
      for (let i = 0; i < xs.length; i += 2) {
        const X = (xs[i]! - v.x0) * v.s,
          Y = (xs[i + 1]! - v.y0) * v.s;
        ring.moveTo(X - k, Y - k);
        ring.lineTo(X + k, Y + k);
        ring.moveTo(X - k, Y + k);
        ring.lineTo(X + k, Y - k);
      }
    }
    ring.stroke();
  });
  ring.globalCompositeOperation = "destination-out";
  toMm(ring, v);
  yield* batches(removed, "xxx", ring, pace, (p) => ring.fill(p.around));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(ring.canvas, 0, 0);
  ctx.restore();
  yield* flushed(ctx, pace);
}

/**
 * The marks of the view, in steps (each a batch as `pace` says): `marks` and `outlines` are
 * those in view (the outlines carry the halos and the x–x–x), `drawPlan` draws a Plan's
 * pictures onto ctx. Nothing else may draw onto ctx or the layers until it is done.
 */
export function* paintMarkSteps(
  ctx: CanvasRenderingContext2D,
  layers: Layers,
  marks: readonly PaintMark[],
  outlines: readonly PaintOutline[],
  v: Viewport,
  met: MarkMetrics,
  settings: ViewSettings,
  drawPlan: (role: "old" | "new") => void,
  pace: Pace = AT_ONCE,
): Generator<void> {
  if (!marks.length) return;
  layers.size(v.w, v.h);
  yield* shapeSteps(ctx, layers, marks, outlines, v, met, settings, pace);
  yield* wordSteps(ctx, marks, v, drawPlan, pace);
  if (settings.removed === "xxx") yield* xxxSteps(ctx, layers, outlines, v, met, pace);
}

/** The marks of the view, painted at once (see paintMarkSteps). */
export function paintMarks(
  ctx: CanvasRenderingContext2D,
  layers: Layers,
  marks: readonly PaintMark[],
  outlines: readonly PaintOutline[],
  v: Viewport,
  met: MarkMetrics,
  settings: ViewSettings,
  drawPlan: (role: "old" | "new") => void,
): void {
  const steps = paintMarkSteps(ctx, layers, marks, outlines, v, met, settings, drawPlan, AT_ONCE);
  while (!steps.next().done);
}

let hatchTile: HTMLCanvasElement | undefined;
let hatchDpr = 0;
function hatchPattern(ctx: CanvasRenderingContext2D, dpr: number, ox: number, oy: number): CanvasPattern {
  if (!hatchTile || hatchDpr !== dpr) {
    hatchDpr = dpr;
    const n = Math.round(12 * dpr);
    hatchTile = document.createElement("canvas");
    hatchTile.width = hatchTile.height = n;
    const c = hatchTile.getContext("2d")!;
    c.strokeStyle = "rgba(80,80,120,.4)";
    c.lineWidth = 1.2 * dpr;
    c.beginPath();
    c.moveTo(-2, n + 2);
    c.lineTo(n + 2, -2);
    c.moveTo(-2, 2);
    c.lineTo(2, -2);
    c.moveTo(n - 2, n + 2);
    c.lineTo(n + 2, n - 2);
    c.stroke();
  }
  const p = ctx.createPattern(hatchTile, "repeat")!;
  // Anchored to the Plan, so the hatch moves with it.
  p.setTransform(new DOMMatrix().translate(ox, oy));
  return p;
}

/** Header and Footer dimmed, the Overhang dimmed and hatched. */
export function paintNotCompared(ctx: CanvasRenderingContext2D, zones: readonly NotCompared[], v: Viewport): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const pattern = hatchPattern(ctx, v.dpr, -v.x0 * v.s, -v.y0 * v.s);
  for (const z of zones) {
    const r = screenRect(z.rect, v);
    if (!r) continue;
    ctx.fillStyle = z.kind === "overhang" ? "rgba(246,245,242,.72)" : "rgba(246,245,242,.55)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    if (z.kind === "overhang") {
      ctx.fillStyle = pattern;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
  }
  ctx.restore();
}

/** The part of a box (Old frame mm) on screen, device px, or null. */
export function screenRect(b: Box, v: Viewport): { x: number; y: number; w: number; h: number } | null {
  const x0 = Math.max(0, (b.x0 - v.x0) * v.s),
    y0 = Math.max(0, (b.y0 - v.y0) * v.s),
    x1 = Math.min(v.w, (b.x1 - v.x0) * v.s),
    y1 = Math.min(v.h, (b.y1 - v.y0) * v.s);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** A dark pill with a short text, CSS px. */
export function pill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, bg = "#1d1d1f"): number {
  ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
  const w = ctx.measureText(text).width + 16,
    h = 22;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 8, y + h / 2 + 0.5);
  return w;
}

/** The labels of the not-compared parts, at the top left of what is on screen of each (CSS px). */
export function paintNotComparedLabels(ctx: CanvasRenderingContext2D, zones: readonly NotCompared[], v: Viewport): void {
  ctx.save();
  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
  for (const z of zones) {
    const r = screenRect(z.rect, v);
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    // Only where the label fits inside what is on screen of the part.
    if (!r || r.w / v.dpr < ctx.measureText(z.label).width + 32 || r.h / v.dpr < 38) continue;
    pill(ctx, r.x / v.dpr + 8, r.y / v.dpr + 8, z.label, z.kind === "overhang" ? "#55555c" : "#8a8a90");
  }
  ctx.restore();
}

/** Rings around Places smaller than 18 px (CSS px), red, yellow, or half and half. */
export function paintRings(ctx: CanvasRenderingContext2D, rings: readonly Ring[], v: Viewport): void {
  ctx.save();
  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
  ctx.lineWidth = 3;
  const r = RING_RADIUS_PX;
  for (const g of rings) {
    const x = ((g.x - v.x0) * v.s) / v.dpr,
      y = ((g.y - v.y0) * v.s) / v.dpr;
    ctx.fillStyle = "rgba(255,255,255,.5)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fill();
    const arc = (a0: number, a1: number, colour: string) => {
      ctx.strokeStyle = colour;
      ctx.beginPath();
      ctx.arc(x, y, r, a0, a1);
      ctx.stroke();
    };
    if (g.kind === "both") {
      arc(Math.PI / 2, Math.PI * 1.5, REMOVED_INK);
      arc(-Math.PI / 2, Math.PI / 2, MARK_COLOURS.Added);
    } else arc(0, 2 * Math.PI, g.kind === "removed" ? REMOVED_INK : MARK_COLOURS.Added);
  }
  ctx.restore();
}
