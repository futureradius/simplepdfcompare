// PROTOTYPE (throwaway) for the ticket "How do we name what changed: the process, or its
// shape and place on the axes?". Finds a name for a place, and reads the Plan's axes.
//
// A name, tried in this order (the first that works wins):
//   1. "Linie":  follow thin open lines of the changed object's colour that start on it
//                (a leader line, possibly in several pieces) to a text at their free end.
//   2. "daneben": the nearest text within 3 mm of the changed object.
//   3. "Text":   the place is a changed label; its own text line is the name.
//   4. "Zeile":  bar chart: the row's text in the Header (task table) across from it.
//   5. none:     only the shape (Linie, Rechteck, Schraffur …) and where it lies.
// Where it lies: km across (numbers like "12,0" in the Header, fitted to a straight line)
// and dates along time ("04.01.27", "KW 01"; snapped to the grid line at or before them).
//
// All geometry here is in each Plan's own page mm (the New Plan unshifted); callers convert
// from the comparison frame (Old page mm, New Plan at +Offset along time).
import { S } from "../alignment/shared.mjs";

const TOL = 0.4;        // mm: a line end touches another line
const TEXT_REACH = 2.0; // mm: a leader's free end reaches a text
const BESIDE = 3.0;     // mm: a text beside the object
const MAX_CHAIN = 8;    // more connected lines than this is a grid, not a leader
const CELL = 5;

const tI = () => (S.axis === "y" ? 1 : 0);
const colOf = (o) => { const p = o.style.split("|"); return o.kind === "glyph" ? p[3] : o.kind === "hatch" ? null : p[1]; };
const isOpen = (o) => o.kind === "stroke" && o.polys.every((p) => !p.closed);
const ck = (cx, cy) => cx * 100000 + cy;

function distPtSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const u = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - u * dx, py - ay - u * dy);
}
const distPtBox = (px, py, b) => Math.hypot(Math.max(b.x0 - px, 0, px - b.x1), Math.max(b.y0 - py, 0, py - b.y1));
const union = (a, b) => (!a ? { ...b } : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

/** Edges of an object's polys: [ax, ay, bx, by, …]. */
function edgesOf(o) {
  const out = [];
  for (const p of o.polys) {
    const k = p.pts, n = k.length / 2;
    for (let i = 0; i + 1 < n; i++) out.push(k[2 * i], k[2 * i + 1], k[2 * i + 2], k[2 * i + 3]);
    if (p.closed && n > 2) out.push(k[2 * n - 2], k[2 * n - 1], k[0], k[1]);
  }
  return out;
}
/** Points every `step` mm along edges (both ends included). */
function* along(e, step = CELL / 2) {
  for (let q = 0; q < e.length; q += 4) {
    const len = Math.hypot(e[q + 2] - e[q], e[q + 3] - e[q + 1]), n = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j <= n; j++) yield [e[q] + (e[q + 2] - e[q]) * j / n, e[q + 1] + (e[q + 3] - e[q + 1]) * j / n];
  }
}

// ---------- per-Plan index: open lines and text lines ----------

const IDX = new WeakMap();
export function planIndex(which) {
  const plan = S.plans[which];
  let ix = IDX.get(plan);
  if (ix) return ix;
  const t0 = performance.now();
  const segGrid = new Map(), spanGrid = new Map(), byPolys = new Map(), spans = new Map();
  for (const o of plan.objs) {
    if (o.polys && o.polys.length) byPolys.set(o.polys, o);
    if (o.kind === "glyph") {
      let s = spans.get(o.span);
      if (!s) spans.set(o.span, (s = { id: o.span, glyphs: [], box: null, col: colOf(o) }));
      s.glyphs.push(o); s.box = union(s.box, o.box);
      continue;
    }
    if (!isOpen(o)) continue;
    const e = edgesOf(o);
    let len = 0;
    for (let q = 0; q < e.length; q += 4) len += Math.hypot(e[q + 2] - e[q], e[q + 3] - e[q + 1]);
    if (len > 150) continue; // long lines are grid or Activities, never leaders
    const seen = new Set();
    for (const [x, y] of along(e)) {
      const k = ck(Math.floor(x / CELL), Math.floor(y / CELL));
      if (seen.has(k)) continue;
      seen.add(k);
      (segGrid.get(k) || segGrid.set(k, []).get(k)).push(o);
    }
  }
  for (const s of spans.values()) {
    s.glyphs.sort((a, b) => a.idx - b.idx);
    s.text = s.glyphs.map((g) => g.ch).join("").replace(/\s+/g, " ").trim();
    for (let cx = Math.floor(s.box.x0 / 10); cx <= Math.floor(s.box.x1 / 10); cx++)
      for (let cy = Math.floor(s.box.y0 / 10); cy <= Math.floor(s.box.y1 / 10); cy++) (spanGrid.get(ck(cx, cy)) || spanGrid.set(ck(cx, cy), []).get(ck(cx, cy))).push(s);
  }
  ix = { plan, segGrid, spanGrid, byPolys, spans, ms: Math.round(performance.now() - t0), axes: new Map() };
  IDX.set(plan, ix);
  return ix;
}
function linesNear(ix, x, y) {
  const out = new Set(), cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const o of ix.segGrid.get(ck(cx + dx, cy + dy)) || []) out.add(o);
  return out;
}
function spansNear(ix, x, y, r) {
  const out = [];
  for (let cx = Math.floor((x - r) / 10); cx <= Math.floor((x + r) / 10); cx++)
    for (let cy = Math.floor((y - r) / 10); cy <= Math.floor((y + r) / 10); cy++)
      for (const s of ix.spanGrid.get(ck(cx, cy)) || []) { const d = distPtBox(x, y, s.box); if (d <= r) out.push([s, d]); }
  return out;
}
/** The text line a word box (raw page mm) belongs to. */
export function spanAt(ix, box) {
  const x = (box.x0 + box.x1) / 2, y = (box.y0 + box.y1) / 2;
  let best = null, bd = 0.5;
  for (const [s, d] of spansNear(ix, x, y, 0.5)) if (d <= bd && s.text) { best = s; bd = d; }
  return best;
}
/** Text lines that continue each other on the same baseline (a label split into pieces). */
function wholeLine(ix, s) {
  const h = Math.min(s.box.y1 - s.box.y0, s.box.x1 - s.box.x0) || 2, parts = [s];
  for (let grow = true; grow;) {
    grow = false;
    const b = parts.reduce((a, p) => union(a, p.box), null);
    for (const [q] of spansNear(ix, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2 + h)) {
      if (parts.includes(q) || !q.text) continue;
      const sameLine = Math.abs(q.box.y1 - s.box.y1) < h * 0.3 && (Math.abs(q.box.x0 - b.x1) < h * 1.2 || Math.abs(b.x0 - q.box.x1) < h * 1.2);
      if (sameLine) { parts.push(q); grow = true; }
    }
  }
  parts.sort((a, b) => a.box.x0 - b.box.x0);
  return { text: parts.map((p) => p.text).join(" "), spans: parts };
}

// ---------- 1. follow the line ----------

/**
 * From the seed objects (raw), follow thin open lines that start on them, in their colour
 * (or any colour), to texts at the free ends. Returns { hits: [{span, d}], chain, leaders, branched }.
 */
export function followLine(ix, seeds, { anyColour = false } = {}) {
  const cols = new Set(seeds.map(colOf).filter(Boolean));
  const seedPolys = new Set(seeds.map((o) => o.polys));
  const ok = (o) => !seedPolys.has(o.polys) && (anyColour || cols.has(colOf(o)));
  const reached = new Set();
  const seedEdges = seeds.flatMap(edgesOf);
  const nearSeed = (x, y) => { for (let q = 0; q < seedEdges.length; q += 4) if (distPtSeg(x, y, seedEdges[q], seedEdges[q + 1], seedEdges[q + 2], seedEdges[q + 3]) < TOL) return true; return false; };
  const ends = (o) => o.polys.flatMap((p) => [[p.pts[0], p.pts[1]], [p.pts[p.pts.length - 2], p.pts[p.pts.length - 1]]]);
  // lines with an end on the seed
  for (const [x, y] of along(seedEdges)) {
    for (const o of linesNear(ix, x, y)) {
      if (reached.has(o) || !ok(o)) continue;
      if (ends(o).some(([ex, ey]) => nearSeed(ex, ey))) reached.add(o);
    }
    if (reached.size > MAX_CHAIN) return { hits: [], chain: reached.size, leaders: [], branched: true };
  }
  // and lines whose end touches those (a leader drawn in pieces)
  const queue = [...reached];
  while (queue.length) {
    const o = queue.shift();
    for (const [ex, ey] of ends(o)) for (const q of linesNear(ix, ex, ey)) {
      if (reached.has(q) || !ok(q)) continue;
      if (ends(q).some(([qx, qy]) => Math.hypot(qx - ex, qy - ey) < TOL)) { reached.add(q); queue.push(q); }
    }
    if (reached.size > MAX_CHAIN) return { hits: [], chain: reached.size, leaders: [], branched: true };
  }
  if (!reached.size) return { hits: [], chain: 0, leaders: [] };
  // free ends: not on the seed, not on another reached line
  const all = [...reached], hits = new Map();
  for (const o of all) for (const [ex, ey] of ends(o)) {
    if (nearSeed(ex, ey)) continue;
    if (all.some((q) => q !== o && ends(q).some(([qx, qy]) => Math.hypot(qx - ex, qy - ey) < TOL))) continue;
    for (const [s, d] of spansNear(ix, ex, ey, TEXT_REACH)) if (s.text && (!hits.has(s) || hits.get(s) > d)) hits.set(s, d);
  }
  return { hits: [...hits].map(([span, d]) => ({ span, d })).sort((a, b) => a.d - b.d), chain: all.length, leaders: all };
}

const lenOf = (o) => edgesOf(o).reduce((a, _, q, e) => (q % 4 ? a : a + Math.hypot(e[q + 2] - e[q], e[q + 3] - e[q + 1])), 0);
const lwOf = (o) => (o.kind === "stroke" && o.nums ? o.nums[0] : 0);
/**
 * Splits a place's changed objects into the drawn thing itself (core) and thin short open
 * lines that may be its leader (they changed along with it, e.g. when it moved).
 */
export function splitSeeds(seeds) {
  const maxLw = Math.max(0, ...seeds.map(lwOf));
  const thin = (o) => isOpen(o) && lenOf(o) < 150 && (seeds.some((s) => s.kind !== "stroke") || lwOf(o) < 0.75 * maxLw);
  const core = seeds.filter((o) => !thin(o));
  return core.length ? core : [seeds.reduce((a, o) => (size(o) > size(a) ? o : a))];
}

/** All drawn objects (not text) on a grid, built on first use (for following a line back). */
function objGrid(ix, col) {
  ix.objGrids = ix.objGrids || new Map();
  if (ix.objGrids.has(col)) return ix.objGrids.get(col);
  const g = new Map();
  for (const o of ix.plan.objs) {
    if (o.kind === "glyph" || !o.polys.length || (o.kind !== "hatch" && colOf(o) !== col)) continue;
    const seen = new Set();
    for (const [x, y] of along(edgesOf(o))) { const k = ck(Math.floor(x / CELL), Math.floor(y / CELL)); if (!seen.has(k)) { seen.add(k); (g.get(k) || g.set(k, []).get(k)).push(o); } }
  }
  ix.objGrids.set(col, g);
  return g;
}
/**
 * From a label, follow a leader line back to what it labels: the drawn objects at the
 * leader's other end. Returns [] when no leader starts at the label.
 */
export function followBack(ix, spans) {
  const box = spans.reduce((a, s) => union(a, s.box), null), c = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
  const ends = (o) => o.polys.flatMap((p) => [[p.pts[0], p.pts[1]], [p.pts[p.pts.length - 2], p.pts[p.pts.length - 1]]]);
  const start = new Set();
  for (let x = box.x0 - TEXT_REACH; x <= box.x1 + TEXT_REACH + CELL; x += CELL) for (let y = box.y0 - TEXT_REACH; y <= box.y1 + TEXT_REACH + CELL; y += CELL)
    for (const o of linesNear(ix, x, y)) if (ends(o).some(([ex, ey]) => distPtBox(ex, ey, box) < TEXT_REACH)) start.add(o);
  if (!start.size || start.size > 2) return [];
  const col = colOf([...start][0]), chain = new Set(start), queue = [...start];
  while (queue.length && chain.size <= MAX_CHAIN) {
    const o = queue.shift();
    for (const [ex, ey] of ends(o)) for (const q of linesNear(ix, ex, ey)) if (!chain.has(q) && colOf(q) === col && ends(q).some(([qx, qy]) => Math.hypot(qx - ex, qy - ey) < TOL)) { chain.add(q); queue.push(q); }
  }
  if (chain.size > MAX_CHAIN) return [];
  const g = objGrid(ix, col), found = new Set();
  for (const o of chain) for (const [ex, ey] of ends(o)) {
    if (distPtBox(ex, ey, box) < TEXT_REACH) continue;
    const cx = Math.floor(ex / CELL), cy = Math.floor(ey / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const q of g.get(ck(cx + dx, cy + dy)) || []) {
      if (chain.has(q) || found.has(q) || colOf(q) !== col) continue;
      const e = edgesOf(q);
      for (let k = 0; k < e.length; k += 4) if (distPtSeg(ex, ey, e[k], e[k + 1], e[k + 2], e[k + 3]) < TOL) { found.add(q); break; }
    }
  }
  // the whole drawn thing: hatches and areas under the found outline
  for (const o of [...found]) {
    const b = boxOf(o.polys.flatMap((p) => p.pts));
    for (let x = b.x0; x <= b.x1 + CELL; x += CELL) for (let y = b.y0; y <= b.y1 + CELL; y += CELL)
      for (const q of g.get(ck(Math.floor(x / CELL), Math.floor(y / CELL))) || []) {
        if (found.has(q) || chain.has(q) || q.kind === "stroke") continue;
        const qb = boxOf(q.polys.flatMap((p) => p.pts));
        if (Math.abs(qb.x0 - b.x0) < 0.5 && Math.abs(qb.x1 - b.x1) < 0.5 && Math.abs(qb.y0 - b.y0) < 0.5 && Math.abs(qb.y1 - b.y1) < 0.5) found.add(q);
      }
  }
  void c;
  return [...found];
}

// ---------- 2. text beside ----------

export function besideText(ix, seeds) {
  let best = null, bd = BESIDE;
  for (const [x, y] of along(seeds.flatMap(edgesOf), 2)) for (const [s, d] of spansNear(ix, x, y, bd)) if (s.text && d < bd && !/^[\d.,:\s-]+$/.test(s.text)) { best = s; bd = d; }
  return best;
}

// ---------- shape ----------

export function shapeOf(objs) {
  if (!objs.length) return "Text";
  if (objs.some((o) => o.kind === "hatch")) return "Schraffur";
  const main = objs.reduce((a, o) => (size(o) > size(a) ? o : a));
  const p = main.polys[0], k = p ? p.pts : [], n = k.length / 2;
  const closed = main.kind !== "stroke" || main.polys.every((q) => q.closed);
  if (!closed) return main.polys.length === 1 && n === 2 ? "Linie" : n === 2 ? "Linien" : "Linienzug";
  if (n >= 4 && n <= 5 && isRect(k)) return "Rechteck";
  if (n >= 12) {
    const b = boxOf(k), w = b.x1 - b.x0, h = b.y1 - b.y0;
    return Math.abs(w - h) / Math.max(w, h) < 0.12 ? "Kreis" : "Oval";
  }
  if (n === 4) { const b = boxOf(k), mid = (i) => Math.abs(k[2 * i] - (b.x0 + b.x1) / 2) < 0.05 || Math.abs(k[2 * i + 1] - (b.y0 + b.y1) / 2) < 0.05; return [0, 1, 2, 3].every(mid) ? "Raute" : "Viereck"; }
  return "Fläche";
}
const boxOf = (k) => { let b = null; for (let i = 0; i < k.length; i += 2) b = union(b, { x0: k[i], y0: k[i + 1], x1: k[i], y1: k[i + 1] }); return b || { x0: 0, y0: 0, x1: 0, y1: 0 }; };
const size = (o) => { const b = boxOf(o.polys.flatMap((p) => p.pts)); return Math.hypot(b.x1 - b.x0, b.y1 - b.y0); };
function isRect(k) {
  const b = boxOf(k);
  for (let i = 0; i < k.length; i += 2) if (!((Math.abs(k[i] - b.x0) < 0.01 || Math.abs(k[i] - b.x1) < 0.01) && (Math.abs(k[i + 1] - b.y0) < 0.01 || Math.abs(k[i + 1] - b.y1) < 0.01))) return false;
  return true;
}
export const objsBox = (objs) => objs.reduce((a, o) => union(a, boxOf(o.polys.flatMap((p) => p.pts))), null);

// ---------- the axes ----------

/** Robust straight line v = c0 + c1·pos through points [pos, v]; residual in pos units. */
function fitLine(pts, tolPos) {
  if (pts.length < 3) return null;
  let best = null;
  const n = pts.length, tries = [];
  for (let i = 0; i < n; i++) for (const k of [1, 2, 3, 5, 8, 13, Math.floor(n / 2)]) if (i + k < n) tries.push([i, i + k]);
  for (const [i, j] of tries) {
    const [p0, v0] = pts[i], [p1, v1] = pts[j];
    if (Math.abs(p1 - p0) < 1e-6 || v1 === v0) continue;
    const c1 = (v1 - v0) / (p1 - p0), c0 = v0 - c1 * p0;
    const inl = pts.filter(([p, v]) => Math.abs((v - c0) / c1 - p) < tolPos);
    if (!best || inl.length > best.length) best = inl;
  }
  if (!best || best.length < 3) return null;
  const m = best.length, mp = best.reduce((a, [p]) => a + p, 0) / m, mv = best.reduce((a, [, v]) => a + v, 0) / m;
  let sxy = 0, sxx = 0;
  for (const [p, v] of best) { sxy += (p - mp) * (v - mv); sxx += (p - mp) ** 2; }
  if (!sxx) return null;
  const c1 = sxy / sxx, c0 = mv - c1 * mp;
  const res = best.map(([p, v]) => Math.abs((v - c0) / c1 - p)).sort((a, b) => a - b);
  return { c0, c1, inliers: m, of: pts.length, residual: res[Math.floor(m / 2)], pts: best };
}

const MONTHS = ["jan", "feb", "mär", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "dez"];
const DAY = 86400000;
const dayNo = (y, m, d) => Date.UTC(y, m, d) / DAY;
const year4 = (y) => (y < 100 ? 2000 + y : y);
function isoMonday(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4)), wd = (jan4.getUTCDay() + 6) % 7;
  return jan4.getTime() / DAY - wd + (week - 1) * 7;
}

/** Axis zones the user drew on this Plan (round 2): { time: [rect], dist: [rect], rows: [rect] }. */
export function axisZones(which) {
  const z = { time: [], dist: [], rows: [] };
  for (const ig of S.ignores || []) if (ig.plan === which && ig.role && z[ig.role]) z[ig.role].push(ig.rect);
  return z;
}
const inRects = (rs, b) => { const x = (b.x0 + b.x1) / 2, y = (b.y0 + b.y1) / 2; return rs.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1); };

/**
 * Reads the km axis across and the date axis along time. Cached per Plan, axis, Body and
 * axis zones. With a zone (round 2) only the texts inside it count, and any number there is
 * a km ("12", "12,5", "km 12,5", "12+500"); without, km are decimal numbers in the Header
 * and dates are read anywhere inside the Body.
 */
export function axesOf(which) {
  const zones = axisZones(which);
  const ix = planIndex(which), [b0, b1] = S.body[which], key = `${S.axis}|${b0.toFixed(1)}|${b1.toFixed(1)}|${JSON.stringify(zones)}`;
  if (ix.axes.has(key)) return ix.axes.get(key);
  const t = tI(), lo = (b) => (t ? b.y0 : b.x0), hi = (b) => (t ? b.y1 : b.x1), aLo = (b) => (t ? b.x0 : b.y0), aHi = (b) => (t ? b.x1 : b.y1);
  const spans = [...ix.spans.values()].filter((s) => s.text);

  // km across: decimal numbers in the Header ("12,0", "12.5", "12+500"), or any in the zone
  const kmPts = [];
  for (const s of spans) {
    let m;
    if (zones.dist.length) {
      if (!inRects(zones.dist, s.box)) continue;
      // Bahn-km as "12,4 + 70" (km 12,4 plus 70 m)
      if ((m = /^(?:km\s*)?(\d{1,4}),(\d)\s*\+\s*(\d{1,3})$/i.exec(s.text))) { kmPts.push([(aLo(s.box) + aHi(s.box)) / 2, +m[1] + +m[2] / 10 + +m[3] / 1000]); continue; }
      if (!(m = /^(?:km\s*)?(\d{1,4})(?:([,.+])(\d{1,3}))?$/i.exec(s.text))) continue;
      kmPts.push([(aLo(s.box) + aHi(s.box)) / 2, m[2] === "+" ? +m[1] + +m[3] / 1000 : +`${m[1]}.${m[3] || 0}`]);
      continue;
    }
    if ((lo(s.box) + hi(s.box)) / 2 >= b0) continue;
    if ((m = /^(\d{1,3})[,.+](\d{1,3})$/.exec(s.text))) { kmPts.push([(aLo(s.box) + aHi(s.box)) / 2, s.text.includes("+") ? +m[1] + +m[2] / 1000 : +`${m[1]}.${m[2]}`]); continue; }
    // Round 4: a km inside a longer label, written along the time direction so that it marks
    // one place across ("Anfang Brücke km 12,0 + 86", "DL km 14,594")
    if (aHi(s.box) - aLo(s.box) > 6) continue;
    if ((m = /km\s*(\d{1,4}),(\d{1,3})(?:\s*\+\s*(\d{1,3}))?/i.exec(s.text))) {
      const v = m[3] !== undefined ? +m[1] + +`0.${m[2]}` + +m[3] / 1000 : +`${m[1]}.${m[2]}`;
      kmPts.push([(aLo(s.box) + aHi(s.box)) / 2, v]);
    }
  }
  kmPts.sort((a, b) => a[0] - b[0]);
  let km = fitLine(kmPts, 3);
  // Round 4: a scale that changes between sections ("1 : 10000", "1 : 5000") is straight only
  // piece by piece: then km are interpolated between the marks that run in one direction.
  if ((!km || km.inliers < 0.8 * kmPts.length) && kmPts.length >= 3) {
    const uniq = [];
    for (const p of kmPts) if (!uniq.some((q) => Math.abs(q[0] - p[0]) < 0.5 && Math.abs(q[1] - p[1]) < 0.0005)) uniq.push(p);
    const pw = monotone(uniq);
    if (pw.length >= 3) km = { pw, inliers: pw.length, of: uniq.length, residual: 0, c0: null, c1: null };
  }

  // dates along time, inside the Body band (or the time zone): "04.01.27", "Mo 04.01.2027", "KW 01", "Jan 2027"
  const inBody = zones.time.length ? (s) => inRects(zones.time, s.box) : (s) => { const c = (lo(s.box) + hi(s.box)) / 2; return c >= b0 && c <= b1; };
  const dmy = [], kw = [], mon = [], hrs = [];
  for (const s of spans) {
    if (!inBody(s)) continue;
    let m;
    // Round 3: hour labels ("2", "08:00", "14 Uhr"), only inside a Zeitachse zone: elsewhere
    // "21:00" is often the time written at the end of a bar, not an axis
    if (zones.time.length && (m = /^(\d{1,2})(?::(\d{2}))?(?:\s*Uhr)?$/i.exec(s.text)) && +m[1] <= 24 && (!m[2] || +m[2] < 60)) {
      hrs.push({ lo: lo(s.box), hi: hi(s.box), h: +m[1] + (m[2] ? +m[2] / 60 : 0) });
      continue;
    }
    if ((m = /^(?:[A-Za-z]{2}\.?\s+)?(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(s.text))) dmy.push([lo(s.box), dayNo(year4(+m[3]), +m[2] - 1, +m[1])]);
    else if ((m = /^KW\s*(\d{1,2})(?:\s*[/.]\s*(\d{2}|\d{4}))?$/i.exec(s.text))) kw.push([lo(s.box), +m[1], m[2] ? year4(+m[2]) : null]);
    else if ((m = /^([A-Za-zä]{3})[a-zä]*\.?\s+(\d{4})$/i.exec(s.text))) { const i = MONTHS.indexOf(m[1].toLowerCase().replace("mrz", "mär")); if (i >= 0) mon.push([lo(s.box), dayNo(+m[2], i, 1)]); }
  }
  // coarse fit (also to know the year of a "KW"), then the KW labels join
  const byPos = (a, b) => a[0] - b[0];
  const coarse = fitLine([...dmy, ...mon].sort(byPos), 80);
  const kwDays = [];
  for (const [p, w, y] of kw) {
    if (y) { kwDays.push([p, isoMonday(y, w)]); continue; }
    if (!coarse) continue;
    const guess = coarse.c0 + coarse.c1 * p, gy = new Date(guess * DAY).getUTCFullYear();
    const best = [gy - 1, gy, gy + 1].map((yy) => isoMonday(yy, w)).sort((a, b) => Math.abs(a - guess) - Math.abs(b - guess))[0];
    if (Math.abs(best - guess) < 10) kwDays.push([p, best]);
  }
  // one point per date: the label nearest the start of its cell
  const first = new Map();
  for (const [p, v] of [...dmy, ...kwDays]) if (!first.has(v) || first.get(v) > p) first.set(v, p);
  const datePts = [...first].map(([v, p]) => [p, v]).sort(byPos);
  let time = fitLine(datePts, 6);
  let grid = null, hours = hrs.length ? { labels: hrs.length, agree: null, shift: null } : null;
  if (time) {
    // grid lines across time in the Body; each label snaps to the one at or before it
    const per = 1 / Math.abs(time.c1), pos = [];
    for (const o of ix.plan.objs) {
      if (o.kind !== "stroke" && o.kind !== "fill") continue;
      for (const p of o.polys) for (let i = 0; i + 3 < p.pts.length; i += 2) {
        const dt = Math.abs(p.pts[i + t] - p.pts[i + 2 + t]), da = Math.abs(p.pts[i + 1 - t] - p.pts[i + 3 - t]);
        if (dt < 0.05 && da >= 5 && p.pts[i + t] > b0 && p.pts[i + t] < b1) pos.push(p.pts[i + t]);
      }
    }
    pos.sort((a, b) => a - b);
    if (pos.length > 3) {
      const at = (x) => { let l = 0, r = pos.length - 1, ans = -1; while (l <= r) { const m = (l + r) >> 1; if (pos[m] <= x + 0.05) { ans = m; l = m + 1; } else r = m - 1; } return ans < 0 ? null : pos[ans]; };
      const snapped = time.pts.map(([p, v]) => { const g = at(p); return [g !== null && p - g < per * 0.8 ? g : p, v]; });
      const c1 = time.c1, a = snapped.map(([p, v]) => v - c1 * p).sort((x, y) => x - y);
      grid = { lines: pos.length, snapped: snapped.filter(([p], i) => p !== time.pts[i][0]).length };
      time = { ...time, c0: a[Math.floor(a.length / 2)] };
    }
    // Round 3: hour labels set the time of day; the dates only say which day it is. Each
    // label stands for a grid line: one running through the label (a centred label), else the
    // one at or before its start (a label after its tick), else its middle.
    if (hrs.length >= 3) {
      const near = (x) => { let l = 0, r = pos.length - 1; while (l < r) { const m = (l + r) >> 1; if (pos[m] < x) l = m + 1; else r = m; } return l; };
      const hourMm = per / 24, c1 = time.c1;
      // Which grid line does an hour label stand for? Plans differ, so each way is tried:
      // a line through the label (centred), the line just before it (label after its tick),
      // the line just after it (label above / left of its line), or no line (its middle).
      const lineIn = (a, b) => { const i = near(a); return pos[i] !== undefined && pos[i] <= b ? pos[i] : null; };
      const WAYS = {
        "durch die Zahl": (hl) => lineIn(hl.lo - 0.05, hl.hi + 0.05),
        "vor der Zahl": (hl) => { const i = near(hl.lo + 0.05) - 1; return i >= 0 && hl.lo - pos[i] < hourMm ? pos[i] : null; },
        "nach der Zahl": (hl) => lineIn(hl.hi - 0.05, hl.hi + hourMm),
        "Mitte der Zahl": (hl) => (hl.lo + hl.hi) / 2,
      };
      const tries = [];
      for (const [way, fn] of Object.entries(WAYS)) {
        let sx = 0, sy = 0, n = 0;
        for (const hl of hrs) { const p = fn(hl); if (p == null) continue; const f = hl.h / 24 - c1 * p; sx += Math.cos(2 * Math.PI * f); sy += Math.sin(2 * Math.PI * f); n++; }
        if (n < Math.max(3, hrs.length * 0.6)) continue;
        const R = Math.hypot(sx, sy) / n, frac = ((Math.atan2(sy, sx) / (2 * Math.PI)) % 1 + 1) % 1;
        const c0 = frac + Math.round(time.c0 - frac); // the day nearest to what the dates say
        tries.push({ way, R, c0, shift: (c0 - time.c0) * 24 });
      }
      // consistent ways only; of those, the one that moves the dates' time of day the least
      const ok = tries.filter((x) => x.R > 0.95).sort((a, b) => Math.abs(a.shift) - Math.abs(b.shift));
      if (ok.length) { hours = { labels: hrs.length, agree: ok[0].R, shift: ok[0].shift, way: ok[0].way }; time = { ...time, c0: ok[0].c0 }; }
      else hours = { labels: hrs.length, agree: Math.max(0, ...tries.map((x) => x.R)), shift: null };
    }
  }
  const out = { km, time, grid, hours, zones: { time: zones.time.length, dist: zones.dist.length, rows: zones.rows.length }, counts: { km: kmPts.length, dmy: dmy.length, kw: kw.length, mon: mon.length } };
  ix.axes.set(key, out);
  return out;
}

// ---------- German wording for where it lies ----------

const de = (v, d) => v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const dd = (n) => String(n).padStart(2, "0");
const dateParts = (day) => { const x = new Date(Math.round(day) * DAY); return [x.getUTCDate(), x.getUTCMonth() + 1, x.getUTCFullYear()]; };
export const fmtDate = (day) => { const [d, m, y] = dateParts(day); return `${dd(d)}.${dd(m)}.${String(y).slice(2)}`; };

/** "km 12,4–15,6" or "km 26,0" for a box across (raw mm), or null. */
/** The longest run of marks whose km only rise (or only fall) across: the scale's own marks. */
function monotone(pts) {
  const best = (sign) => {
    const n = pts.length, len = new Array(n).fill(1), prev = new Array(n).fill(-1);
    for (let i = 0; i < n; i++) for (let j = 0; j < i; j++)
      if (pts[i][0] - pts[j][0] > 0.5 && sign * (pts[i][1] - pts[j][1]) > 0 && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
    let k = len.indexOf(Math.max(...len)), out = [];
    while (k >= 0) { out.push(pts[k]); k = prev[k]; }
    return out.reverse();
  };
  const up = best(1), down = best(-1);
  return up.length >= down.length ? up : down;
}
/** km at a position across (raw mm): on the straight line, or between the marks (round 4). */
export function kmAt(ax, a) {
  const k = ax.km;
  if (!k) return null;
  if (!k.pw) return k.c0 + k.c1 * a;
  const p = k.pw;
  let i = 1;
  while (i < p.length - 1 && p[i][0] < a) i++;
  const [x0, v0] = p[i - 1], [x1, v1] = p[i];
  return v0 + ((v1 - v0) * (a - x0)) / (x1 - x0);
}
export function kmText(ax, a0, a1) {
  if (!ax.km) return null;
  let k0 = kmAt(ax, a0), k1 = kmAt(ax, a1);
  if (k0 > k1) [k0, k1] = [k1, k0];
  return k1 - k0 < 0.05 ? `km ${de((k0 + k1) / 2, 1)}` : `km ${de(k0, 1)}–${de(k1, 1)}`;
}
/**
 * "03.06.–12.07.27" for a time range (raw mm), or null. The end is the last day covered.
 * Round 2: when a start or end is not on a day boundary, with the time ("05.07. 08:00 –
 * 06.07.27 14:00"). A boundary is anything within 0.6 mm of the Plan (line widths, outlines).
 * point: a milestone, one date at its middle.
 */
export function dateText(ax, t0, t1, { point = false } = {}) {
  if (!ax.time) return null;
  let d0 = ax.time.c0 + ax.time.c1 * t0, d1 = ax.time.c0 + ax.time.c1 * t1;
  if (d0 > d1) [d0, d1] = [d1, d0];
  const mmPerDay = 1 / Math.abs(ax.time.c1);
  const onDay = (d) => Math.abs(d - Math.round(d)) * mmPerDay < 0.6;
  const hour = (d) => Math.round(d * 24); // hours since the epoch
  const hm = (H) => `${dd(H % 24)}:00`;
  if (point) { const m = (d0 + d1) / 2; return `am ${fmtDate(Math.floor(m))}`; }
  if (!onDay(d0) || !onDay(d1)) {
    let H0 = hour(d0), H1 = hour(d1);
    if (onDay(d0)) H0 = Math.round(d0) * 24;
    if (onDay(d1)) H1 = Math.round(d1) * 24;
    if (H1 <= H0) return `am ${fmtDate(Math.floor(H0 / 24))}, ${hm(H0)}`;
    const day0 = Math.floor(H0 / 24), day1 = Math.floor((H1 - 1) / 24), end = H1 % 24 === 0 ? "24:00" : hm(H1);
    if (day0 === day1) return `${fmtDate(day0)}, ${hm(H0)}–${end}`;
    const [da, ma] = dateParts(day0);
    return `${dd(da)}.${dd(ma)}. ${hm(H0)} – ${fmtDate(day1)} ${end}`;
  }
  const a = Math.round(d0), b = Math.max(a, Math.round(d1) - 1);
  if (a === b) return `am ${fmtDate(a)}`;
  const [da, ma, ya] = dateParts(a), [db, mb, yb] = dateParts(b);
  return ya === yb ? `${dd(da)}.${dd(ma)}.–${dd(db)}.${dd(mb)}.${String(yb).slice(2)}` : `${fmtDate(a)}–${fmtDate(b)}`;
}
/** A length along time (mm) as days and hours, or null without a time axis. */
export function daysText(ax, mm) {
  if (!ax.time) return null;
  // within 0.6 mm of whole days (line widths, outlines): whole days
  const mmPerDay = 1 / Math.abs(ax.time.c1), v = Math.abs(mm) / mmPerDay;
  // a difference between Old and New: line widths cancel, so only rounding noise is snapped
  return durText(Math.abs(v - Math.round(v)) * mmPerDay < 0.05 ? Math.round(v) : v);
}
/** Round 2: "8 Std.", "1 Tag 8 Std." (not "1,3 Tage"), "3 Tage", "40 Min.". */
export function durText(days) {
  const mins = Math.round(Math.abs(days) * 1440);
  if (mins < 60) return `${mins} Min.`;
  const hrs = Math.round(mins / 60), d = Math.floor(hrs / 24), r = hrs % 24;
  if (!d) return `${r} Std.`;
  const ds = `${d} ${d === 1 ? "Tag" : "Tage"}`;
  return r ? `${ds} ${r} Std.` : ds;
}
/** A length across (mm) in km, or null without a km axis. */
export function kmLenText(ax, mm, at = 0) {
  if (!ax.km) return null;
  const v = Math.abs(kmAt(ax, at + mm) - kmAt(ax, at));
  return v >= 1 ? `${de(v, 1)} km` : `${de(v * 1000, 0)} m`;
}

/** Bar chart: the row's text in the Header across from `a` (raw mm). */
export function rowText(which, a) {
  const ix = planIndex(which), [b0] = S.body[which], t = tI(), rows = axisZones(which).rows;
  const hits = [];
  for (const s of ix.spans.values()) {
    if (!s.text || /^[\d.,:\s-]+$/.test(s.text)) continue;
    const c = t ? (s.box.y0 + s.box.y1) / 2 : (s.box.x0 + s.box.x1) / 2;
    if (rows.length ? !inRects(rows, s.box) : c >= b0) continue; // round 2: the Vorgänge zone
    const lo = t ? s.box.x0 : s.box.y0, hi = t ? s.box.x1 : s.box.y1;
    if (a >= lo - 1.5 && a <= hi + 1.5) hits.push(s);
  }
  if (!hits.length) return null;
  // the row's own cell: the longest text right across from it
  return hits.sort((x, y) => y.text.length - x.text.length)[0].text;
}

export { wholeLine };
