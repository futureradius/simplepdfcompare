// PROTOTYPE (throwaway): MuPDF page -> plain drawn objects in page mm (see detect.mjs).
// Shared by run.mjs (Node) and compare.html (browser).
import * as mupdf from "mupdf";
import { bboxOf } from "./detect.mjs";

export const K = 25.4 / 72; // pt -> mm

const tr = (m, x, y) => [(m[0] * x + m[2] * y + m[4]) * K, (m[1] * x + m[3] * y + m[5]) * K];
const colKey = (c) => (c || []).map((v) => v.toFixed(3)).join(",");

function pathPolys(path, ctm) {
  const polys = [];
  let cur = null, lx = 0, ly = 0, sx = 0, sy = 0;
  path.walk({
    moveTo(x, y) { cur = { pts: tr(ctm, x, y), closed: false }; polys.push(cur); lx = sx = x; ly = sy = y; },
    lineTo(x, y) { cur.pts.push(...tr(ctm, x, y)); lx = x; ly = y; },
    curveTo(x1, y1, x2, y2, x3, y3) {
      for (let i = 1; i <= 8; i++) {
        const t = i / 8, u = 1 - t;
        const x = u * u * u * lx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
        const y = u * u * u * ly + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
        cur.pts.push(...tr(ctm, x, y));
      }
      lx = x3; ly = y3;
    },
    closePath() { cur.closed = true; lx = sx; ly = sy; },
  });
  return polys;
}

function asRect(polys) {
  if (polys.length !== 1) return null;
  const p = polys[0].pts, n = p.length / 2;
  if (n < 4 || n > 5) return null;
  const b = bboxOf(p);
  for (let i = 0; i < p.length; i += 2)
    if (!((Math.abs(p[i] - b.x0) < 1e-3 || Math.abs(p[i] - b.x1) < 1e-3) && (Math.abs(p[i + 1] - b.y0) < 1e-3 || Math.abs(p[i + 1] - b.y1) < 1e-3))) return null;
  return b;
}

export function extractObjects(page) {
  const objs = [], clips = [];
  let tile = null, span = 0;
  const activeClip = (skipTop) => {
    let r = null;
    for (let i = 0; i < clips.length - (skipTop ? 1 : 0); i++) {
      const c = clips[i].rect;
      if (!c) continue;
      r = r ? { x0: Math.max(r.x0, c.x0), y0: Math.max(r.y0, c.y0), x1: Math.min(r.x1, c.x1), y1: Math.min(r.y1, c.y1) } : c;
    }
    return r;
  };
  // Tile content relative to the tile's own origin (the phase is ignored on purpose);
  // structure in the key, numbers compared with a tolerance.
  const tileContent = (tag, nums, polys) => {
    const ox = tile.ctm[4] * K, oy = tile.ctm[5] * K;
    tile.content.push(`${tag}:${polys.map((p) => p.pts.length).join("/")}`);
    tile.nums.push(...nums, ...polys.flatMap((p) => p.pts.map((v, i) => v - (i % 2 ? oy : ox))));
  };
  const scale = (ctm) => Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) * K;
  const dev = new mupdf.Device({
    clipPath(path, eo, ctm) { const polys = pathPolys(path, ctm); clips.push({ polys, rect: asRect(polys) }); },
    clipStrokePath() { clips.push({ polys: [], rect: null }); },
    clipText() { clips.push({ polys: [], rect: null }); },
    popClip() { clips.pop(); },
    beginTile(area, view, xs, ys, ctm) {
      const top = clips[clips.length - 1];
      tile = { area: top.polys, outer: activeClip(true), content: [], nums: [xs * scale(ctm), ys * scale(ctm)], ctm };
      return 0;
    },
    endTile() {
      // Tile content relative to the tile's own origin: the phase is ignored on purpose.
      objs.push({ kind: "hatch", style: `hatch|${tile.content.join(";")}`, nums: tile.nums, polys: tile.area.map((p) => ({ pts: p.pts, closed: true })), clip: tile.outer });
      tile = null;
    },
    fillPath(path, eo, ctm, cs, color, alpha) {
      if (tile) { tileContent(`f${colKey(color)}`, [], pathPolys(path, ctm)); return; }
      objs.push({ kind: "fill", style: `fill|${colKey(color)}|${eo ? 1 : 0}|${alpha.toFixed(2)}`, polys: pathPolys(path, ctm).map((p) => ({ pts: p.pts, closed: true })), clip: activeClip() });
    },
    strokePath(path, stroke, ctm, cs, color, alpha) {
      const s = scale(ctm), lw = stroke.getLineWidth() * s;
      if (tile) { tileContent(`s${colKey(color)}`, [lw], pathPolys(path, ctm)); return; }
      const dl = stroke.getDashes() || [];
      objs.push({ kind: "stroke", style: `stroke|${colKey(color)}|d${dl.length}|${stroke.getLineCap()}|${alpha.toFixed(2)}`, nums: [lw, ...dl.map((d) => d * s)], polys: pathPolys(path, ctm), clip: activeClip(), halfW: lw / 2 });
    },
    fillText(text, ctm, cs, color) {
      span++;
      let idx = 0;
      text.walk({
        beginSpan() { span++; idx = 0; },
        showGlyph(font, trm, gid, uni) {
          const m = mupdf.Matrix.concat(trm, ctm), adv = font.advanceGlyph(gid, 0);
          const corners = [tr(m, 0, -0.2), tr(m, adv, -0.2), tr(m, adv, 0.8), tr(m, 0, 0.8)].flat();
          const size = Math.hypot(m[2], m[3]) * K, ch = String.fromCodePoint(uni);
          objs.push({ kind: "glyph", style: `glyph|${ch}|${font.getName()}|${colKey(color)}`, nums: [size], ch, origin: tr(m, 0, 0), box: bboxOf(corners), span, idx: idx++, clip: null, polys: [] });
        },
      });
    },
  });
  page.run(dev, mupdf.Matrix.identity);
  dev.close();
  return objs;
}
