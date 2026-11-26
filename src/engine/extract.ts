// A MuPDF page as plain drawn objects in page mm (ADR 0001), for the comparison.
// Runs inside the Plan's worker (ADR 0004). Ported from the detection prototype
// (prototype/difference-detection, prototypes/detection/extract.mjs).
//
// The MuPDF module is passed in: the worker loads it only after the WASM binary is set.

import type * as MuPDF from "mupdf";
import { boxOfPoints, type Box, type DrawnObject, type Poly } from "../compare/objects";

const PT_TO_MM = 25.4 / 72;

type Matrix = MuPDF.Matrix;

const toMm = (m: Matrix, x: number, y: number): [number, number] => [
  (m[0] * x + m[2] * y + m[4]) * PT_TO_MM,
  (m[1] * x + m[3] * y + m[5]) * PT_TO_MM,
];

const colourKey = (c: ArrayLike<number> | null | undefined): string =>
  Array.from(c ?? [], (v) => v.toFixed(3)).join(",");

function polysOf(path: MuPDF.Path, ctm: Matrix): Poly[] {
  const polys: Poly[] = [];
  let cur: Poly | undefined;
  let lx = 0,
    ly = 0,
    sx = 0,
    sy = 0;
  path.walk({
    moveTo(x, y) {
      cur = { pts: toMm(ctm, x, y), closed: false };
      polys.push(cur);
      lx = sx = x;
      ly = sy = y;
    },
    lineTo(x, y) {
      cur?.pts.push(...toMm(ctm, x, y));
      lx = x;
      ly = y;
    },
    curveTo(x1, y1, x2, y2, x3, y3) {
      for (let i = 1; i <= 8; i++) {
        const t = i / 8,
          u = 1 - t;
        const x = u * u * u * lx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
        const y = u * u * u * ly + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
        cur?.pts.push(...toMm(ctm, x, y));
      }
      lx = x3;
      ly = y3;
    },
    closePath() {
      if (cur) cur.closed = true;
      lx = sx;
      ly = sy;
    },
  });
  return polys;
}

/** The clip as a box, when it is an axis-aligned rectangle. */
function asRect(polys: Poly[]): Box | null {
  if (polys.length !== 1) return null;
  const p = polys[0]!.pts,
    n = p.length / 2;
  if (n < 4 || n > 5) return null;
  const b = boxOfPoints(p);
  const near = (a: number, c: number) => Math.abs(a - c) < 1e-3;
  for (let i = 0; i < p.length; i += 2)
    if (!((near(p[i]!, b.x0) || near(p[i]!, b.x1)) && (near(p[i + 1]!, b.y0) || near(p[i + 1]!, b.y1)))) return null;
  return b;
}

const scaleOf = (ctm: Matrix) => Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) * PT_TO_MM;

/** Every drawn object of a page, in page mm, in drawing order. */
export function extractObjects(m: typeof MuPDF, page: MuPDF.Page): DrawnObject[] {
  const objs: DrawnObject[] = [];
  const clips: { polys: Poly[]; rect: Box | null }[] = [];
  let tile: { area: Poly[]; outer: Box | null; content: string[]; nums: number[]; ctm: Matrix } | null = null;
  let span = 0;

  const activeClip = (skipTop = false): Box | null => {
    let r: Box | null = null;
    for (let i = 0; i < clips.length - (skipTop ? 1 : 0); i++) {
      const c = clips[i]!.rect;
      if (!c) continue;
      r = r ? { x0: Math.max(r.x0, c.x0), y0: Math.max(r.y0, c.y0), x1: Math.min(r.x1, c.x1), y1: Math.min(r.y1, c.y1) } : c;
    }
    return r;
  };
  // Hatch content relative to the tile's own origin: its phase is ignored on purpose
  // (it moves with the area, or with the page). The structure goes into the style, the
  // numbers are compared with a tolerance.
  const tileContent = (tag: string, nums: number[], polys: Poly[]) => {
    if (!tile) return;
    const ox = tile.ctm[4] * PT_TO_MM,
      oy = tile.ctm[5] * PT_TO_MM;
    tile.content.push(`${tag}:${polys.map((p) => p.pts.length).join("/")}`);
    tile.nums.push(...nums, ...polys.flatMap((p) => p.pts.map((v, i) => v - (i % 2 ? oy : ox))));
  };

  const dev = new m.Device({
    clipPath(path, _evenOdd, ctm) {
      const polys = polysOf(path, ctm);
      clips.push({ polys, rect: asRect(polys) });
    },
    clipStrokePath() {
      clips.push({ polys: [], rect: null });
    },
    clipText() {
      clips.push({ polys: [], rect: null });
    },
    clipStrokeText() {
      clips.push({ polys: [], rect: null });
    },
    clipImageMask() {
      clips.push({ polys: [], rect: null });
    },
    popClip() {
      clips.pop();
    },
    beginTile(_area, _view, xs, ys, ctm) {
      const top = clips[clips.length - 1];
      tile = { area: top?.polys ?? [], outer: activeClip(true), content: [], nums: [xs * scaleOf(ctm), ys * scaleOf(ctm)], ctm };
      return 0;
    },
    endTile() {
      if (!tile) return;
      objs.push({
        kind: "hatch",
        style: `hatch|${tile.content.join(";")}`,
        nums: tile.nums,
        polys: tile.area.map((p) => ({ pts: p.pts, closed: true })),
        clip: tile.outer,
      });
      tile = null;
    },
    fillPath(path, evenOdd, ctm, _cs, color, alpha) {
      if (tile) return tileContent(`f${colourKey(color)}`, [], polysOf(path, ctm));
      objs.push({
        kind: "fill",
        style: `fill|${colourKey(color)}|${evenOdd ? 1 : 0}|${alpha.toFixed(2)}`,
        nums: [],
        polys: polysOf(path, ctm).map((p) => ({ pts: p.pts, closed: true })),
        clip: activeClip(),
      });
    },
    strokePath(path, stroke, ctm, _cs, color, alpha) {
      const s = scaleOf(ctm),
        lw = stroke.getLineWidth() * s;
      if (tile) return tileContent(`s${colourKey(color)}`, [lw], polysOf(path, ctm));
      const dashes = stroke.getDashes() ?? [];
      objs.push({
        kind: "stroke",
        style: `stroke|${colourKey(color)}|d${dashes.length}|${stroke.getLineCap()}|${alpha.toFixed(2)}`,
        nums: [lw, ...dashes.map((d) => d * s)],
        polys: polysOf(path, ctm),
        clip: activeClip(),
        halfWidth: lw / 2,
      });
    },
    fillText(text, ctm, _cs, color) {
      span++;
      let index = 0;
      const clip = activeClip();
      text.walk({
        beginSpan() {
          span++;
          index = 0;
        },
        showGlyph(font, trm, gid, uni) {
          const g = m.Matrix.concat(trm, ctm),
            adv = font.advanceGlyph(gid, 0);
          const corners = [toMm(g, 0, -0.2), toMm(g, adv, -0.2), toMm(g, adv, 0.8), toMm(g, 0, 0.8)].flat();
          const size = Math.hypot(g[2], g[3]) * PT_TO_MM,
            ch = String.fromCodePoint(uni);
          objs.push({
            kind: "glyph",
            style: `glyph|${ch}|${font.getName()}|${colourKey(color)}`,
            nums: [size],
            ch,
            origin: toMm(g, 0, 0),
            box: boxOfPoints(corners),
            span,
            index: index++,
            clip,
          });
        },
      });
    },
  });
  try {
    page.run(dev, m.Matrix.identity);
    dev.close();
  } finally {
    dev.destroy();
  }
  return objs;
}
