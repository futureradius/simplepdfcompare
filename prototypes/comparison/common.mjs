// PROTOTYPE (throwaway) for the ticket "What does the comparison view look like?".
// Shared by the three comparison-view variants: display settings, the painter that draws
// Differences into a rendered view, the overlay (Overhang, Header/Footer, the selected place,
// rings for small places), place descriptions, the keyboard, and a map viewer wired to all that.
//
// Frame: every view is in the Old Plan's page mm; the New Plan sits at +Offset along time.
import { createViewer } from "../alignment/viewer.mjs";
import { S, on, emit, h, L, A, fmt, rectTA, layerCache, COLORS } from "../alignment/shared.mjs";

export { S, on, emit, h, L, A, fmt, rectTA };

// ---------- display settings (shared by all variants, kept per browser) ----------

const KEY = "compareview.settings";
const DEFAULTS = { base: "new", marks: true, outline: 6, removed: "halo", fade: 35, rings: true };
export const CV = (() => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { ...DEFAULTS }; } })();
export function setCV(patch) {
  Object.assign(CV, patch);
  try { localStorage.setItem(KEY, JSON.stringify(CV)); } catch {}
  emit("cv");
}
export const resetCV = () => setCV({ ...DEFAULTS });

export const RED = "#dc2a1e", YELLOW = "#f0be00", YELLOW_INK = "#b88a00", GREY = "#4a4a4a";
const COL = { grey: [74, 74, 74], yellow: [240, 190, 0], red: [220, 42, 30] };

/** The selected place and the peek (Shift held: the other Plan as it is, without marks). */
export const CS = { sel: 0, peek: false };

export const groups = () => (S.result ? S.result.groups : []);
export const tAx = () => (S.axis === "y" ? 1 : 0);
export const tLo = (b) => (S.axis === "y" ? b.y0 : b.x0);
export const tHi = (b) => (S.axis === "y" ? b.y1 : b.x1);

/** A place's box, cut to its tile if a long place was split. */
export function placeBox(g) {
  const b = { ...g.box };
  if (g.clipT) { const [a, z] = g.clipT; if (S.axis === "y") { b.y0 = Math.max(b.y0, a); b.y1 = Math.min(b.y1, z); } else { b.x0 = Math.max(b.x0, a); b.x1 = Math.min(b.x1, z); } }
  return b;
}

// ---------- German wording ----------

const NOUN = { stroke: ["Linie", "Linien"], fill: ["Fläche", "Flächen"], hatch: ["Schraffur", "Schraffuren"], word: ["Wort", "Wörter"] };
const count = (n, kind) => `${n} ${NOUN[kind] ? NOUN[kind][n === 1 ? 0 : 1] : kind}`;
export function tally(g) {
  const t = { old: {}, new: {}, recol: 0 };
  for (const it of g.items) { if (it.recol) { t.recol++; continue; } const k = it.kind in NOUN ? it.kind : "fill"; t[it.src][k] = (t[it.src][k] || 0) + 1; }
  return t;
}
/** "neu: 2 Linien · weg: 1 Wort · umgefärbt: 1" */
export function describe(g) {
  const t = tally(g), part = (o) => Object.entries(o).map(([k, n]) => count(n, k)).join(", ");
  return [Object.keys(t.new).length && `neu: ${part(t.new)}`, Object.keys(t.old).length && `weg: ${part(t.old)}`, t.recol && `umgefärbt: ${t.recol}`].filter(Boolean).join(" · ");
}
export function kindOf(g) {
  const o = g.items.some((i) => i.src === "old"), n = g.items.some((i) => i.src === "new");
  return o && n ? "both" : o ? "old" : "new";
}
export const placeLabel = (g) => ({ both: "geändert", old: "weggefallen", new: "dazugekommen" })[kindOf(g)];
/** Where a place is, along the time axis of the Old Plan, in metres of Plan. */
export const where = (g) => `bei ${fmt(tLo(placeBox(g)) / 1000, 2)} m`;
export function dot(g, size = 10) {
  const k = kindOf(g);
  const bg = k === "both" ? `linear-gradient(90deg, ${YELLOW} 50%, ${RED} 50%)` : k === "old" ? YELLOW : RED;
  return h("span", { style: `display:inline-block;flex:none;width:${size}px;height:${size}px;border-radius:50%;background:${bg};box-shadow:0 0 0 1px rgba(0,0,0,.15)` });
}
export function totals() {
  const gs = groups(), c = { new: 0, old: 0, both: 0 };
  for (const g of gs) c[kindOf(g)]++;
  return c;
}

// ---------- painting a view: base picture plus marks ----------

/**
 * One rendered view. view = { x0, y0, s } with s in device px per mm, frame = Old page mm.
 * gO / gN: gray renders of the Old Plan (shift 0) and the New Plan (shift Offset).
 * only: "old" | "new" | null (C: each side shows only its own Plan and marks).
 */
export function paintCompare({ view, w, h: hh, gO, gN, only = null }) {
  const R = S.result, d = devicePixelRatio;
  const peek = CS.peek;
  const basePlan = only || CV.base;
  const show = peek ? (only ? only : basePlan === "old" ? "new" : "old") : basePlan;
  const f = peek ? 1 : CV.marks ? CV.fade / 100 : 1;
  const img = new ImageData(w, hh), px = img.data;
  for (let i = 0; i < w * hh; i++) {
    const g = show === "old" ? gO[i] : show === "new" ? gN[i] : Math.min(gO[i], gN[i]);
    const v = 255 - (255 - g) * f;
    px[4 * i] = px[4 * i + 1] = px[4 * i + 2] = v; px[4 * i + 3] = 255;
  }
  if (peek || !CV.marks || !R) return img;

  const s = view.s, out = CV.outline * d, mmPad = (out + 6 * d) / s;
  const vr = { x0: view.x0 - mmPad, y0: view.y0 - mmPad, x1: view.x0 + w / s + mmPad, y1: view.y0 + hh / s + mmPad };
  const vis = R.items.filter((it) => it.box.x1 >= vr.x0 && it.box.x0 <= vr.x1 && it.box.y1 >= vr.y0 && it.box.y0 <= vr.y1);
  if (!vis.length) return img;
  const xxx = CV.removed !== "halo";

  // Changed objects into masks: R = line, G = area, B = outline halo, one mask per Plan.
  const mask = (src) => {
    const c = new OffscreenCanvas(w, hh), ctx = c.getContext("2d");
    ctx.setTransform(s, 0, 0, s, -view.x0 * s, -view.y0 * s);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    const halo = out > 0 && !(src === "old" && xxx);
    for (const it of vis) {
      if (it.src !== src || !it.o) continue;
      const o = it.o, path = pathOf(o);
      if (o.kind === "stroke") {
        const lw = Math.max(o.nums ? o.nums[0] : 0.2, 1.5 * d / s);
        if (halo) { ctx.strokeStyle = "#0000ff"; ctx.lineWidth = lw + (2 * out) / s; ctx.stroke(path); }
        ctx.strokeStyle = "#ff0000"; ctx.lineWidth = lw; ctx.stroke(path);
      } else {
        if (halo) { ctx.strokeStyle = "#0000ff"; ctx.lineWidth = (2 * out) / s; ctx.stroke(path); }
        ctx.fillStyle = "#00ff00"; ctx.fill(path);
      }
    }
    return ctx.getImageData(0, 0, w, hh).data;
  };
  const mo = mask("old"), mn = mask("new");
  const blend = (p, col, a) => { for (let c = 0; c < 3; c++) px[4 * p + c] = px[4 * p + c] * (1 - a) + col[c] * a; };
  for (let p = 0; p < w * hh; p++) {
    const q = 4 * p;
    const lo = mo[q] > 110, ln = mn[q] > 110, ao = mo[q + 1] > 110, an = mn[q + 1] > 110, ho = mo[q + 2] > 110, hn = mn[q + 2] > 110;
    if (!(lo || ln || ao || an || ho || hn)) continue;
    // The part a Removed and an Added object share (unchanged) is grey.
    const pick = (x, y) => (x && y ? COL.grey : x ? COL.yellow : COL.red);
    const mine = (x, y) => !only || (only === "old" ? x : y);
    if (lo || ln) { if (mine(lo || ao, ln || an)) blend(p, pick(lo || ao, ln || an), 1); }
    else if (ao || an) { if (mine(ao, an)) blend(p, pick(ao, an), 0.45); }
    else if (mine(ho, hn)) blend(p, pick(ho || ao, hn || an), 0.3);
  }

  // Changed words: the glyphs' own ink, coloured, with a halo around them.
  for (const it of vis) {
    if (!it.text || (only && it.src !== only)) continue;
    const g = it.src === "old" ? gO : gN, col = it.src === "old" ? COL.yellow : COL.red;
    const bx0 = Math.max(0, Math.floor((it.box.x0 - view.x0) * s)), by0 = Math.max(0, Math.floor((it.box.y0 - view.y0) * s));
    const bx1 = Math.min(w, Math.ceil((it.box.x1 - view.x0) * s)), by1 = Math.min(hh, Math.ceil((it.box.y1 - view.y0) * s));
    if (bx1 <= bx0 || by1 <= by0) continue;
    const r = it.src === "old" && xxx ? 0 : Math.round(out);
    const X0 = Math.max(0, bx0 - r), Y0 = Math.max(0, by0 - r), X1 = Math.min(w, bx1 + r), Y1 = Math.min(hh, by1 + r);
    const W = X1 - X0, H = Y1 - Y0, ink = new Uint8Array(W * H);
    let any = false;
    for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) if (g[y * w + x] < 170) { ink[(y - Y0) * W + (x - X0)] = 1; any = true; }
    // Too small to show its ink: fill the word's box instead.
    if (!any) for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) ink[(y - Y0) * W + (x - X0)] = 1;
    const halo = r ? dilate(ink, W, H, r) : ink;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = (y + Y0) * w + (x + X0);
      if (ink[y * W + x]) blend(p, col, 1); else if (halo[y * W + x]) blend(p, col, 0.3);
    }
  }
  if (!xxx || only === "new") return img;

  // Removed as x–x–x: a dashed ring around each Removed object with × in the gaps.
  const c = new OffscreenCanvas(w, hh), ctx = c.getContext("2d");
  ctx.putImageData(img, 0, 0);
  const ring = new OffscreenCanvas(w, hh), rc = ring.getContext("2d");
  rc.setTransform(s, 0, 0, s, -view.x0 * s, -view.y0 * s);
  rc.lineCap = "butt"; rc.lineJoin = "round";
  const D = Math.max(4 * d, out) / s, t = 1.7 * d / s, dash = 9 * d / s, gap = 9 * d / s, crosses = [];
  for (const it of vis) {
    if (it.src !== "old") continue;
    let path, lw = 0, closed;
    if (it.o) { path = pathOf(it.o); closed = it.o.kind !== "stroke"; if (!closed) lw = Math.max(it.o.nums ? it.o.nums[0] : 0.2, 1.5 * d / s); }
    else { const b = it.box; path = new Path2D(); path.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); closed = true; }
    rc.globalCompositeOperation = "source-over";
    rc.strokeStyle = YELLOW_INK; rc.setLineDash([dash, gap]); rc.lineWidth = lw + 2 * D + t; rc.stroke(path);
    rc.globalCompositeOperation = "destination-out"; rc.setLineDash([]); rc.lineWidth = lw + 2 * D - t; rc.stroke(path);
    if (closed) rc.fill(path);
    crosses.push({ path, closed, lw, segs: it.o ? subpaths(it.o) : boxSub(it.box) });
  }
  ctx.drawImage(ring, 0, 0);
  // × at the middle of each gap, on both sides of the object (outside a closed shape only).
  ctx.strokeStyle = YELLOW_INK; ctx.lineWidth = 1.7 * d; ctx.lineCap = "round";
  const k = 3.6 * d;
  ctx.beginPath();
  for (const cr of crosses) {
    for (const sp of cr.segs) {
      let walked = 0, next = dash + gap / 2;
      for (let i = 0; i + 3 < sp.length; i += 2) {
        const ax = sp[i], ay = sp[i + 1], bx = sp[i + 2], by = sp[i + 3], len = Math.hypot(bx - ax, by - ay);
        if (!len) continue;
        const nx = -(by - ay) / len, ny = (bx - ax) / len, off = cr.lw / 2 + D;
        while (next <= walked + len) {
          const u = (next - walked) / len, x = ax + (bx - ax) * u, y = ay + (by - ay) * u;
          for (const sg of [1, -1]) {
            const X = (x + sg * nx * off - view.x0) * s, Y = (y + sg * ny * off - view.y0) * s;
            if (cr.closed && rc.isPointInPath(cr.path, X, Y)) continue;
            ctx.moveTo(X - k, Y - k); ctx.lineTo(X + k, Y + k); ctx.moveTo(X - k, Y + k); ctx.lineTo(X + k, Y - k);
          }
          next += dash + gap;
        }
        walked += len;
      }
    }
  }
  ctx.stroke();
  return ctx.getImageData(0, 0, w, hh);
}

function pathOf(o) {
  if (o._path) return o._path;
  const k = o.coords, path = new Path2D();
  if (o.kind === "stroke") for (let q = 0; q < k.length; q += 4) { path.moveTo(k[q], k[q + 1]); path.lineTo(k[q + 2], k[q + 3]); }
  else {
    let start = true;
    for (let q = 0; q < k.length; q += 2) {
      if (Number.isNaN(k[q])) { path.closePath(); start = true; continue; }
      if (start) { path.moveTo(k[q], k[q + 1]); start = false; } else path.lineTo(k[q], k[q + 1]);
    }
  }
  return (o._path = path);
}
/** The object's subpaths as flat point lists (closed shapes repeat their first point). */
function subpaths(o) {
  const k = o.coords, out = [];
  if (o.kind === "stroke") { for (let q = 0; q < k.length; q += 4) out.push([k[q], k[q + 1], k[q + 2], k[q + 3]]); return out; }
  let cur = [];
  for (let q = 0; q < k.length; q += 2) {
    if (Number.isNaN(k[q])) { if (cur.length) out.push([...cur, cur[0], cur[1]]); cur = []; continue; }
    cur.push(k[q], k[q + 1]);
  }
  if (cur.length) out.push([...cur, cur[0], cur[1]]);
  return out;
}
const boxSub = (b) => [[b.x0, b.y0, b.x1, b.y0, b.x1, b.y1, b.x0, b.y1, b.x0, b.y0]];

function dilate(ink, W, H, r) {
  const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) { let last = -1e9; for (let x = 0; x < W; x++) { if (ink[y * W + x]) last = x; if (x - last <= r) tmp[y * W + x] = 1; } last = 1e9; for (let x = W - 1; x >= 0; x--) { if (ink[y * W + x]) last = x; if (last - x <= r) tmp[y * W + x] = 1; } }
  for (let x = 0; x < W; x++) { let last = -1e9; for (let y = 0; y < H; y++) { if (tmp[y * W + x]) last = y; if (y - last <= r) out[y * W + x] = 1; } last = 1e9; for (let y = H - 1; y >= 0; y--) { if (tmp[y * W + x]) last = y; if (last - y <= r) out[y * W + x] = 1; } }
  return out;
}

// ---------- overlay: not compared, selected place, rings ----------

/**
 * Parts of a Plan that are not compared, in the frame: Header, Footer, and the Overhang
 * (Body beyond the other Plan's Body). Each: { rect, label, kind }.
 */
export function notCompared(which) {
  const R = S.result;
  if (!R) return [];
  const sh = which === "new" ? S.offset : 0, [b0, b1] = S.body[which], len = L(which), a = A(which), [w0, w1] = R.win;
  const out = [], other = which === "new" ? "alten" : "neuen", me = which === "new" ? "neuen" : "alten";
  const add = (t0, t1, label, kind) => { if (t1 - t0 > 1) out.push({ rect: rectTA(t0, t1, 0, a), label, kind }); };
  add(sh, sh + b0, "Kopf · nicht verglichen", "head");
  add(sh + b1, sh + len, "Fuß · nicht verglichen", "foot");
  add(sh + b0, w0 - 0.5, `nur im ${me} Plan · kein Gegenstück im ${other}`, "overhang");
  add(w1 + 0.5, sh + b1, `nur im ${me} Plan · kein Gegenstück im ${other}`, "overhang");
  return out;
}

/** Draw the overlay of a comparison view. `plans`: which Plans' Overhang to show. */
export function drawOverlay(ctx, V, { plans, selected = true, label = null, only = null }) {
  for (const which of plans) {
    for (const z of notCompared(which)) {
      ctx.fillStyle = z.kind === "overhang" ? "rgba(246,245,242,.72)" : "rgba(246,245,242,.55)";
      ctx.fillRect(z.rect.x0, z.rect.y0, z.rect.x1 - z.rect.x0, z.rect.y1 - z.rect.y0);
      if (z.kind === "overhang") { ctx.fillStyle = hatch(ctx, V); ctx.fillRect(z.rect.x0, z.rect.y0, z.rect.x1 - z.rect.x0, z.rect.y1 - z.rect.y0); }
    }
  }
  const gs = groups();
  screen(ctx, () => {
    for (const which of plans) for (const z of notCompared(which)) stickyTag(ctx, V, z.rect, z.label, z.kind === "overhang" ? "#55555c" : "#8a8a90");
    // Small places stay findable when zoomed out: a ring around each place smaller than 18 px.
    if (CV.rings && CV.marks && !CS.peek) {
      for (let i = 0; i < gs.length; i++) {
        const b = placeBox(gs[i]), sw = (b.x1 - b.x0) * V.s, sh = (b.y1 - b.y0) * V.s;
        if (Math.max(sw, sh) >= 18) continue;
        if (only && !gs[i].items.some((it) => it.src === only)) continue; // C: only this Plan's places
        const cx = ((b.x0 + b.x1) / 2 - V.x0) * V.s, cy = ((b.y0 + b.y1) / 2 - V.y0) * V.s;
        if (cx < -20 || cy < -20 || cx > V.w + 20 || cy > V.h + 20) continue;
        ring(ctx, cx, cy, 11, only || kindOf(gs[i]));
      }
    }
    if (selected && gs[CS.sel] && !CS.peek) {
      const b = placeBox(gs[CS.sel]), m = 8 + CV.outline;
      const x = (b.x0 - V.x0) * V.s - m, y = (b.y0 - V.y0) * V.s - m, w = (b.x1 - b.x0) * V.s + 2 * m, hh = (b.y1 - b.y0) * V.s + 2 * m;
      ctx.strokeStyle = "#1d1d1f"; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.roundRect(x, y, Math.max(w, 12), Math.max(hh, 12), 6); ctx.stroke(); ctx.setLineDash([]);
      pill(ctx, x, y - 24 < 2 ? y + hh + 4 : y - 24, `${CS.sel + 1} / ${gs.length}`, { bg: "#1d1d1f" });
    }
    if (CS.peek) pill(ctx, V.w / 2 - 90, 12, label || "Plan ohne Markierungen (Shift)", { bg: "#1d1d1f" });
  });
}

function ring(ctx, x, y, r, kind) {
  ctx.lineWidth = 3;
  const arc = (a0, a1, col) => { ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(x, y, r, a0, a1); ctx.stroke(); };
  ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  if (kind === "both") { arc(Math.PI / 2, Math.PI * 1.5, YELLOW_INK); arc(-Math.PI / 2, Math.PI / 2, RED); }
  else arc(0, Math.PI * 2, kind === "old" ? YELLOW_INK : RED);
}

let hatchTile = null;
function hatch(ctx, V) {
  if (!hatchTile) {
    hatchTile = new OffscreenCanvas(12, 12);
    const c = hatchTile.getContext("2d");
    c.strokeStyle = "rgba(90,90,100,.35)"; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(-2, 14); c.lineTo(14, -2); c.moveTo(-2, 2); c.lineTo(2, -2); c.moveTo(10, 14); c.lineTo(14, 10); c.stroke();
  }
  const p = ctx.createPattern(hatchTile, "repeat");
  p.setTransform(new DOMMatrix().scale(1 / V.s));
  return p;
}

export function screen(ctx, f) { ctx.save(); const d = devicePixelRatio; ctx.setTransform(d, 0, 0, d, 0, 0); f(); ctx.restore(); }
export function pill(ctx, x, y, text, { bg = "#1d1d1f", fg = "#fff", size = 12 } = {}) {
  ctx.font = `600 ${size}px system-ui, "Segoe UI", sans-serif`;
  const w = ctx.measureText(text).width + 16, hh = size + 10;
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x, y, w, hh, hh / 2); ctx.fill();
  ctx.fillStyle = fg; ctx.textBaseline = "middle"; ctx.fillText(text, x + 8, y + hh / 2 + 0.5);
  return w;
}
/** A label at the top-left of the part of `r` that is on screen. */
function stickyTag(ctx, V, r, text, bg) {
  const x0 = Math.max(r.x0, V.x0), y0 = Math.max(r.y0, V.y0), x1 = Math.min(r.x1, V.x0 + V.w / V.s), y1 = Math.min(r.y1, V.y0 + V.h / V.s);
  if ((x1 - x0) * V.s < 40 || (y1 - y0) * V.s < 26) return;
  pill(ctx, (x0 - V.x0) * V.s + 8, (y0 - V.y0) * V.s + 8, text, { bg });
}

// ---------- the viewer ----------

/**
 * A map view of the comparison. only: null (one Plan with all marks) or "old" / "new".
 * Returns the viewer from alignment/viewer.mjs.
 */
export function compareViewer(host, { only = null, onChange, overlayExtra } = {}) {
  const cache = layerCache();
  const viewer = createViewer(host, {
    paint: (view, w, hh) => {
      if (!S.result) return null;
      const gO = cache("old", view, w, hh, 0), gN = cache("new", view, w, hh, S.offset);
      return paintCompare({ view, w, h: hh, gO, gN, only });
    },
    overlay: (ctx, V) => {
      const plans = only ? [only] : CS.peek ? [CV.base === "old" ? "new" : "old"] : CV.base === "both" ? ["old", "new"] : [CV.base];
      const peekName = only ? (only === "old" ? "alter Plan" : "neuer Plan") : CV.base === "old" ? "neuer Plan" : "alter Plan";
      drawOverlay(ctx, V, { plans, only, label: `${peekName}, ohne Markierungen (Shift)` });
      if (overlayExtra) overlayExtra(ctx, V);
    },
    hover: () => "grab",
    down: () => null, // left drag pans here: nothing to edit in the comparison
    onChange,
  });
  return viewer;
}

/** Zoom to a place: it fills about half the view, with at least 80 mm around it. */
export function fitPlace(viewer, g) {
  const b = placeBox(g);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const wmm = Math.max(b.x1 - b.x0, 80), hmm = Math.max(b.y1 - b.y0, 80);
  viewer.fit({ x0: cx - wmm, x1: cx + wmm, y0: cy - hmm, y1: cy + hmm }, 0); // fit() measures the view first
}
export function fitWhole(viewer) {
  const [w0, w1] = S.result ? S.result.win : S.body.old;
  viewer.fit(rectTA(Math.min(0, S.offset, w0), Math.max(L("old"), L("new") + S.offset, w1), 0, Math.max(A("old"), A("new"))), 20);
}
/** The whole compared Body across the view's width (time runs along it). */
export function fitAcross(viewer, t) {
  const V = viewer.V, a = Math.max(A("old"), A("new"));
  const s = S.axis === "y" ? (V.w - 40) / a : (V.h - 40) / a;
  if (S.axis === "y") viewer.setView(-20 / s, t - V.h / 2 / s, s); else viewer.setView(t - V.w / 2 / s, -20 / s, s);
}

// ---------- keyboard ----------

/**
 * ← / → (and J / K): previous / next place. Hold Shift: the other Plan without marks.
 * M: marks on/off. Returns a cleanup function.
 */
export function keys({ go, redraw }) {
  const down = (e) => {
    if (e.target.closest("input, textarea, select")) return;
    if (e.ctrlKey && e.altKey) return; // the prototype switcher
    if (e.key === "ArrowRight" || e.key === "j" || e.key === "J") { e.preventDefault(); go(+1); }
    else if (e.key === "ArrowLeft" || e.key === "k" || e.key === "K") { e.preventDefault(); go(-1); }
    else if (e.key === "m" || e.key === "M") setCV({ marks: !CV.marks });
    else if (e.key === "Shift" && !CS.peek) { CS.peek = true; redraw(); }
  };
  const up = (e) => { if (e.key === "Shift" && CS.peek) { CS.peek = false; redraw(); } };
  const blur = () => { if (CS.peek) { CS.peek = false; redraw(); } };
  addEventListener("keydown", down); addEventListener("keyup", up); addEventListener("blur", blur);
  return () => { removeEventListener("keydown", down); removeEventListener("keyup", up); removeEventListener("blur", blur); };
}

// ---------- controls (each variant places them differently) ----------

/** A segmented switch whose words are the buttons; a pill slides behind the chosen one. */
export function wordSwitch(options, get, set, { title = "" } = {}) {
  const n = options.length;
  const knob = h("span", { style: `position:absolute;top:3px;bottom:3px;left:3px;width:calc(${100 / n}% - ${6 / n}px);border-radius:99px;transition:transform .18s ease, background .18s;box-shadow:0 1px 3px rgba(0,0,0,.25)` });
  const words = options.map(([v, label]) => h("button", { style: "position:relative;z-index:1;flex:1;border:0;background:transparent;border-radius:99px;padding:5px 12px;font-weight:650;transition:color .18s", onclick: () => set(v) }, label));
  const el = h("div", { title, style: "position:relative;display:inline-flex;border:1px solid var(--line);border-radius:99px;padding:3px;background:#fff" }, knob, ...words);
  const draw = () => {
    const i = Math.max(0, options.findIndex(([v]) => v === get()));
    knob.style.transform = `translateX(${i * 100}%)`;
    knob.style.background = options[i][2] || "#1d1d1f";
    words.forEach((w, j) => (w.style.color = j === i ? "#fff" : "var(--muted)"));
  };
  draw();
  el.redraw = draw;
  return el;
}
export const baseSwitch = () => wordSwitch([["old", "Alt", COLORS.old], ["new", "Neu", COLORS.new], ["both", "Beide", "#55555c"]], () => CV.base, (v) => setCV({ base: v }), { title: "Welcher Plan liegt unter den Markierungen" });

export function outlineSlider() {
  const val = h("span", { style: "min-width:42px;text-align:right;font-variant-numeric:tabular-nums" });
  const inp = h("input", { type: "range", min: "0", max: "50", step: "1", style: "flex:1;min-width:80px" });
  inp.value = CV.outline; val.textContent = CV.outline + " px";
  inp.oninput = () => { val.textContent = inp.value + " px"; setCV({ outline: +inp.value }); };
  const el = h("label", { style: "display:flex;align-items:center;gap:8px" }, h("span", {}, "Umriss"), inp, val);
  el.redraw = () => { if (document.activeElement !== inp) { inp.value = CV.outline; val.textContent = CV.outline + " px"; } };
  return el;
}
export function fadeSlider() {
  const inp = h("input", { type: "range", min: "10", max: "100", step: "5", style: "flex:1;min-width:80px" });
  inp.value = CV.fade;
  inp.oninput = () => setCV({ fade: +inp.value });
  const el = h("label", { style: "display:flex;align-items:center;gap:8px" }, h("span", {}, "Plan blass"), inp, h("span", {}, "kräftig"));
  el.redraw = () => { if (document.activeElement !== inp) inp.value = CV.fade; };
  return el;
}
export const removedSwitch = () => wordSwitch([["halo", "Schleier", YELLOW_INK], ["xxx", "x–x–x", YELLOW_INK]], () => CV.removed, (v) => setCV({ removed: v }), { title: "Wie Weggefallenes umrandet wird" });
export function check(label, key, title = "") {
  const inp = h("input", { type: "checkbox" });
  inp.checked = !!CV[key];
  inp.onchange = () => setCV({ [key]: inp.checked });
  const el = h("label", { title, style: "display:flex;align-items:center;gap:6px;cursor:pointer" }, inp, label);
  el.redraw = () => (inp.checked = !!CV[key]);
  return el;
}
export function legend() {
  const sw = (bg, extra = "") => h("span", { style: `display:inline-block;width:14px;height:10px;border-radius:2px;background:${bg};${extra}` });
  return h("div", { class: "hint", style: "display:flex;flex-direction:column;gap:3px" },
    h("span", {}, sw(RED), " ", h("b", { style: `color:${RED}` }, "rot"), ": dazugekommen (neuer Plan)"),
    h("span", {}, sw(YELLOW), " ", h("b", { style: `color:${YELLOW_INK}` }, "gelb"), ": weggefallen (alter Plan)"),
    h("span", {}, sw(GREY), " grau: Teil eines geänderten Objekts, der gleich blieb"),
    h("span", {}, sw("repeating-linear-gradient(45deg,#ccc 0 2px,#f6f5f2 2px 5px)", "border:1px solid #ccc"), " schraffiert: nicht verglichen"));
}

/** Re-draw controls (made by the helpers above) when the settings change elsewhere. */
export function bindRedraw(...els) { return on((w) => { if (w === "cv") for (const e of els) e.redraw && e.redraw(); }); }
