// PROTOTYPE (throwaway) for "Which Difference detection holds up on the synthetic pair?".
// Pure logic, no MuPDF, no DOM: plain objects in page mm in, Difference boxes out.
//
// Coordinates: page mm, origin top-left. `axis` is the Time direction's coordinate:
// "y" (time runs down) or "x" (time runs right). The "Old frame" is the Old Plan's page;
// a New Plan point lands in the Old frame at t + offset.

// ---------- geometry helpers ----------

const tIdx = (axis) => (axis === "y" ? 1 : 0);

export function bboxOf(flat) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < flat.length; i += 2) {
    const x = flat[i], y = flat[i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

const intersects = (a, b, pad = 0) =>
  a.x0 - pad <= b.x1 && b.x0 - pad <= a.x1 && a.y0 - pad <= b.y1 && b.y0 - pad <= a.y1;

const unionBox = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const area = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const interBox = (a, b) => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });

/** Liang–Barsky: clip segment to rect, null if outside. */
function clipSeg(ax, ay, bx, by, r) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const p = [-dx, dx, -dy, dy], q = [ax - r.x0, r.x1 - ax, ay - r.y0, r.y1 - ay];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
    else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy];
}

/** Sutherland–Hodgman: clip polygon (flat) to rect. */
function clipPoly(flat, r) {
  let pts = [];
  for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  const edges = [
    (p) => p[0] >= r.x0, (p) => p[0] <= r.x1, (p) => p[1] >= r.y0, (p) => p[1] <= r.y1,
  ];
  const cut = [
    (a, b) => [r.x0, a[1] + (b[1] - a[1]) * (r.x0 - a[0]) / (b[0] - a[0])],
    (a, b) => [r.x1, a[1] + (b[1] - a[1]) * (r.x1 - a[0]) / (b[0] - a[0])],
    (a, b) => [a[0] + (b[0] - a[0]) * (r.y0 - a[1]) / (b[1] - a[1]), r.y0],
    (a, b) => [a[0] + (b[0] - a[0]) * (r.y1 - a[1]) / (b[1] - a[1]), r.y1],
  ];
  for (let e = 0; e < 4 && pts.length; e++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i];
      const ina = edges[e](a), inb = edges[e](b);
      if (inb) { if (!ina) out.push(cut[e](a, b)); out.push(b); }
      else if (ina) out.push(cut[e](a, b));
    }
    pts = out;
  }
  return pts.length >= 3 ? pts.flat() : null;
}

// ---------- object matching ----------

/**
 * Move a Plan's objects into the Old frame (shift along the Time direction) and clip
 * them to `win` (the overlap of both Bodies, in the Old frame) and to their own clip rect.
 * Objects: { kind: "stroke"|"fill"|"hatch"|"glyph", style, polys: [{pts, closed}],
 *            clip: {x0,y0,x1,y1}|null, halfW?, origin?, box?, span?, idx?, ch? }
 */
export function placeObjects(objs, { axis, shift, win }) {
  const t = tIdx(axis);
  const sh = (flat) => { const o = flat.slice(); for (let i = t; i < o.length; i += 2) o[i] += shift; return o; };
  const band = axis === "y" ? { x0: -1e9, x1: 1e9, y0: win[0], y1: win[1] } : { x0: win[0], x1: win[1], y0: -1e9, y1: 1e9 };
  const out = [];
  for (const o of objs) {
    let r = band;
    if (o.clip) {
      const c = o.clip, d = shift;
      const cs = axis === "y" ? { x0: c.x0, x1: c.x1, y0: c.y0 + d, y1: c.y1 + d } : { x0: c.x0 + d, x1: c.x1 + d, y0: c.y0, y1: c.y1 };
      r = interBox(band, cs);
      if (r.x0 > r.x1 || r.y0 > r.y1) continue;
    }
    if (o.kind === "glyph") {
      const [ox, oy] = sh(o.origin);
      if (ox < r.x0 || ox > r.x1 || oy < r.y0 || oy > r.y1) continue;
      const b = o.box, bb = axis === "y" ? { ...b, y0: b.y0 + shift, y1: b.y1 + shift } : { ...b, x0: b.x0 + shift, x1: b.x1 + shift };
      out.push({ ...o, coords: [ox, oy], bbox: bb, key: o.style, altKey: noColour(o.style) });
      continue;
    }
    const coords = [];
    let parts = 0;
    for (const p of o.polys) {
      const f = sh(p.pts);
      if (o.kind === "stroke") {
        const n = f.length / 2, segs = p.closed ? n : n - 1;
        for (let i = 0; i < segs; i++) {
          const j = (i + 1) % n;
          const s = clipSeg(f[2 * i], f[2 * i + 1], f[2 * j], f[2 * j + 1], r);
          if (s) { coords.push(...s); parts++; }
        }
      } else {
        const c = clipPoly(f, r);
        if (c) { coords.push(...c, NaN, NaN); parts++; } // NaN pair separates polygons
      }
    }
    if (!parts) continue;
    const real = coords.filter((v) => !Number.isNaN(v));
    const bb = bboxOf(real), hw = o.halfW || 0;
    out.push({ ...o, coords, bbox: { x0: bb.x0 - hw, y0: bb.y0 - hw, x1: bb.x1 + hw, y1: bb.y1 + hw }, key: `${o.style}|${coords.length}`, altKey: `${noColour(o.style)}|${coords.length}` });
  }
  return out;
}

/** A style key without its colours (colours are written as 0.123,0.456,…). */
const noColour = (style) => style.replace(/\d+\.\d{3}(?:,\d+\.\d{3})*/g, "c");

/**
 * One-to-one match of placed Old and New objects: same key, all coordinates within tol mm.
 * keyOf: o => o.key (exact style), or o => o.altKey to match regardless of colour.
 */
export function matchObjects(oldP, newP, tol = 0.05, keyOf = (o) => o.key) {
  const CELL = 2;
  const idx = new Map();
  const cellOf = (b) => [Math.floor((b.x0 + b.x1) / 2 / CELL), Math.floor((b.y0 + b.y1) / 2 / CELL)];
  newP.forEach((o, i) => {
    const [cx, cy] = cellOf(o.bbox), k = `${keyOf(o)}#${cx},${cy}`;
    (idx.get(k) || idx.set(k, []).get(k)).push(i);
  });
  const used = new Uint8Array(newP.length), oldUnmatched = [];
  const same = (a, b) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (Number.isNaN(a[i])) { if (!Number.isNaN(b[i])) return false; continue; }
      if (Math.abs(a[i] - b[i]) > tol) return false;
    }
    return true;
  };
  // Sizes, line widths, dash lengths: equal within 0.01 mm (UserUnit differs per Plan).
  const sameNums = (a = [], b = []) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 0.01);
  for (const o of oldP) {
    const [cx, cy] = cellOf(o.bbox);
    let hit = -1;
    for (let dx = -1; dx <= 1 && hit < 0; dx++) for (let dy = -1; dy <= 1 && hit < 0; dy++) {
      const list = idx.get(`${keyOf(o)}#${cx + dx},${cy + dy}`);
      if (list) for (const i of list) if (!used[i] && sameNums(o.nums, newP[i].nums) && same(o.coords, newP[i].coords)) { hit = i; break; }
    }
    if (hit >= 0) used[hit] = 1; else oldUnmatched.push(o);
  }
  return { oldUnmatched, newUnmatched: newP.filter((_, i) => !used[i]) };
}

/**
 * Refine a by-eye Offset: vote over pairs of same-shape objects (shape relative to its own
 * corner) whose position differs by guess ± range along the Time direction.
 */
export function refineOffset(oldObjs, newObjs, { axis, guess = 0, range = 5, top = 1 }) {
  const t = tIdx(axis);
  const shapeKey = (o) => {
    if (o.kind === "glyph") return o.style + "|" + Math.round(o.nums[0] * 10);
    const all = o.polys.flatMap((p) => p.pts);
    if (all.length > 40) return null;
    const b = bboxOf(all);
    return o.style + "|" + (o.nums || []).map((v) => Math.round(v * 10)) + "|" + all.map((v, i) => Math.round((v - (i % 2 ? b.y0 : b.x0)) * 10)).join(",");
  };
  const pos = (o) => (o.kind === "glyph" ? o.origin : (() => { const b = bboxOf(o.polys.flatMap((p) => p.pts)); return [b.x0, b.y0]; })());
  const byKey = new Map();
  for (const o of oldObjs) { const k = shapeKey(o); if (k) (byKey.get(k) || byKey.set(k, []).get(k)).push(pos(o)); }
  const bins = new Map(), deltas = [];
  for (const o of newObjs) {
    const k = shapeKey(o), list = k && byKey.get(k);
    if (!list || list.length > 50) continue;
    const p = pos(o);
    for (const q of list) {
      if (Math.abs(q[1 - t] - p[1 - t]) > 0.2) continue;
      const d = q[t] - p[t];
      if (Math.abs(d - guess) > range) continue;
      const bin = Math.round(d * 100);
      bins.set(bin, (bins.get(bin) || 0) + 1);
      deltas.push(d);
    }
  }
  // Peaks: bins summed with their neighbours (±0.02 mm), best first, at least 1 mm apart.
  const sum3 = (bin) => (bins.get(bin - 2) || 0) + (bins.get(bin - 1) || 0) + (bins.get(bin) || 0) + (bins.get(bin + 1) || 0) + (bins.get(bin + 2) || 0);
  const ranked = [...bins.keys()].map((bin) => [bin, sum3(bin)]).sort((a, b) => b[1] - a[1]);
  const peaks = [];
  for (const [bin] of ranked) {
    if (peaks.length >= top) break;
    if (peaks.some((p) => Math.abs(p - bin) < 100)) continue;
    peaks.push(bin);
  }
  if (!peaks.length) return { offset: guess, votes: 0, candidates: [] };
  const candidates = peaks.map((bin) => {
    const near = deltas.filter((d) => Math.abs(d - bin / 100) <= 0.02);
    return { offset: near.reduce((a, b) => a + b, 0) / near.length, votes: near.length };
  });
  return { ...candidates[0], candidates, pairs: deltas.length };
}

/** Is a raw (unplaced) object inside [b0, b1] along the Time direction? */
export function inBand(o, axis, [b0, b1]) {
  const t = tIdx(axis);
  if (o.kind === "glyph") return o.origin[t] >= b0 && o.origin[t] <= b1;
  const b = bboxOf(o.polys.flatMap((p) => p.pts));
  const lo = t ? b.y0 : b.x0, hi = t ? b.y1 : b.x1;
  return lo >= b0 && hi <= b1;
}

// ---------- text: which words changed ----------

const wordsOfSpan = (glyphs) => {
  const words = [];
  let cur = null;
  for (const g of glyphs) {
    if (g.ch === " ") { cur = null; continue; }
    if (!cur) { cur = { text: "", box: { ...g.bbox }, glyphs: [] }; words.push(cur); }
    cur.text += g.ch; cur.box = unionBox(cur.box, g.bbox); cur.glyphs.push(g);
  }
  return words;
};

/** Is `short` what is left of `long` after deleting characters? */
const isShortened = (long, short) => {
  if (short.length >= long.length) return false;
  let i = 0;
  for (const c of long) if (c === short[i]) i++;
  return i === short.length;
};

/**
 * Changed text, word by word. Spans (labels) with a left-over glyph are paired Old↔New
 * when they overlap in the Old frame; their words are diffed (LCS):
 *   - a word only in New, or a replaced word → Added (red, New Plan)
 *   - a word only in Old, or a word that only lost characters → Removed (yellow, Old Plan)
 * A label without a partner (moved with its Activity, deleted, new) marks its changed words.
 * Boxes are in the Old frame.
 */
export function textChanges(oldUnmatched, newUnmatched, oldPlaced, newPlaced) {
  const spansOf = (placed) => {
    const m = new Map();
    for (const o of placed) if (o.kind === "glyph") (m.get(o.span) || m.set(o.span, []).get(o.span)).push(o);
    for (const l of m.values()) l.sort((a, b) => a.idx - b.idx);
    return m;
  };
  const so = spansOf(oldPlaced), sn = spansOf(newPlaced);
  const touched = (unmatched, spans) => {
    const left = new Map();
    for (const o of unmatched) if (o.kind === "glyph") (left.get(o.span) || left.set(o.span, new Set()).get(o.span)).add(o);
    return [...left].map(([id, set]) => {
      const glyphs = spans.get(id);
      return { id, glyphs, box: glyphs.map((g) => g.bbox).reduce(unionBox), left: set };
    });
  };
  const to = touched(oldUnmatched, so), tn = touched(newUnmatched, sn);
  const out = [];
  const usedNew = new Set();
  const CELL = 20, grid = new Map(), cellsOf = (bx) => {
    const out = [];
    for (let cx = Math.floor(bx.x0 / CELL); cx <= Math.floor(bx.x1 / CELL); cx++) for (let cy = Math.floor(bx.y0 / CELL); cy <= Math.floor(bx.y1 / CELL); cy++) out.push(cx * 1e6 + cy);
    return out;
  };
  for (const x of tn) for (const c of cellsOf(x.box)) (grid.get(c) || grid.set(c, []).get(c)).push(x);
  for (const a of to) {
    let b = null;
    for (const c of cellsOf(a.box)) { b = (grid.get(c) || []).find((x) => !usedNew.has(x) && intersects(a.box, x.box, 0.3)); if (b) break; }
    if (!b) { for (const w of wordsOfSpan(a.glyphs)) if (w.glyphs.some((g) => a.left.has(g))) out.push({ kind: "Removed", box: w.box, text: w.text, why: "gone" }); continue; }
    usedNew.add(b);
    const wo = wordsOfSpan(a.glyphs), wn = wordsOfSpan(b.glyphs);
    // LCS over word strings
    const L = Array.from({ length: wo.length + 1 }, () => new Int32Array(wn.length + 1));
    for (let i = wo.length - 1; i >= 0; i--) for (let j = wn.length - 1; j >= 0; j--)
      L[i][j] = wo[i].text === wn[j].text ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    const hunkO = [], hunkN = [];
    const flush = () => {
      for (let k = 0; k < Math.max(hunkO.length, hunkN.length); k++) {
        const o = hunkO[k], n = hunkN[k];
        if (o && n) {
          if (isShortened(o.text, n.text)) out.push({ kind: "Removed", box: o.box, text: o.text, why: "shortened" });
          else out.push({ kind: "Added", box: n.box, text: n.text, why: "replaced" });
        } else if (o) out.push({ kind: "Removed", box: o.box, text: o.text, why: "deleted" });
        else out.push({ kind: "Added", box: n.box, text: n.text, why: "inserted" });
      }
      hunkO.length = 0; hunkN.length = 0;
    };
    while (i < wo.length || j < wn.length) {
      if (i < wo.length && j < wn.length && wo[i].text === wn[j].text) { flush(); i++; j++; }
      else if (j >= wn.length || (i < wo.length && L[i + 1][j] >= L[i][j + 1])) hunkO.push(wo[i++]);
      else hunkN.push(wn[j++]);
    }
    flush();
  }
  for (const b of tn) if (!usedNew.has(b)) for (const w of wordsOfSpan(b.glyphs)) if (w.glyphs.some((g) => b.left.has(g))) out.push({ kind: "Added", box: w.box, text: w.text, why: "new" });
  return out;
}

/** Union-find merge of boxes that come within `gap` mm of each other. */
export function mergeBoxes(boxes, gap = 1) {
  const n = boxes.length, parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const CELL = 20, grid = new Map();
  boxes.forEach((b, i) => {
    for (let cx = Math.floor((b.x0 - gap) / CELL); cx <= Math.floor((b.x1 + gap) / CELL); cx++)
      for (let cy = Math.floor((b.y0 - gap) / CELL); cy <= Math.floor((b.y1 + gap) / CELL); cy++) {
        const k = cx * 1e6 + cy, list = grid.get(k);
        if (list) { for (const j of list) if (find(i) !== find(j) && intersects(b, boxes[j], gap)) parent[find(i)] = find(j); list.push(i); }
        else grid.set(k, [i]);
      }
  });
  const groups = new Map();
  boxes.forEach((b, i) => { const r = find(i); groups.set(r, groups.has(r) ? unionBox(groups.get(r), b) : { ...b }); });
  return [...groups.values()];
}

/**
 * Boxes of unmatched objects, merged. Changed glyphs widen to their whole word
 * (a run of non-space glyphs in the same span), or with textUnit "span" to the whole span.
 */
export function objectDifferences(unmatched, placedAll, { gap = 1, textUnit = "word" } = {}) {
  const spans = new Map();
  for (const o of placedAll) if (o.kind === "glyph") (spans.get(o.span) || spans.set(o.span, []).get(o.span)).push(o);
  for (const l of spans.values()) l.sort((a, b) => a.idx - b.idx);
  const boxes = [], doneWords = new Set();
  let glyphs = 0, words = 0;
  for (const o of unmatched) {
    if (o.kind !== "glyph") { boxes.push(o.bbox); continue; }
    glyphs++;
    const l = spans.get(o.span), i = l.indexOf(o);
    let a = i, b = i;
    if (textUnit === "span") { a = 0; b = l.length - 1; }
    while (a > 0 && l[a - 1].ch !== " ") a--;
    while (b < l.length - 1 && l[b + 1].ch !== " ") b++;
    const wk = `${o.span}:${a}`;
    if (doneWords.has(wk)) continue;
    doneWords.add(wk); words++;
    let box = l[a].bbox;
    for (let k = a + 1; k <= b; k++) box = unionBox(box, l[k].bbox);
    boxes.push(box);
  }
  return { boxes: mergeBoxes(boxes, gap), rawObjects: unmatched.length, glyphs, words };
}

/**
 * Group changed items into places to look at. Items join when they occupy the same or a
 * neighbouring cell (cell mm); strokes occupy the cells along their segments, everything
 * else its box. Places longer than maxLen mm along the Time direction are cut into tiles
 * (by item centre); a tile's `clipT` limits what the view shows.
 * items: [{ box, segs? (flat x0,y0,x1,y1,...) }] → [{ box, items, clipT? }]
 */
export function groupItems(items, { axis, cell = 5, maxLen = 300 }) {
  const t = tIdx(axis);
  const parent = Int32Array.from({ length: items.length }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  const rep = new Map(); // cell -> first item in it
  const key = (cx, cy) => cx * 1e7 + cy;
  const visit = (i, cx, cy) => { const k = key(cx, cy), r = rep.get(k); if (r === undefined) rep.set(k, i); else join(i, r); };
  items.forEach((it, i) => {
    if (it.segs) {
      const k = it.segs;
      for (let q = 0; q < k.length; q += 4) {
        const len = Math.hypot(k[q + 2] - k[q], k[q + 3] - k[q + 1]), n = Math.max(1, Math.ceil(len / (cell / 2)));
        for (let j = 0; j <= n; j++) visit(i, Math.floor((k[q] + (k[q + 2] - k[q]) * j / n) / cell), Math.floor((k[q + 1] + (k[q + 3] - k[q + 1]) * j / n) / cell));
      }
    } else {
      const b = it.box;
      for (let cx = Math.floor(b.x0 / cell); cx <= Math.floor(b.x1 / cell); cx++) for (let cy = Math.floor(b.y0 / cell); cy <= Math.floor(b.y1 / cell); cy++) visit(i, cx, cy);
    }
  });
  // neighbouring cells join too
  for (const [k, r] of rep) {
    const cx = Math.floor(k / 1e7), cy = k - cx * 1e7;
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) { const n = rep.get(key(cx + dx, cy + dy)); if (n !== undefined) join(r, n); }
  }
  const byRoot = new Map();
  items.forEach((it, i) => { const r = find(i); (byRoot.get(r) || byRoot.set(r, []).get(r)).push(it); });
  const out = [];
  for (const list of byRoot.values()) {
    const box = list.map((x) => x.box).reduce(unionBox);
    const lo = t ? box.y0 : box.x0, hi = t ? box.y1 : box.x1;
    if (hi - lo <= maxLen) { out.push({ box, items: list }); continue; }
    const tiles = new Map();
    for (const it of list) {
      const c = t ? (it.box.y0 + it.box.y1) / 2 : (it.box.x0 + it.box.x1) / 2, n = Math.floor((c - lo) / maxLen);
      (tiles.get(n) || tiles.set(n, []).get(n)).push(it);
    }
    for (const [n, l] of tiles) out.push({ box: l.map((x) => x.box).reduce(unionBox), items: l, clipT: [lo + n * maxLen, lo + (n + 1) * maxLen] });
  }
  return out.sort((a, b) => (t ? a.box.y0 - b.box.y0 : a.box.x0 - b.box.x0));
}

// ---------- raster ----------

/** Max-filter (square, radius r px) of a 0/1 mask. */
export function dilate(mask, w, h, r) {
  if (r <= 0) return mask;
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) if (mask[row + x]) {
      const a = Math.max(0, x - r), b = Math.min(w - 1, x + r);
      for (let k = a; k <= b; k++) tmp[row + k] = 1;
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (tmp[y * w + x]) {
    const a = Math.max(0, y - r), b = Math.min(h - 1, y + r);
    for (let k = a; k <= b; k++) out[k * w + x] = 1;
  }
  return out;
}

/** Ink masks (gray < ink) and tolerant diff: Removed = Old ink with no New ink within r px. */
export function rasterDiff(oldGray, newGray, w, h, r, ink = 245) {
  const mo = new Uint8Array(w * h), mn = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { mo[i] = oldGray[i] < ink ? 1 : 0; mn[i] = newGray[i] < ink ? 1 : 0; }
  const dO = dilate(mo, w, h, r), dN = dilate(mn, w, h, r);
  const rem = new Uint8Array(w * h), add = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { rem[i] = mo[i] && !dN[i]; add[i] = mn[i] && !dO[i]; }
  return { rem, add };
}

/**
 * Connected components on a cell grid of diff-pixel counts (gap: neighbours up to
 * `reach` cells away join). Returns boxes in cell units with their pixel count.
 */
export function cellComponents(counts, cw, ch, reach = 2, minPx = 4) {
  const seen = new Uint8Array(cw * ch), out = [], stack = [];
  for (let s = 0; s < cw * ch; s++) {
    if (!counts[s] || seen[s]) continue;
    seen[s] = 1; stack.push(s);
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, px = 0;
    while (stack.length) {
      const c = stack.pop(), cx = c % cw, cy = (c / cw) | 0;
      px += counts[c];
      if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
      for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const n = ny * cw + nx;
        if (counts[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
    if (px >= minPx) out.push({ x0, y0, x1: x1 + 1, y1: y1 + 1, px });
  }
  return out;
}

// ---------- scoring ----------

/**
 * detected: { Removed: boxes in Old coords, Added: boxes in New coords }.
 * gtChanges: ground-truth changes; offsetTrue maps New → Old frame for the false-alarm test.
 */
export function score(detected, gtChanges, { axis, offsetTrue }) {
  const t = tIdx(axis);
  const toFrame = (b, from, to) => {
    if (from === to) return b;
    const d = from === "new" ? offsetTrue : -offsetTrue;
    return t ? { ...b, y0: b.y0 + d, y1: b.y1 + d } : { ...b, x0: b.x0 + d, x1: b.x1 + d };
  };
  const rows = gtChanges.map((c) => ({
    id: c.id, what: c.what,
    parts: c.differences.map((d) => {
      const hits = (detected[d.kind] || []).filter((b) => intersects(b, d.boxMm, 0.5));
      if (!hits.length) return { kind: d.kind, found: false };
      const u = hits.reduce(unionBox);
      const iou = area(interBox(u, d.boxMm)) / area(unionBox(u, d.boxMm));
      return { kind: d.kind, found: true, iou, pieces: hits.length };
    }),
  }));
  const allGt = (frame) => gtChanges.flatMap((c) => c.differences.map((d) => toFrame(d.boxMm, d.plan, frame)));
  const falseAlarms = {
    Removed: detected.Removed.filter((b) => !allGt("old").some((g) => intersects(b, g, 1))),
    Added: detected.Added.filter((b) => !allGt("new").some((g) => intersects(b, g, 1))),
  };
  const parts = rows.flatMap((r) => r.parts);
  return { rows, falseAlarms, found: parts.filter((p) => p.found).length, total: parts.length };
}
