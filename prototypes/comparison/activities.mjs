// PROTOTYPE (throwaway) for the ticket "What is one Place on a real Plan, and how are its
// parts found?". One Place = one Activity: its shape, its leader and its label.
//
// Found on a real pair: the Plan software draws each Activity in one go (white underlay,
// hatch, outline, centre line, symbols, label background, label, leader), and neighbouring
// Activities touch corner to corner. Nearness alone therefore chains whole sequences into one
// Place; the drawing order separates them.
//
//   activitiesOf(plan)   Activities of one Plan from its drawing order (cached on the plan):
//                        one starts at a hatched shape (a white underlay followed by a hatch
//                        of the same box) and takes the following objects of its colour (or
//                        white) that touch it, chained, until the next start; a text block of
//                        that run within LABEL mm joins too (labels without a leader).
//   groupByActivity(…)   Differences → Places: one per Activity, Old and New Activity joined
//                        when matched objects link them; Differences outside any Activity are
//                        grouped by colour and touching (a line Activity without hatch, a note).
import { bboxOf } from "../detection/detect.mjs";

export const TOL = 0.6, LABEL = 5;
const W = "1.000,1.000,1.000";
const box = (o) => o._b || (o._b = o.box || bboxOf(o.polys.flatMap((p) => p.pts)));
export const colourOf = (o) => (o.kind === "hatch" ? (o.style.match(/[sf](\d\.\d{3},\d\.\d{3},\d\.\d{3})/) || [])[1] || "?" : o.style.split("|")[o.kind === "glyph" ? 3 : 1]);
const sameBox = (a, b, t = 0.3) => Math.abs(a.x0 - b.x0) < t && Math.abs(a.y0 - b.y0) < t && Math.abs(a.x1 - b.x1) < t && Math.abs(a.y1 - b.y1) < t;
const NB = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function uf(n) {
  const p = Int32Array.from({ length: n }, (_, i) => i);
  const f = (i) => { while (p[i] !== i) i = p[i] = p[p[i]]; return i; };
  return { f, j: (a, b) => { a = f(a); b = f(b); if (a !== b) p[a] = b; } };
}

/** Line pieces of an object: strokes, and the outline of a large area (a long thin shape's box would touch everything); small areas and glyphs use their box. */
function segsOf(o) {
  if (o.kind === "glyph") return null;
  if (o.kind !== "stroke") { const b = box(o); if (b.x1 - b.x0 < 20 && b.y1 - b.y0 < 20) return null; }
  const s = [];
  for (const p of o.polys) {
    const k = p.pts, n = k.length / 2, m = p.closed || o.kind !== "stroke" ? n : n - 1;
    for (let i = 0; i < m; i++) { const j = (i + 1) % n; s.push(k[2 * i], k[2 * i + 1], k[2 * j], k[2 * j + 1]); }
  }
  return s;
}
/** Grid cells (c mm) an object occupies, as numbers (x + OFF) · 1e6 + (y + OFF). */
const OFF = 10000;
function cellsOf(o, c, segs = segsOf(o)) {
  const out = new Set(), key = (x, y) => (Math.floor(x / c) + OFF) * 1e6 + Math.floor(y / c) + OFF;
  if (segs) {
    for (let q = 0; q + 3 < segs.length; q += 4) {
      const n = Math.max(1, Math.ceil(Math.hypot(segs[q + 2] - segs[q], segs[q + 3] - segs[q + 1]) / (c / 2)));
      for (let j = 0; j <= n; j++) out.add(key(segs[q] + (segs[q + 2] - segs[q]) * j / n, segs[q + 1] + (segs[q + 3] - segs[q + 1]) * j / n));
    }
  } else {
    const b = box(o);
    for (let x = Math.floor(b.x0 / c); x <= Math.floor(b.x1 / c); x++) for (let y = Math.floor(b.y0 / c); y <= Math.floor(b.y1 / c); y++) out.add((x + OFF) * 1e6 + y + OFF);
  }
  return out;
}
/** Union of everything whose cells meet or neighbour. cellsFor(i) → cells; layer(i): only the same layer touches (a small number, e.g. a colour). */
function touchUnion(n, cellsFor, u, layer = () => 0) {
  const cells = new Map(), L = 1e10;
  for (let i = 0; i < n; i++) { const p = layer(i) * L; for (const c of cellsFor(i)) { const key = p + c, r = cells.get(key); if (r === undefined) cells.set(key, i); else u.j(i, r); } }
  for (const [key, r] of cells) {
    const p = Math.floor(key / L) * L, c = key - p, x = Math.floor(c / 1e6), y = c - x * 1e6;
    for (const [dx, dy] of NB) { const q = cells.get(p + (x + dx) * 1e6 + y + dy); if (q !== undefined) u.j(r, q); }
  }
}

/** Activities of one Plan, from its drawing order. Cached on the plan. Every object gets o.seq (its drawing order). */
export function activitiesOf(plan) {
  if (plan.acts) return plan.acts;
  const t0 = performance.now(), objs = plan.objs;
  objs.forEach((o, i) => { o.seq = i; });
  const act = new Int32Array(objs.length).fill(-1), acts = [];
  const isStart = (i) => {
    const o = objs[i];
    if (o.kind !== "fill" || colourOf(o) !== W) return false;
    for (let j = i + 1; j <= i + 3 && j < objs.length; j++) if (objs[j].kind === "hatch" && sameBox(box(objs[j]), box(o))) return true;
    return false;
  };
  const starts = [];
  for (let i = 0; i < objs.length; i++) if (isStart(i)) starts.push(i);
  starts.forEach((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : objs.length;
    let ac = null; // the Activity's colour: its first coloured outline
    for (let j = s + 1; j < Math.min(end, s + 6) && !ac; j++) if (objs[j].kind === "stroke" && colourOf(objs[j]) !== W) ac = colourOf(objs[j]);
    const cand = [];
    for (let j = s; j < end && j < s + 2000; j++) { const c = colourOf(objs[j]); if (c === W || c === ac || objs[j].kind === "hatch") cand.push(j); }
    const u = uf(cand.length);
    touchUnion(cand.length, (i) => cellsOf(objs[cand[i]], TOL), u);
    const root = u.f(0), keep = new Set([root]);
    // a text block of the run near the Activity joins it (a label set beside its shape)
    const G = LABEL / 2, near = new Set(), comps = new Map();
    cand.forEach((j, i) => { const r = u.f(i); if (r === root) for (const c of cellsOf(objs[j], G)) near.add(c); else (comps.get(r) || comps.set(r, []).get(r)).push(j); });
    for (const [r, list] of comps) {
      if (!list.some((j) => objs[j].kind === "glyph" && colourOf(objs[j]) === ac)) continue;
      let hit = false;
      for (const j of list) {
        for (const c of cellsOf(objs[j], G)) {
          const x = Math.floor(c / 1e6), y = c - x * 1e6;
          for (let dx = -2; dx <= 2 && !hit; dx++) for (let dy = -2; dy <= 2 && !hit; dy++) hit = near.has((x + dx) * 1e6 + y + dy);
          if (hit) break;
        }
        if (hit) break;
      }
      if (hit) keep.add(r);
    }
    const a = { id: acts.length, start: s, seqs: [], colour: ac };
    cand.forEach((j, i) => { if (keep.has(u.f(i))) { act[j] = a.id; a.seqs.push(j); } });
    acts.push(a);
  });
  plan.acts = { act, acts, ms: Math.round(performance.now() - t0) };
  return plan.acts;
}

const seqOf = (it) => (it.o ? it.o.seq : it.text?.glyphs?.[0]?.seq);
const unionBox = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

/**
 * Places from Differences: one per Activity (Old and New joined through matched objects),
 * the rest by colour and touching. pairs: [[oldPlaced, newPlaced]] from the matching.
 * → [{ box, items, acts: ["old:3", "new:7"], loose? }]
 */
export function groupByActivity(items, pairs, O, N) {
  const A = { old: activitiesOf(O), new: activitiesOf(N) };
  // Old ↔ New: the New Activity most of an Old Activity's matched objects lie in
  const votes = new Map();
  for (const [a, b] of pairs) {
    const ao = A.old.act[a.seq], bn = A.new.act[b.seq];
    if (ao < 0 || bn < 0) continue;
    const m = votes.get(ao) || votes.set(ao, new Map()).get(ao);
    m.set(bn, (m.get(bn) || 0) + 1);
  }
  const twin = new Map();
  for (const [ao, m] of votes) { let best = -1, bv = 0; for (const [bn, v] of m) if (v > bv) { bv = v; best = bn; } twin.set(ao, best); }
  const byKey = new Map(), loose = [];
  for (const it of items) {
    const s = seqOf(it), a = s === undefined ? -1 : A[it.src].act[s];
    if (a < 0) { loose.push(it); continue; }
    const k = `${it.src}:${a}`;
    (byKey.get(k) || byKey.set(k, []).get(k)).push(it);
  }
  const keys = [...byKey.keys()], idx = new Map(keys.map((k, i) => [k, i])), u = uf(keys.length);
  for (const [ao, bn] of twin) { const a = idx.get(`old:${ao}`), b = idx.get(`new:${bn}`); if (a !== undefined && b !== undefined) u.j(a, b); }
  const groups = new Map();
  keys.forEach((k, i) => { const r = u.f(i), g = groups.get(r) || groups.set(r, { items: [], acts: [] }).get(r); g.items.push(...byKey.get(k)); g.acts.push(k); });
  const out = [...groups.values(), ...looseGroups(loose)];
  const kept = attachMarks(out);
  for (const g of kept) g.box = g.items.map((x) => x.box).reduce(unionBox);
  return kept;
}

/** Grid cells (c mm) of a Difference: its line pieces, a large area's box edges, else its box. */
function itemCells(it, c) {
  const b = it.box, big = b.x1 - b.x0 > 20 || b.y1 - b.y0 > 20;
  const segs = it.segs || (big ? [b.x0, b.y0, b.x1, b.y0, b.x1, b.y0, b.x1, b.y1, b.x1, b.y1, b.x0, b.y1, b.x0, b.y1, b.x0, b.y0] : null);
  return segs ? cellsOf(null, c, segs) : cellsOf({ kind: "glyph", box: b }, c);
}

/**
 * Round 3 (user: "yes"): km markers and dimensions ("km 12,4 + 70", "100 m"), drawn in black
 * in a separate pass, belong to the Activity they mark. A loose black group with text joins the
 * Activity Place of the same Plan whose Differences lie within MARK mm (the one it touches most).
 */
const BLACK = "0.000,0.000,0.000", MARK = 3;
function attachMarks(groups) {
  const acts = groups.filter((g) => !g.loose), C = MARK / 2, side = (it) => (it.src === "old" ? 0 : 1e11), grid = new Map();
  acts.forEach((g, gi) => { for (const it of g.items) for (const c of itemCells(it, C)) { const k = side(it) + c; (grid.get(k) || grid.set(k, new Set()).get(k)).add(gi); } });
  const out = [];
  for (const g of groups) {
    const mark = g.loose && g.items.some((it) => it.text) && g.items.every((it) => colourOf(it.o || it.text.glyphs[0]) === BLACK);
    if (!mark) { out.push(g); continue; }
    const votes = new Map();
    for (const it of g.items) for (const c of itemCells(it, C)) {
      const x = Math.floor(c / 1e6), y = c - x * 1e6;
      for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) { const s = grid.get(side(it) + (x + dx) * 1e6 + y + dy); if (s) for (const gi of s) votes.set(gi, (votes.get(gi) || 0) + 1); }
    }
    if (!votes.size) { out.push(g); continue; }
    const best = acts[[...votes].reduce((a, b) => (b[1] > a[1] ? b : a))[0]];
    best.items.push(...g.items); best.marks = (best.marks || 0) + 1;
  }
  return out;
}

/** Differences outside any Activity: one Plan, one colour, touching (1 mm cells). */
function looseGroups(items) {
  const u = uf(items.length), layers = new Map(), layerOf = (it) => { const k = it.src + colourOf(it.o || it.text.glyphs[0]); if (!layers.has(k)) layers.set(k, layers.size); return layers.get(k); };
  touchUnion(items.length, (i) => itemCells(items[i], 1), u, (i) => layerOf(items[i]));
  const by = new Map();
  items.forEach((it, i) => { const r = u.f(i); (by.get(r) || by.set(r, []).get(r)).push(it); });
  return [...by.values()].map((l) => ({ items: l, acts: [], loose: true }));
}

/**
 * An Activity's name and shape: its longest text block (lines of its glyphs that touch each
 * other: a label over several lines), and its hatched shape (underlay and hatch).
 * → { name, shapeObjs }  (page mm of that Plan)
 */
export function labelOf(plan, id) {
  const a = activitiesOf(plan).acts[id];
  if (!a) return null;
  if (a.label !== undefined) return a.label;
  const spans = new Map(), shapeObjs = [plan.objs[a.start]]; // the hatched shape (its extent), not its link lines
  for (let j = a.start + 1; j <= a.start + 3; j++) if (plan.objs[j].kind === "hatch") { shapeObjs.push(plan.objs[j]); break; }
  for (const j of a.seqs) {
    const o = plan.objs[j];
    if (o.kind !== "glyph") continue;
    const s = spans.get(o.span) || spans.set(o.span, { text: "", box: { ...o.box } }).get(o.span);
    s.text += o.ch; s.box = unionBox(s.box, o.box);
  }
  // text lines into blocks: lines that overlap across and touch along (≤ 1 mm apart)
  const lines = [...spans.values()].filter((s) => s.text.trim()).sort((p, q) => p.box.y0 - q.box.y0 || p.box.x0 - q.box.x0);
  const blocks = [];
  for (const l of lines) {
    const b = blocks.find((k) => { const t = k.at(-1).box; return l.box.x0 < t.x1 && l.box.x1 > t.x0 && l.box.y0 - t.y1 < 1 && l.box.y0 >= t.y0; });
    if (b) b.push(l); else blocks.push([l]);
  }
  const best = blocks.map((k) => k.map((l) => l.text.trim()).join(" ")).reduce((x, y) => (y.length > x.length ? y : x), "");
  a.label = { name: best || null, shapeObjs };
  return a.label;
}
