// PROTOTYPE (throwaway): state, actions and drawing helpers shared by the three variants.
// The state survives a variant switch, so the same setup can be looked at three ways.
import * as E from "./engine.mjs";
import { grayToImage } from "./viewer.mjs";

export const S = {
  axis: "y",            // "y": time runs down, "x": to the right
  plans: null,          // { old, new } from engine.loadPlan
  pairName: "",
  body: { old: null, new: null }, // [Header ends, Footer starts] in each Plan's page mm along time
  bodyFrom: "",         // "guess" | "remembered" | "hand"
  ignores: [],          // { id, plan: "old"|"new"|"both", kind: "band"|"box", rect } ("both": Old page mm)
  cands: [],            // Offset candidates, best first
  offset: 0,            // oldPos = newPos + offset
  offsetFrom: "auto",   // "auto" | "picked" | "hand"
  result: null,         // quick compare
  snapHint: null,       // { plan, t } while a line sits on a snap target
  temp: null,           // area being drawn
  busy: "",
};

const subs = new Set();
export const on = (f) => (subs.add(f), () => subs.delete(f));
export function emit(what) { for (const f of [...subs]) f(what); }

export const T = () => E.T(S.axis);
export const tOf = (p) => (S.axis === "y" ? p.y : p.x);
export const aOf = (p) => (S.axis === "y" ? p.x : p.y);
export const L = (which) => E.lenOf(S.plans[which], S.axis);
export const A = (which) => E.acrossOf(S.plans[which], S.axis);
/** Frame shift of a Plan when both are shown in the Old Plan's frame. */
export const shiftOf = (which) => (which === "new" ? S.offset : 0);
export const fmt = (v, d = 1) => v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
export const rectTA = (t0, t1, a0, a1) => (S.axis === "y" ? { x0: Math.min(a0, a1), x1: Math.max(a0, a1), y0: Math.min(t0, t1), y1: Math.max(t0, t1) } : { x0: Math.min(t0, t1), x1: Math.max(t0, t1), y0: Math.min(a0, a1), y1: Math.max(a0, a1) });
export const frameRect = (which) => { const sh = shiftOf(which); return rectTA(sh, sh + L(which), 0, A(which)); };

// ---------- setting up a pair ----------

export function setPair(plans, name) {
  S.plans = plans; S.pairName = name;
  const tall = plans.old.pageMm[1] > plans.old.pageMm[0];
  S.axis = tall ? "y" : "x";
  S.ignores = []; S.offset = 0; S.offsetFrom = "auto"; S.result = null; S.cands = [];
  initBodies();
  emit("pair");
  recalc(true);
}

export function setAxis(axis) {
  if (axis === S.axis) return;
  S.axis = axis;
  S.ignores = []; S.offsetFrom = "auto";
  initBodies();
  emit("pair");
  recalc(true);
}

function initBodies() {
  const r = E.recall();
  if (r && r.axis === S.axis) {
    for (const w of ["old", "new"]) S.body[w] = [r.head, L(w) - r.footFromEnd];
    S.ignores = (r.ignores || []).map((ig, i) => ({ ...ig, id: Date.now() + i, rect: ig.kind === "band" ? bandRect(ig.a0, ig.a1) : rectTA(r.head + ig.t0, r.head + ig.t1, ig.a0, ig.a1), remembered: true }));
    S.bodyFrom = "remembered";
  } else {
    for (const w of ["old", "new"]) S.body[w] = E.guessBody(S.plans[w], S.axis);
    S.bodyFrom = "guess";
  }
}

export function saveSetup() {
  const o = S.body.old;
  E.remember({
    axis: S.axis, head: o[0], footFromEnd: L("old") - o[1],
    ignores: S.ignores.filter((ig) => ig.plan !== "new").map((ig) => {
      const r = ig.rect, t = S.axis === "y" ? [r.y0, r.y1] : [r.x0, r.x1], a = S.axis === "y" ? [r.x0, r.x1] : [r.y0, r.y1];
      return { plan: ig.plan, kind: ig.kind, a0: a[0], a1: a[1], t0: t[0] - o[0], t1: t[1] - o[0] };
    }),
  });
}

// ---------- actions ----------

export function setLine(which, idx, v) {
  S.body[which][idx] = Math.max(0, Math.min(L(which), v));
  if (S.body[which][0] > S.body[which][1]) S.body[which].reverse();
  S.bodyFrom = "hand";
  emit("body");
  recalc(true);
}
/** The same Header (mm from start) and Footer (mm before end) in the New Plan as in the Old Plan. */
export function copyLinesToNew() {
  S.body.new = [S.body.old[0], L("new") - (L("old") - S.body.old[1])];
  emit("body");
  recalc(true);
}

export function setOffset(v, from) {
  S.offset = Math.round(v * 100) / 100;
  S.offsetFrom = from;
  emit("offset");
  recalc(false);
}

export const bandRect = (a0, a1) => rectTA(-1e5, 1e5, a0, a1);

export function addIgnore(ig) { S.ignores.push({ id: Date.now() + Math.random(), ...ig }); emit("ignores"); recalc(true); }
export function removeIgnore(id) { S.ignores = S.ignores.filter((x) => x.id !== id); emit("ignores"); recalc(true); }

/** Ignored areas per Plan in that Plan's own page mm ("both" boxes move with the Offset). */
export function ignoresFor(which) {
  const out = [];
  for (const ig of S.ignores) {
    if (ig.plan !== "both" && ig.plan !== which) continue;
    let r = ig.rect;
    if (ig.plan === "both" && which === "new" && ig.kind === "box") r = S.axis === "y" ? { ...r, y0: r.y0 - S.offset, y1: r.y1 - S.offset } : { ...r, x0: r.x0 - S.offset, x1: r.x1 - S.offset };
    out.push({ ...ig, plan: which, rect: r });
  }
  return out;
}

let tCands = 0, tCmp = 0, staleCands = true;
/**
 * Live work (Offset search, quick compare) only runs while S.live is on. Variant A turns it
 * on from the Offset step; while setting up the zones it would only make dragging lag.
 * Changes made meanwhile are kept as "stale" and computed when it is turned on again.
 */
S.live = true;
export function setLive(on) {
  S.live = on;
  if (!on) { clearTimeout(tCands); clearTimeout(tCmp); if (S.busy) { S.busy = ""; emit("busy"); } }
  else recalc(staleCands);
}

/** Recompute Offset candidates (if the Bodies or areas changed) and the quick compare. */
export function recalc(cands) {
  if (S.plans && S.body.old) saveSetup();
  clearTimeout(tCands); clearTimeout(tCmp);
  if (cands) staleCands = true;
  if (!S.live) return;
  cands = cands || staleCands;
  const ig = () => [...ignoresFor("old"), ...ignoresFor("new")];
  const compare = () => {
    tCmp = setTimeout(() => {
      S.busy = "vergleiche…"; emit("busy");
      setTimeout(() => {
        S.result = E.quickCompare(S.plans.old, S.plans.new, S.axis, S.body.old, S.body.new, S.offset, ig());
        S.busy = ""; emit("result");
      }, 10);
    }, 250);
  };
  if (!cands) { compare(); return; }
  tCands = setTimeout(() => {
    S.busy = "suche Versatz…"; emit("busy");
    setTimeout(() => {
      const r = E.offsetCandidates(S.plans.old, S.plans.new, S.axis, S.body.old, S.body.new, ig());
      S.cands = r.candidates; S.candMs = r.ms; staleCands = false;
      if (S.offsetFrom === "auto" && S.cands.length) S.offset = Math.round(S.cands[0].offset * 100) / 100;
      S.busy = ""; emit("cands"); emit("offset");
      compare();
    }, 10);
  }, 200);
}

// ---------- rendering ----------

/** Memoised gray render of one Plan for a view (so blinking or redrawing marks is cheap). */
export function layerCache() {
  const memo = new Map();
  return (which, view, w, h, shift) => {
    const key = [S.axis, view.x0.toFixed(3), view.y0.toFixed(3), view.s.toFixed(5), w, h, shift].join("|");
    const m = memo.get(which);
    if (m && m.key === key) return m.g;
    const g = E.renderGray(S.plans[which], S.axis, view, w, h, shift);
    memo.set(which, { key, g });
    return g;
  };
}
export const single = (cache, which) => (view, w, h) => S.plans && grayToImage(cache(which, view, w, h, 0), w, h);

// ---------- overlay drawing (ctx in mm; sizes given in css px are divided by V.s) ----------

export const COLORS = { line: "#1d5fd6", lineNew: "#c0267a", snap: "#e8a100", veil: "rgba(40,40,48,.28)", ignore: "rgba(120,120,128,.35)", old: "#1d74c9", new: "#d0215f" };

export function lineAcross(ctx, V, t, a0, a1, { color = COLORS.line, px = 2, dash = null } = {}) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = px / V.s;
  if (dash) ctx.setLineDash(dash.map((d) => d / V.s));
  ctx.beginPath();
  if (S.axis === "y") { ctx.moveTo(a0, t); ctx.lineTo(a1, t); } else { ctx.moveTo(t, a0); ctx.lineTo(t, a1); }
  ctx.stroke();
  ctx.restore();
}
export function fillRect(ctx, r, style) { ctx.fillStyle = style; ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0); }
export function strokeRect(ctx, V, r, color, px = 1.5, dash = null) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = px / V.s;
  if (dash) ctx.setLineDash(dash.map((d) => d / V.s));
  ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0); ctx.restore();
}
/** A label in screen px at an mm point. */
export function tag(ctx, V, x, y, text, { bg = COLORS.line, color = "#fff", dx = 0, dy = 0, align = "left", base = "middle", size = 12 } = {}) {
  ctx.save();
  const d = devicePixelRatio;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.font = `600 ${size}px system-ui, "Segoe UI", sans-serif`;
  const w = ctx.measureText(text).width + 10, h = size + 8;
  let px = (x - V.x0) * V.s + dx, py = (y - V.y0) * V.s + dy;
  px = Math.max(2, Math.min(V.w - w - 2, align === "right" ? px - w : align === "center" ? px - w / 2 : px));
  py = Math.max(h / 2 + 2, Math.min(V.h - h / 2 - 2, base === "top" ? py + h / 2 : base === "bottom" ? py - h / 2 : py));
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(px, py - h / 2, w, h, 4); ctx.fill();
  ctx.fillStyle = color; ctx.textBaseline = "middle";
  ctx.fillText(text, px + 5, py + 0.5);
  ctx.restore();
  return { px, py, w, h };
}

/** Grey veil over a Plan's Header and Footer (shifted into the frame), plus its two lines. */
export function drawBody(ctx, V, which, { color = COLORS.line, labels = true, veil = true, suffix = "", shift = shiftOf(which) } = {}) {
  const sh = shift, [h, f] = S.body[which], len = L(which), a = A(which);
  if (veil) { fillRect(ctx, rectTA(sh, sh + h, 0, a), COLORS.veil); fillRect(ctx, rectTA(sh + f, sh + len, 0, a), COLORS.veil); }
  for (const [i, t] of [[0, h], [1, f]]) {
    const snapped = S.snapHint && S.snapHint.plan === which && S.snapHint.idx === i;
    lineAcross(ctx, V, sh + t, -0.02 * a, 1.02 * a, { color: snapped ? COLORS.snap : color, px: snapped ? 3 : 2 });
    const onScreen = ((sh + t) - (S.axis === "y" ? V.y0 : V.x0)) * V.s, extent = S.axis === "y" ? V.h : V.w;
    if (labels && onScreen >= 0 && onScreen <= extent) {
      const txt = (i ? "Fuß beginnt" : "Kopf endet") + suffix + " · " + fmt(t) + " mm";
      if (S.axis === "y") tag(ctx, V, 0, sh + t, txt, { bg: snapped ? COLORS.snap : color, dx: 6, dy: i ? 4 : -4, base: i ? "top" : "bottom" });
      else tag(ctx, V, sh + t, 0, txt, { bg: snapped ? COLORS.snap : color, dx: i ? 4 : -4, dy: 6, align: i ? "left" : "right", base: "top" });
    }
  }
}

/** Ignored areas of one Plan, hatched, in the frame. */
export function drawIgnores(ctx, V, which, { shift = shiftOf(which) } = {}) {
  const sh = shift, len = L(which), a = A(which);
  for (const ig of ignoresFor(which)) {
    let r = ig.rect;
    if (ig.kind === "band") r = S.axis === "y" ? { ...r, y0: 0, y1: len } : { ...r, x0: 0, x1: len };
    r = S.axis === "y" ? { ...r, y0: r.y0 + sh, y1: r.y1 + sh } : { ...r, x0: r.x0 + sh, x1: r.x1 + sh };
    fillRect(ctx, r, COLORS.ignore);
    strokeRect(ctx, V, r, "#555", 1.2, [5, 4]);
  }
  if (S.temp && (S.temp.view === undefined || S.temp.view === which)) { fillRect(ctx, S.temp.rect, "rgba(232,161,0,.25)"); strokeRect(ctx, V, S.temp.rect, COLORS.snap, 1.5, [5, 4]); }
  void a;
}

/** Drag handler for a Header (0) / Footer (1) line of `which`, shown with `shift` in the view. */
export function lineDrag(which, idx, shift = shiftOf(which)) {
  const targets = E.snapTargets(S.plans[which], S.axis, 0.5);
  return {
    move(pt, e, V) {
      const raw = tOf(pt) - shift, tol = 10 / (V ? V.s : 1);
      const v = e.altKey ? raw : E.snap(targets, raw, tol);
      S.snapHint = v !== raw ? { plan: which, idx } : null;
      S.body[which][idx] = Math.max(0, Math.min(L(which), Math.round(v * 100) / 100));
      emit("drag");
    },
    up() { S.snapHint = null; setLine(which, idx, S.body[which][idx]); },
  };
}
/** Which line of `which` is within 7 px of the pointer (or -1). */
export function hitLine(which, pt, V, shift = shiftOf(which)) {
  const t = tOf(pt);
  for (const i of [0, 1]) if (Math.abs(S.body[which][i] + shift - t) * V.s < 7) return i;
  return -1;
}

/**
 * Drag handler that draws an Ignored area. kind "band": over the whole length (only the
 * across extent counts); "box": a rectangle. `plan` is "old" | "new" | "both"; the pointer is
 * in a view where `view` is shown with `shift` (frame t = page t + shift).
 */
export function areaDrag(start, kind, plan, view, shift = 0) {
  const mk = (pt) => {
    const t0 = tOf(start), t1 = tOf(pt), a0 = aOf(start), a1 = aOf(pt);
    return kind === "band" ? rectTA(shift, shift + L(view), a0, a1) : rectTA(t0, t1, a0, a1);
  };
  S.temp = { rect: mk(start), view };
  return {
    move(pt) { S.temp.rect = mk(pt); emit("drag"); },
    up(pt) {
      const r = mk(pt); S.temp = null;
      const big = S.axis === "y" ? r.x1 - r.x0 : r.y1 - r.y0;
      if (big < 0.5) { emit("drag"); return; }
      // Into page mm of the Plan it was drawn on, then into the Old frame for "both".
      const toPage = (rr, d) => (S.axis === "y" ? { ...rr, y0: rr.y0 - d, y1: rr.y1 - d } : { ...rr, x0: rr.x0 - d, x1: rr.x1 - d });
      let rect = kind === "band" ? bandRect(aOf({ x: r.x0, y: r.y0 }), aOf({ x: r.x1, y: r.y1 })) : toPage(r, shift);
      let p = plan;
      if (plan === "both" && view === "new" && kind === "box") rect = toPage(rect, -S.offset);
      if (plan === "both" && kind === "band") p = "both";
      addIgnore({ plan: p, kind, rect });
    },
  };
}

export function describeIgnore(ig) {
  const r = ig.rect, a = S.axis === "y" ? [r.x0, r.x1] : [r.y0, r.y1], t = S.axis === "y" ? [r.y0, r.y1] : [r.x0, r.x1];
  const who = ig.plan === "both" ? "beide Pläne" : ig.plan === "old" ? "nur alter Plan" : "nur neuer Plan";
  return ig.kind === "band"
    ? `Streifen ${fmt(a[0], 0)}–${fmt(a[1], 0)} mm quer · ${who}`
    : `Kasten bei ${fmt(t[0], 0)} mm · ${fmt(a[1] - a[0], 0)} × ${fmt(t[1] - t[0], 0)} mm · ${who}`;
}

/** Ignored areas as a list with × buttons. */
export function ignoreList(el) {
  const draw = () => {
    el.replaceChildren(...(S.ignores.length ? S.ignores.map((ig) => {
      const li = document.createElement("div");
      li.className = "ig";
      li.innerHTML = `<span>${describeIgnore(ig)}${ig.remembered ? ' <span class="muted">(gemerkt)</span>' : ""}</span>`;
      const x = document.createElement("button");
      x.className = "x"; x.title = "Nicht mehr ignorieren"; x.textContent = "×";
      x.onclick = () => removeIgnore(ig.id);
      li.append(x);
      return li;
    }) : [Object.assign(document.createElement("div"), { className: "muted", textContent: "Keine ignorierten Bereiche." })]));
  };
  draw();
  return on((w) => { if (w === "ignores" || w === "pair") draw(); });
}

/** Little element helper. */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k.startsWith("on")) el[k] = v; else if (k === "class") el.className = v; else if (k === "html") el.innerHTML = v; else if (k === "style") el.style.cssText = v; else el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
  return el;
}

export function offsetText() {
  const from = { auto: "erkannt", picked: "gewählt", hand: "von Hand" }[S.offsetFrom];
  return `${fmt(S.offset, 2)} mm (${from})`;
}

/** Arrow keys nudge the Offset: 0.1 mm, Shift 1 mm, Ctrl 10 mm. */
export function nudgeKeys(e) {
  if (e.target.closest("input, textarea, select")) return false;
  const down = S.axis === "y" ? ["ArrowDown", "ArrowUp"] : ["ArrowRight", "ArrowLeft"];
  const i = down.indexOf(e.key);
  if (i < 0) return false;
  e.preventDefault();
  const step = e.ctrlKey ? 10 : e.shiftKey ? 1 : 0.1;
  setOffset(S.offset + (i === 0 ? step : -step), "hand");
  return true;
}
