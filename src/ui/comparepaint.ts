// Painting the comparison view's marks every frame as vector shapes on the canvas (ADR 0003,
// ADR 0004): the object itself, Added red, Removed yellow, grey where a Removed and an Added
// mark cover the same place (the Unchanged part), an outline that keeps its width on screen,
// Removed outlined with the dashed x–x–x line (or a soft yellow outline), changed words as
// their own ink tinted, and the not-compared parts dimmed and the Overhang hatched.
//
// Ported from the comparison-view prototype (prototypes/comparison/common.mjs: paintCompare,
// drawOverlay) with the research branch's vector frame (proto-bench.mjs: vectorFrame) in
// place of the per-pixel loops: GPU compositing, no getImageData.

import type { Mark } from "../compare/compare";
import type { Box } from "../compare/objects";
import { RING_RADIUS_PX, type MarkMetrics, type NotCompared, type Ring, type ViewSettings } from "./compareframe";

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
  /** Its outline as point lists, for the crosses of the x–x–x line. */
  subpaths: number[][];
  closed: boolean;
}

export function paintMark(index: number, m: Mark): PaintMark {
  const path = new Path2D(),
    k = m.coords,
    subpaths: number[][] = [];
  if (m.shape === "word") {
    const b = m.box;
    path.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    subpaths.push([b.x0, b.y0, b.x1, b.y0, b.x1, b.y1, b.x0, b.y1, b.x0, b.y0]);
  } else if (m.shape === "line") {
    for (let q = 0; q + 3 < k.length; q += 4) {
      path.moveTo(k[q]!, k[q + 1]!);
      path.lineTo(k[q + 2]!, k[q + 3]!);
      subpaths.push([k[q]!, k[q + 1]!, k[q + 2]!, k[q + 3]!]);
    }
  } else {
    let cur: number[] = [];
    const close = () => {
      if (cur.length) subpaths.push([...cur, cur[0]!, cur[1]!]);
      cur = [];
    };
    for (let q = 0; q + 1 < k.length; q += 2) {
      if (Number.isNaN(k[q]!)) {
        path.closePath();
        close();
      } else {
        if (!cur.length) path.moveTo(k[q]!, k[q + 1]!);
        else path.lineTo(k[q]!, k[q + 1]!);
        cur.push(k[q]!, k[q + 1]!);
      }
    }
    close();
  }
  return { index, mark: m, path, subpaths, closed: m.shape !== "line" };
}

/** Three scratch layers the size of the view, kept between frames. */
export class Layers {
  readonly a: CanvasRenderingContext2D;
  readonly b: CanvasRenderingContext2D;
  readonly c: CanvasRenderingContext2D;
  constructor() {
    const make = () => document.createElement("canvas").getContext("2d")!;
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

/** Draws the objects of one kind onto a layer, full colour: the halos (`grow` mm wider) or the marks. */
function drawObjects(l: CanvasRenderingContext2D, marks: readonly PaintMark[], kind: Mark["kind"], v: Viewport, met: MarkMetrics, grow: number): void {
  toMm(l, v);
  l.fillStyle = l.strokeStyle = MARK_COLOURS[kind];
  l.lineCap = "round";
  l.lineJoin = "round";
  for (const pm of marks) {
    if (pm.mark.kind !== kind) continue;
    if (pm.mark.shape === "word") {
      if (!grow) continue; // the word itself is its tinted ink, see drawWords
      const b = pm.mark.box;
      l.fillRect(b.x0 - grow, b.y0 - grow, b.x1 - b.x0 + 2 * grow, b.y1 - b.y0 + 2 * grow);
    } else if (pm.mark.shape === "line") {
      l.lineWidth = lineWidthOf(pm, met) + 2 * grow;
      l.stroke(pm.path);
    } else if (grow) {
      l.lineWidth = 2 * grow;
      l.stroke(pm.path);
      l.fill(pm.path, "evenodd");
    } else l.fill(pm.path, "evenodd");
  }
}

/** Halos and marks of both kinds, and the Unchanged part grey where they overlap. */
function drawShapes(ctx: CanvasRenderingContext2D, layers: Layers, marks: readonly PaintMark[], v: Viewport, met: MarkMetrics, settings: ViewSettings): void {
  const { a: rem, b: add, c: both } = layers;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (met.outlineMm > 0) {
    // Halos: one layer per kind at full colour, laid on at 30 %, so overlaps do not darken.
    clear(add);
    drawObjects(add, marks, "Added", v, met, met.outlineMm);
    ctx.globalAlpha = 0.3;
    ctx.drawImage(add.canvas, 0, 0);
    if (settings.removed === "soft") {
      clear(rem);
      drawObjects(rem, marks, "Removed", v, met, met.outlineMm);
      ctx.drawImage(rem.canvas, 0, 0);
    }
    ctx.globalAlpha = 1;
  }
  clear(rem);
  clear(add);
  drawObjects(rem, marks, "Removed", v, met, 0);
  drawObjects(add, marks, "Added", v, met, 0);
  ctx.drawImage(rem.canvas, 0, 0);
  ctx.drawImage(add.canvas, 0, 0);
  // Where both are drawn: the Unchanged part.
  clear(both);
  both.globalCompositeOperation = "copy";
  both.drawImage(rem.canvas, 0, 0);
  both.globalCompositeOperation = "destination-in";
  both.drawImage(add.canvas, 0, 0);
  both.globalCompositeOperation = "source-in";
  both.fillStyle = MARK_COLOURS.Unchanged;
  both.fillRect(0, 0, both.canvas.width, both.canvas.height);
  ctx.drawImage(both.canvas, 0, 0);
  ctx.restore();
}

/**
 * Changed words: the Plan's own glyphs in the mark colour (the Plan drawn inside the word's
 * box, then the colour on top with "screen": black ink takes the colour, white stays white).
 */
function drawWords(ctx: CanvasRenderingContext2D, marks: readonly PaintMark[], v: Viewport, drawPlan: (role: "old" | "new") => void): void {
  for (const pm of marks) {
    if (pm.mark.shape !== "word") continue;
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
  }
}

/** Removed as x–x–x: a dashed line around each Removed object, with × in the gaps. */
function drawXxx(ctx: CanvasRenderingContext2D, layers: Layers, marks: readonly PaintMark[], v: Viewport, met: MarkMetrics): void {
  const ring = layers.c;
  clear(ring);
  toMm(ring, v);
  ring.lineCap = "butt";
  ring.lineJoin = "round";
  ring.strokeStyle = REMOVED_INK;
  const { distanceMm: D, lineMm: t, dashMm: dash, gapMm: gap } = met.xxx;
  const removed = marks.filter((pm) => pm.mark.kind === "Removed");
  for (const pm of removed) {
    const lw = pm.closed ? 0 : lineWidthOf(pm, met);
    ring.globalCompositeOperation = "source-over";
    ring.setLineDash([dash, gap]);
    ring.lineWidth = lw + 2 * D + t;
    ring.stroke(pm.path);
    ring.globalCompositeOperation = "destination-out";
    ring.setLineDash([]);
    ring.lineWidth = lw + 2 * D - t;
    ring.stroke(pm.path);
    if (pm.closed) ring.fill(pm.path);
  }
  ring.setLineDash([]);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(ring.canvas, 0, 0);
  // × in the middle of each gap, on both sides of the object (outside a closed shape only).
  ctx.strokeStyle = REMOVED_INK;
  ctx.lineWidth = met.xxx.linePx;
  ctx.lineCap = "round";
  const k = met.xxx.crossHalfPx,
    pad = 2 * k;
  ctx.beginPath();
  toMm(ring, v); // isPointInPath below works in device px through this transform
  for (const pm of removed) {
    const lw = pm.closed ? 0 : lineWidthOf(pm, met),
      off = lw / 2 + D;
    for (const sp of pm.subpaths) {
      let walked = 0,
        next = dash + gap / 2;
      for (let i = 0; i + 3 < sp.length; i += 2) {
        const ax = sp[i]!,
          ay = sp[i + 1]!,
          bx = sp[i + 2]!,
          by = sp[i + 3]!,
          len = Math.hypot(bx - ax, by - ay);
        if (!len) continue;
        const nx = -(by - ay) / len,
          ny = (bx - ax) / len;
        while (next <= walked + len) {
          const u = (next - walked) / len,
            x = ax + (bx - ax) * u,
            y = ay + (by - ay) * u;
          for (const sg of [1, -1]) {
            const X = (x + sg * nx * off - v.x0) * v.s,
              Y = (y + sg * ny * off - v.y0) * v.s;
            if (X < -pad || Y < -pad || X > v.w + pad || Y > v.h + pad) continue;
            if (pm.closed && ring.isPointInPath(pm.path, X, Y)) continue;
            ctx.moveTo(X - k, Y - k);
            ctx.lineTo(X + k, Y + k);
            ctx.moveTo(X - k, Y + k);
            ctx.lineTo(X + k, Y - k);
          }
          next += dash + gap;
        }
        walked += len;
      }
    }
  }
  ctx.stroke();
  ctx.restore();
}

/** The marks of the view: `marks` are those in view, `drawPlan` draws a Plan's pictures onto ctx. */
export function paintMarks(
  ctx: CanvasRenderingContext2D,
  layers: Layers,
  marks: readonly PaintMark[],
  v: Viewport,
  met: MarkMetrics,
  settings: ViewSettings,
  drawPlan: (role: "old" | "new") => void,
): void {
  if (!marks.length) return;
  layers.size(v.w, v.h);
  drawShapes(ctx, layers, marks, v, met, settings);
  drawWords(ctx, marks, v, drawPlan);
  if (settings.removed === "xxx") drawXxx(ctx, layers, marks, v, met);
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
