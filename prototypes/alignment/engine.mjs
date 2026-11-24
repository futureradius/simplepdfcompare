// PROTOTYPE (throwaway) for the ticket "How does the user set the Header/Footer lines and
// Ignored areas, and confirm the Offset?". Shared plumbing for the three variants:
// loading a Plan, rendering a region, snap targets, Offset candidates, a quick compare count.
// Reuses the detection prototype (../detection) for objects, Offset voting and matching.
import * as mupdf from "mupdf";
import { extractObjects, K } from "../detection/extract.mjs";
import { refineOffset, inBand, placeObjects, matchObjects, groupItems, bboxOf, textChanges } from "../detection/detect.mjs";

export { K };

/** axis "y": time runs down (t = y, across = x); axis "x": time runs right. */
export const T = (axis) => (axis === "y" ? 1 : 0);

export async function loadPlan(bytes, name) {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const page = doc.loadPage(0);
  const b = page.getBounds();
  const dl = page.toDisplayList();
  const objs = extractObjects(page);
  return { name, doc, page, dl, objs, pageMm: [(b[2] - b[0]) * K, (b[3] - b[1]) * K], pages: doc.countPages(), snaps: {} };
}

export const lenOf = (p, axis) => p.pageMm[T(axis)];
export const acrossOf = (p, axis) => p.pageMm[1 - T(axis)];

/**
 * Snap targets along the Time direction: positions of straight lines (and filled rects'
 * edges) that run across at least `minFrac` of the Plan, i.e. candidates for where a
 * Header ends or a Footer starts. Sorted, deduplicated to 0.05 mm.
 */
export function snapTargets(plan, axis, minFrac = 0.5) {
  const key = axis + minFrac;
  if (plan.snaps[key]) return plan.snaps[key];
  const t = T(axis), A = acrossOf(plan, axis), out = [];
  for (const o of plan.objs) {
    if (o.kind === "glyph") continue;
    for (const p of o.polys) {
      const pts = p.pts;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const dt = Math.abs(pts[i + t] - pts[i + 2 + t]), da = Math.abs(pts[i + 1 - t] - pts[i + 3 - t]);
        if (dt < 0.05 && da >= minFrac * A) out.push(pts[i + t]);
      }
    }
  }
  out.sort((a, b) => a - b);
  const ded = [];
  for (const v of out) if (!ded.length || v - ded[ded.length - 1] > 0.05) ded.push(v);
  return (plan.snaps[key] = ded);
}

/**
 * Straight horizontal and vertical segments of the drawing (lines, area edges; not text),
 * at least 2 mm long, for snapping zone edges like the Clip edges in simplepdfclipper.
 * h: [y, x0, x1] sorted by y; v: [x, y0, y1] sorted by x.
 */
export function segIndex(plan) {
  if (plan.segs) return plan.segs;
  const hs = [], vs = [];
  for (const o of plan.objs) {
    if (o.kind === "glyph") continue;
    for (const p of o.polys) {
      const pts = p.pts, n = pts.length;
      const edge = (x0, y0, x1, y1) => {
        if (Math.abs(y1 - y0) < 0.05 && Math.abs(x1 - x0) >= 2) hs.push([y0, Math.min(x0, x1), Math.max(x0, x1)]);
        else if (Math.abs(x1 - x0) < 0.05 && Math.abs(y1 - y0) >= 2) vs.push([x0, Math.min(y0, y1), Math.max(y0, y1)]);
      };
      for (let i = 0; i + 3 < n; i += 2) edge(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
      if (p.closed && n >= 6) edge(pts[n - 2], pts[n - 1], pts[0], pts[1]);
    }
  }
  hs.sort((a, b) => a[0] - b[0]); vs.sort((a, b) => a[0] - b[0]);
  return (plan.segs = { h: hs, v: vs });
}
/**
 * Snap an edge at `pos` (along "x" for a vertical edge, "y" for a horizontal one) that spans
 * [lo, hi] the other way: the nearest segment within `tol` mm that runs alongside it.
 * Returns { pos, seg } or null.
 */
export function snapEdge(plan, dir, pos, lo, hi, tol) {
  const list = dir === "x" ? segIndex(plan).v : segIndex(plan).h;
  let a = 0, b = list.length;
  while (a < b) { const m = (a + b) >> 1; if (list[m][0] < pos - tol) a = m + 1; else b = m; }
  let best = null, bd = tol;
  for (let i = a; i < list.length && list[i][0] <= pos + tol; i++) {
    const s = list[i];
    if (s[2] < lo || s[1] > hi) continue; // must run alongside the edge
    const d = Math.abs(s[0] - pos);
    if (d < bd || (d === bd && best && s[2] - s[1] > best.seg[2] - best.seg[1])) { bd = d; best = { pos: s[0], seg: s }; }
  }
  return best;
}

/** Nearest snap target within `tol` mm, else the value itself. */
export function snap(targets, v, tol) {
  let lo = 0, hi = targets.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (targets[m] < v) lo = m + 1; else hi = m; }
  let best = v, bd = tol;
  for (const i of [lo - 1, lo]) if (i >= 0 && i < targets.length && Math.abs(targets[i] - v) <= bd) { bd = Math.abs(targets[i] - v); best = targets[i]; }
  return best;
}

/**
 * A first guess for the Body: the first and last line that runs across the whole Plan
 * (>= 95 %), ignoring the outer frame. Rough on purpose: the user confirms it.
 */
export function guessBody(plan, axis) {
  const L = lenOf(plan, axis), full = snapTargets(plan, axis, 0.95).filter((v) => v > 1 && v < L - 1);
  if (full.length < 2) return [0, L];
  return [full[0], full[full.length - 1]];
}

/** Offset candidates (New → Old: oldPos = newPos + offset), best first. */
export function offsetCandidates(O, N, axis, bodyO, bodyN, ignores = []) {
  const keep = (p, which, body) => skipIgnored(p.objs.filter((o) => inBand(o, axis, body)), which, ignores);
  const t0 = performance.now();
  const r = refineOffset(keep(O, "old", bodyO), keep(N, "new", bodyN), { axis, guess: 0, range: 1e6, top: 4 });
  return { candidates: r.candidates, ms: Math.round(performance.now() - t0) };
}

const centreOf = (o) => {
  if (!o._c) { if (o.kind === "glyph") o._c = o.origin; else { const b = bboxOf(o.polys.flatMap((p) => p.pts)); o._c = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; } }
  return o._c;
};
/** Ignored areas are stored per Plan in that Plan's page mm: { plan, kind: "band"|"box", rect }. */
export function skipIgnored(objs, which, ignores) {
  const rects = ignores.filter((ig) => ig.plan === which).map((ig) => ig.rect);
  if (!rects.length) return objs;
  return objs.filter((o) => { const [x, y] = centreOf(o); return !rects.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1); });
}

/** The quick comparison (no text diff): places with left-over objects, boxes in the Old frame. */
export function quickCompare(O, N, axis, bodyO, bodyN, offset, ignores) {
  const t0 = performance.now();
  const win = [Math.max(bodyO[0], bodyN[0] + offset) + 0.5, Math.min(bodyO[1], bodyN[1] + offset) - 0.5];
  const oP = placeObjects(skipIgnored(O.objs, "old", ignores), { axis, shift: 0, win });
  const nP = placeObjects(skipIgnored(N.objs, "new", ignores), { axis, shift: offset, win });
  const m1 = matchObjects(oP, nP, 0.05);
  const m = matchObjects(m1.oldUnmatched, m1.newUnmatched, 0.05, (o) => o.altKey);
  // Comparison-view prototype: the full result, as the detection ticket decided it.
  // Geometry is Removed (Old) / Added (New); text is marked per word; a recolour is Added.
  const still = new Set(m.newUnmatched), recol = m1.newUnmatched.filter((o) => !still.has(o));
  const text = textChanges(m.oldUnmatched, m.newUnmatched, oP, nP);
  const geo = (src, o, extra = {}) => ({ src, o, box: o.bbox, kind: o.kind, segs: o.kind === "stroke" ? o.coords : null, ...extra });
  const items = [
    ...m.oldUnmatched.filter((o) => o.kind !== "glyph").map((o) => geo("old", o)),
    ...m.newUnmatched.filter((o) => o.kind !== "glyph").map((o) => geo("new", o)),
    ...text.map((x) => ({ src: x.kind === "Removed" ? "old" : "new", text: x, box: x.box, kind: "word" })),
    ...recol.map((o) => (o.kind === "glyph" ? { src: "new", text: { kind: "Added", box: o.bbox, why: "recoloured" }, box: o.bbox, kind: "word", recol: true } : geo("new", o, { recol: true }))),
  ];
  // Round 4: no 300 mm tiles. They cut a long Activity from its own foot (the place's centre
  // decided the tile), so touching parts showed as two places.
  const groups = groupItems(items, { axis, cell: 5, maxLen: Infinity });
  return { win, offset, items, groups, leftOld: m.oldUnmatched.length, leftNew: m.newUnmatched.length, inOld: oP.length, inNew: nP.length, ms: Math.round(performance.now() - t0) };
}

/**
 * Render `plan` into an RGB buffer of w × h px. The view maps frame mm → px as
 * px = (mm - origin) * s; the Plan sits in the frame shifted by `shift` mm along time.
 */
export function renderGray(plan, axis, view, w, h, shift = 0) {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, w, h], false);
  pix.clear(255);
  const dx = axis === "x" ? shift : 0, dy = axis === "y" ? shift : 0;
  const dev = new mupdf.DrawDevice([K * view.s, 0, 0, K * view.s, (dx - view.x0) * view.s, (dy - view.y0) * view.s], pix);
  plan.dl.run(dev, mupdf.Matrix.identity);
  dev.close();
  const px = Uint8Array.from(pix.getPixels());
  dev.destroy(); pix.destroy();
  return px;
}
export function renderRGB(plan, axis, view, w, h, shift = 0) {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, w, h], false);
  pix.clear(255);
  const dx = axis === "x" ? shift : 0, dy = axis === "y" ? shift : 0;
  const dev = new mupdf.DrawDevice([K * view.s, 0, 0, K * view.s, (dx - view.x0) * view.s, (dy - view.y0) * view.s], pix);
  plan.dl.run(dev, mupdf.Matrix.identity);
  dev.close();
  const px = Uint8Array.from(pix.getPixels());
  dev.destroy(); pix.destroy();
  return px;
}

// ---------- remembered setup (per browser) ----------
// Lines are kept as "Header ends at h mm from the start" and "Footer starts f mm before
// the end", since the Footer moves with the end of the Body. Ignored areas keep their
// page position, boxes relative to the Header line.
const KEY = "alignproto.last";
export function remember(setup) {
  try { localStorage.setItem(KEY, JSON.stringify(setup)); } catch {}
}
export function recall() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}
export function forget() { try { localStorage.removeItem(KEY); } catch {} }
