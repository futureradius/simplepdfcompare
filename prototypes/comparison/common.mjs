// PROTOTYPE (throwaway) for the ticket "What does the comparison view look like?".
// Shared by the three comparison-view variants: display settings, the painter that draws
// Differences into a rendered view, the overlay (Overhang, Header/Footer, the selected place,
// rings for small places), place descriptions, the keyboard, and a map viewer wired to all that.
//
// Frame: every view is in the Old Plan's page mm; the New Plan sits at +Offset along time.
import { createViewer } from "../alignment/viewer.mjs";
import { S, on, emit, h, L, A, fmt, rectTA, layerCache, COLORS } from "../alignment/shared.mjs";
import { renderGray } from "../alignment/engine.mjs";
import * as N from "./naming.mjs";
import * as ACT from "./activities.mjs";

export { S, on, emit, h, L, A, fmt, rectTA };

// ---------- display settings (shared by all variants, kept per browser) ----------

// Round 2: x–x–x is the default for Removed, with a size slider; a filter by kind of change.
const KEY = "compareview.settings.v2";
const DEFAULTS = { base: "new", marks: true, outline: 6, removed: "xxx", xsize: 70, fade: 35, rings: true, filter: {}, sort: [] };
export const CV = (() => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { ...DEFAULTS }; } })();
export function setCV(patch) {
  Object.assign(CV, patch);
  try { localStorage.setItem(KEY, JSON.stringify(CV)); } catch {}
  emit("cv");
}
export const resetCV = () => setCV({ ...DEFAULTS });

export const RED = "#dc2a1e", YELLOW = "#f0be00", YELLOW_INK = "#b88a00", GREY = "#4a4a4a";
const COL = { grey: [74, 74, 74], yellow: [240, 190, 0], red: [220, 42, 30] };

/**
 * The selected place and the peek: null, or "new" while Space is held / "old" while
 * Ctrl + Space is held (that Plan alone, without marks; Ctrl, not Shift: pressing Shift
 * often turns on Windows Sticky Keys).
 */
export const CS = { sel: 0, peek: null };

export const tAx = () => (S.axis === "y" ? 1 : 0);
export const tLo = (b) => (S.axis === "y" ? b.y0 : b.x0);
export const tHi = (b) => (S.axis === "y" ? b.y1 : b.x1);
const aLo = (b) => (S.axis === "y" ? b.x0 : b.y0);
const aHi = (b) => (S.axis === "y" ? b.x1 : b.y1);

/** A place's box: all of its items (round 1 cut long places to a 300 mm tile). */
export const placeBox = (g) => g.box;

// ---------- kinds of change (round 2) ----------

/** [key, label, explanation]; the order of the filter list. */
export const CATS = [
  ["later", "Später", "nach hinten verschoben, gleich lang"],
  ["earlier", "Früher", "vorgezogen, gleich lang"],
  ["longer", "Verlängert", "länger entlang der Zeit"],
  ["shorter", "Verkürzt", "kürzer entlang der Zeit"],
  ["across", "Quer verschoben", "anderer Ort (quer zur Zeit), gleiche Zeit"],
  ["text", "Text geändert", "nur Beschriftung: neu, entfallen oder anders"],
  ["added", "Neu", "nur im neuen Plan"],
  ["removed", "Entfallen", "nur im alten Plan"],
  ["recolour", "Umgefärbt", "gleiche Form, andere Farbe"],
  ["textmove", "Beschriftung verschoben", "nur ein Text an anderer Stelle, gleicher Wortlaut"],
  ["other", "Sonstiges", "Form geändert oder mehreres zugleich"],
];
export const catLabel = (k) => (CATS.find((c) => c[0] === k) || [k, k])[1];
export const catOn = (k) => CV.filter[k] !== false;

let derivedFor = null, derived = [];
/** All places of the current result, with moved pairs merged and a kind of change each. */
export function allPlaces() {
  const R = S.result;
  if (!R) return [];
  if (derivedFor !== R) { derivedFor = R; derived = derive(R); }
  return derived;
}
// Round 3: places the user hid ("not a real change"), per pair of Plans, for this session.
// Keyed by kind and rounded box, so they stay hidden when the comparison reruns.
const hidden = { plans: null, keys: new Set() };
const placeKey = (p) => `${p.cat}|${[p.box.x0, p.box.y0, p.box.x1, p.box.y1].map((v) => Math.round(v)).join(",")}`;
const hiddenKeys = () => { if (hidden.plans !== S.plans) { hidden.plans = S.plans; hidden.keys = new Set(); } return hidden.keys; };
export const isHidden = (p) => hiddenKeys().has(placeKey(p));
/** Hide or show one place or several (an array) at once. */
export function setHidden(p, on) { const k = hiddenKeys(); for (const x of [].concat(p)) { if (on) k.add(placeKey(x)); else k.delete(placeKey(x)); } emit("hidden"); }
export const hiddenCount = () => allPlaces().filter(isHidden).length;
/** Is a place on the plan and in the list: let through by the filter and not hidden. */
export const shownPlace = (p) => catOn(p.cat) && !isHidden(p) && inRange(p);
/**
 * Wann / Wo ranges (user, 2026-11-25: "filter for a region of interest"): part of the filter,
 * so a Vorlage can keep a region. km: [lo, hi] in km; day: [lo, hi] in days since 1970 (UTC).
 * A place shows when it overlaps the range; one without km (or dates) does not, as in Excel.
 */
export const rangeOf = (k) => (CV.filter && Array.isArray(CV.filter[k]) ? CV.filter[k] : null);
const RANGES = [["km", "kmLo", "kmHi"], ["day", "dayLo", "dayHi"]];
function inRange(p) {
  const nm = p.nm || {};
  for (const [k, lo, hi] of RANGES) {
    const r = rangeOf(k);
    if (!r) continue;
    if (nm[lo] == null || nm[hi] < r[0] || nm[lo] > r[1]) return false;
  }
  return true;
}
export function setRange(k, r) { const f = fullFilter(); if (r) f[k] = r; else delete f[k]; setFilter(f); }

/** The places the filter lets through and the user did not hide (list, marks, ◀ ▶). */
export const groups = () => sortPlaces(allPlaces().filter(shownPlace));

// ---------- sorting (naming ticket, round 2): like Excel, and it sticks ----------
// CV.sort = [{ key, dir }], the first is the main key. Clicking a column makes it the main
// key and keeps the earlier ones as tie-breakers inside it (Excel: sort by surname, then by
// company, and the surnames stay in order within each company). Kept per browser.
export const SORTS = {
  no: ["Nr", (p) => p.no, 1],
  name: ["Was", (p) => (nameOf(p) || shapeName(p) || "").toLocaleLowerCase("de"), 1],
  cat: ["Art", (p) => CATS.findIndex((c) => c[0] === p.cat), 1],
  amt: ["Um", (p) => (p.amtT != null ? Math.abs(p.amtT) : p.amtA != null ? Math.abs(p.amtA) / 1e6 : null), -1],
  when: ["Wann", (p) => tLo((p.nm && p.nm.box) || p.box), 1],
  where: ["Wo", (p) => (p.nm && p.nm.kmLo != null ? p.nm.kmLo : null), 1], // round 2 (places): Wann and Wo split
};
const cmpVal = (a, b) => (typeof a === "string" ? a.localeCompare(b, "de", { numeric: true }) : a - b);
function sortPlaces(list) {
  const keys = (CV.sort || []).filter((k) => SORTS[k.key]);
  if (!keys.length) return list;
  return list.slice().sort((p, q) => {
    for (const { key, dir } of keys) {
      const f = SORTS[key][1], a = f(p), b = f(q);
      if (a == null || b == null) { if (a == null && b == null) continue; return a == null ? 1 : -1; } // empty always last
      const c = cmpVal(a, b);
      if (c) return c * dir;
    }
    return p.no - q.no;
  });
}
/** Click on a column: it becomes the main key; clicking the main key again turns it round. */
export function sortBy(key) {
  const cur = CV.sort || [];
  if (cur[0] && cur[0].key === key) setCV({ sort: [{ key, dir: -cur[0].dir }, ...cur.slice(1)] });
  else setCV({ sort: [{ key, dir: SORTS[key][2] }, ...cur.filter((k) => k.key !== key)].slice(0, 4) });
}
export const clearSort = () => setCV({ sort: [] });

const TOL = 0.3; // mm
const r1 = (v) => Math.round(v * 10) / 10;
/** What an item looks like, independent of where it is (to pair a Removed place with its Added twin). */
function itemSig(it) {
  if (it.text) return "w:" + (it.text.text || "?");
  const o = it.o, b = o.bbox, k = o.coords, rel = [];
  for (let i = 0; i < k.length; i += 2) rel.push(Number.isNaN(k[i]) ? "n" : r1(k[i] - b.x0) + "," + r1(k[i + 1] - b.y0));
  return `${o.kind}|${o.key}|${rel.join(" ")}`;
}
const union = (bs) => bs.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));
const fmm = (v) => `${fmt(Math.abs(v), Math.abs(v) < 10 ? 1 : 0)} mm`;
/** An amount along time in days, across in km, when the axes were read (else mm). */
const along = (v) => { try { return N.daysText(N.axesOf("new"), v) || fmm(v); } catch { return fmm(v); } };
const acrossAmt = (v, at = 0) => { try { return N.kmLenText(N.axesOf("new"), v, at) || fmm(v); } catch { return fmm(v); } };

function derive(R) {
  let places = R.groups.map((g) => ({ box: g.box, items: g.items, acts: g.acts, loose: g.loose }));
  // Pair a place that only lost things with one that only gained the same things elsewhere:
  // that is one change (moved), not two.
  const only = (p, src) => p.items.every((it) => it.src === src && !it.recol);
  const sig = (p) => p.items.map(itemSig).sort().join("\n");
  const olds = places.filter((p) => only(p, "old")), news = places.filter((p) => only(p, "new"));
  const bySig = new Map();
  for (const p of news) { const s = sig(p); (bySig.get(s) || bySig.set(s, []).get(s)).push(p); }
  const gone = new Set();
  const merged = [];
  for (const p of olds) {
    const list = (bySig.get(sig(p)) || []).filter((q) => !gone.has(q));
    if (!list.length) continue;
    const c = (b) => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2], [px, py] = c(p.box);
    list.sort((a, b) => Math.hypot(c(a.box)[0] - px, c(a.box)[1] - py) - Math.hypot(c(b.box)[0] - px, c(b.box)[1] - py));
    const q = list[0];
    gone.add(p); gone.add(q);
    merged.push({ box: union([p.box, q.box]), items: [...p.items, ...q.items], paired: true });
  }
  places = places.filter((p) => !gone.has(p)).concat(merged);
  for (const p of places) classify(p);
  places = nameAll(places);
  for (const p of places) for (const it of p.items) it.place = p;
  places.sort((a, b) => tLo(a.box) - tLo(b.box));
  places.forEach((p, i) => (p.no = i + 1)); // a place keeps its number when sorted or filtered
  return places;
}

// ---------- naming (ticket "How do we name what changed") ----------

const shiftOf = (side) => (side === "new" ? S.offset : 0);
/** A frame box (Old page mm) in a Plan's own page mm, and back. */
const toRaw = (b, side) => { const d = shiftOf(side); return S.axis === "y" ? { ...b, y0: b.y0 - d, y1: b.y1 - d } : { ...b, x0: b.x0 - d, x1: b.x1 - d }; };
const toFrame = (b, side) => { const d = shiftOf(side); return S.axis === "y" ? { ...b, y0: b.y0 + d, y1: b.y1 + d } : { ...b, x0: b.x0 + d, x1: b.x1 + d }; };
const axesSafe = (side) => { try { return N.axesOf(side); } catch (e) { console.warn(e); return { km: null, time: null, counts: {} }; } };
const ubox = (bs) => bs.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));
export const NAMING = { ms: 0, parts: {} };
/** Times a step of naming into NAMING.parts (ms), for the counts panel. */
const timed = (k, f) => { const t = performance.now(), r = f(); NAMING.parts[k] = (NAMING.parts[k] || 0) + performance.now() - t; return r; };

/**
 * Gives each place p.nm = { name, src, shape, km, dates, row, old, ambiguous, chain }, and
 * merges a label-only place into the place whose leader line (or nearness) named it.
 */
function nameAll(places) {
  const t0 = performance.now();
  NAMING.parts = {};
  timed("Index", () => { N.planIndex("old"); N.planIndex("new"); });
  const spanOwner = new Map(); // "side|span" -> label-only place
  for (const p of places) {
    if (!p.items.every((i) => i.text)) continue;
    for (const it of p.items) {
      const s = N.spanAt(N.planIndex(it.src), toRaw(it.box, it.src));
      if (s) spanOwner.set(`${it.src}|${s.id}`, p);
    }
  }
  const eaten = new Set();
  for (const p of places) {
    if (eaten.has(p)) continue;
    nameOne(p);
    for (const k of p.nm.labelKeys) {
      const q = spanOwner.get(k);
      if (!q || q === p || eaten.has(q)) continue;
      eaten.add(q); p.items.push(...q.items); p.box = ubox([p.box, q.box]); p.joined = (p.joined || 0) + 1;
    }
    if (p.joined) { const nm = p.nm; classify(p); p.nm = nm; }
  }
  NAMING.ms = Math.round(performance.now() - t0);
  return places.filter((p) => !eaten.has(p));
}

function nameOne(p) {
  const sides = p.items.some((i) => i.src === "new") ? ["new", "old"] : ["old"];
  const nm = { name: null, src: null, shape: "Text", km: null, dates: null, row: null, old: null, ambiguous: false, chain: 0, labelKeys: [] };
  let mainRaw = null, side = sides[0];
  // Places ticket: a Place that is one Activity carries its own label; no leader to follow.
  const ak = p.acts && (p.acts.find((k) => k.startsWith("new:")) || p.acts[0]);
  const lab = ak && ACT.labelOf(S.plans[ak.split(":")[0]], +ak.split(":")[1]);
  if (lab) { side = ak.split(":")[0]; mainRaw = N.objsBox(lab.shapeObjs); nm.shape = N.shapeOf(lab.shapeObjs); if (lab.name) { nm.name = lab.name; nm.src = "Vorgang"; } }
  for (const sd of lab ? [] : sides) {
    const geo = p.items.filter((i) => i.src === sd && i.o && !i.text);
    if (!geo.length) continue;
    const ix = N.planIndex(sd), seeds = geo.map((i) => ix.byPolys.get(i.o.polys) || i.o);
    const core = N.splitSeeds(seeds);
    const f = timed("Linie", () => N.followLine(ix, core));
    const leaders = new Set(f.leaders.map((o) => o.polys));
    const main = core.filter((o) => !leaders.has(o.polys));
    const body = main.length ? main : core;
    if (!mainRaw) { mainRaw = N.objsBox(body); side = sd; nm.shape = N.shapeOf(body); }
    nm.chain = Math.max(nm.chain, f.chain);
    if (f.hits.length) {
      const line = N.wholeLine(ix, f.hits[0].span);
      nm.name = line.text; nm.src = "Linie"; side = sd; mainRaw = N.objsBox(body); nm.shape = N.shapeOf(body);
      nm.ambiguous = f.hits.some((h) => !line.spans.includes(h.span));
      for (const s of line.spans) nm.labelKeys.push(`${sd}|${s.id}`);
      break;
    }
    const b = timed("daneben", () => N.besideText(ix, body));
    if (b) { const line = N.wholeLine(ix, b); nm.name = line.text; nm.src = "daneben"; side = sd; for (const s of line.spans) nm.labelKeys.push(`${sd}|${s.id}`); break; }
  }
  if (!mainRaw) {
    // a changed label: its own text line is the name (the New one; the Old one as "vorher")
    for (const sd of ["new", "old"]) {
      const words = p.items.filter((i) => i.src === sd && i.text);
      if (!words.length) continue;
      const ix = N.planIndex(sd), s = N.spanAt(ix, toRaw(words[0].box, sd));
      const line = s ? N.wholeLine(ix, s) : null, text = line ? line.text : words.map((w) => w.text.text).join(" ");
      if (!nm.name) {
        nm.name = text; nm.src = "Text"; side = sd; mainRaw = toRaw(ubox(words.map((w) => w.box)), sd);
        // where it lies: the Activity the label belongs to, found back along its leader
        const back = line ? timed("zurück", () => N.followBack(ix, line.spans)) : [];
        if (back.length) { mainRaw = N.objsBox(back); nm.shape = N.shapeOf(back); nm.back = true; }
      } else if (text !== nm.name) nm.old = text;
    }
    // a replaced word leaves only the new word: read the old text line at the same place
    if (nm.src === "Text" && !nm.old && side === "new") {
      const w = p.items.find((i) => i.text), ixo = N.planIndex("old"), so = w && N.spanAt(ixo, toRaw(w.box, "old"));
      const t = so && N.wholeLine(ixo, so).text;
      if (t && t !== nm.name) nm.old = t;
    }
  }
  if (mainRaw) {
    const ax = timed("Achsen", () => axesSafe(side)), t = S.axis === "y";
    const a0 = t ? mainRaw.x0 : mainRaw.y0, a1 = t ? mainRaw.x1 : mainRaw.y1, t0 = t ? mainRaw.y0 : mainRaw.x0, t1 = t ? mainRaw.y1 : mainRaw.x1;
    nm.km = N.kmText(ax, a0, a1);
    nm.dates = N.dateText(ax, t0, t1, { point: nm.shape === "Raute" });
    // Wann and Wo as numbers, to sort and filter by a region of interest (user, 2026-11-25)
    const k0 = N.kmAt(ax, a0), k1 = N.kmAt(ax, a1);
    if (k0 != null && k1 != null) { nm.kmLo = Math.min(k0, k1); nm.kmHi = Math.max(k0, k1); }
    if (ax.time) { const d0 = ax.time.c0 + ax.time.c1 * t0, d1 = ax.time.c0 + ax.time.c1 * t1; nm.dayLo = Math.min(d0, d1); nm.dayHi = Math.max(d0, d1); }
    // Round 3: the row guess only for bar charts (time runs right) or with a Vorgänge zone; on a
    // time-distance diagram the Header text across from a place is not its name.
    if (!ax.km && (S.axis === "x" || N.axisZones(side).rows.length)) nm.row = timed("Zeile", () => N.rowText(side, (a0 + a1) / 2));
    // Bar chart: the row is the process; a text by the bar ("20 AT", "Nachtrag") is only a note.
    if (nm.row && nm.src !== "Linie") { if (nm.name && nm.name !== nm.row) nm.label = nm.name; nm.name = nm.row; nm.src = "Zeile"; }
  }
  p.nm = nm;
}

/** The name of a place, or null when none was found. */
export const nameOf = (g) => (g.nm && g.nm.name) || null;
export const shapeName = (g) => (g.nm ? g.nm.shape : "");
/** Where it lies, in the Plan's own terms: "km 12,4–15,6 · 03.06.–12.07.27" (or "in »Zeile«"). */
export function lage(g) {
  const nm = g.nm || {};
  const parts = [nm.km, nm.dates, nm.row && nm.src !== "Zeile" ? `in »${nm.row}«` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : where(g);
}
/** What a place is called in one line: the name, else the shape and where it lies. */
export const title = (g) => nameOf(g) || `${shapeName(g)} ${lage(g)}`;
/** The size of the change: "3 Tage", "1 Tag 8 Std.", "500 m"; null when it has none. */
export function amountText(g) {
  if (g.amtT != null) return along(g.amtT);
  if (g.amtA != null) return acrossAmt(g.amtA);
  return null;
}
export const SRC = { Linie: "Name über die Hinweislinie", daneben: "Name: Text daneben", Text: "Name: die geänderte Beschriftung", Zeile: "Name: Zeile im Kopf" };

/** Sets p.cat and p.detail (German, short). */
function classify(p) {
  const o = p.items.filter((i) => i.src === "old"), n = p.items.filter((i) => i.src === "new");
  const words = (l) => l.length && l.every((i) => i.text && !i.recol);
  const set = (cat, detail = "", amtT = null, amtA = null) => { p.cat = cat; p.detail = detail; p.amtT = amtT; p.amtA = amtA; };
  if (p.items.every((i) => i.recol)) return set("recolour");
  // A whole label that appears ("new") or disappears ("gone") belongs with a new or removed
  // Activity: Neu / Entfallen. "Text geändert" is an edit to a label that is in both Plans.
  const whys = new Set(p.items.filter((i) => i.text).map((i) => i.text.why));
  const textDetail = () => (whys.has("replaced") ? "Text anders" : whys.has("shortened") ? "Text gekürzt" : whys.has("inserted") ? "Wort dazu" : "Wort weg");
  if (!o.length) return words(n) && !n.every((i) => i.text.why === "new") ? set("text", textDetail()) : set("added", words(n) ? "Beschriftung" : "");
  if (!n.length) return words(o) && !o.every((i) => i.text.why === "gone") ? set("text", textDetail()) : set("removed", words(o) ? "Beschriftung" : "");
  let go = o.filter((i) => !i.text), gn = n.filter((i) => !i.text), labelOnly = false;
  if (!go.length && !gn.length) {
    const texts = (l) => l.map((i) => i.text.text).sort().join(" ");
    if (texts(o) !== texts(n)) return set("text", textDetail());
    go = o; gn = n; labelOnly = true; // the same label, moved: its own kind (round 4), so it can be filtered out
  } else if (!go.length || !gn.length) return set("other");
  const bo = union(go.map((i) => i.box)), bn = union(gn.map((i) => i.box));
  const d0 = tLo(bn) - tLo(bo), d1 = tHi(bn) - tHi(bo), dl = d1 - d0, da0 = aLo(bn) - aLo(bo), da1 = aHi(bn) - aHi(bo);
  if (labelOnly) {
    const parts = [Math.abs(d0) > TOL && `${along(d0)} ${d0 > 0 ? "später" : "früher"}`, (Math.abs(da0) > TOL || Math.abs(da1) > TOL) && `${acrossAmt((da0 + da1) / 2, aLo(bo))} quer`].filter(Boolean);
    return set("textmove", parts.join(", "), Math.abs(d0) > TOL ? d0 : null, Math.abs(d0) > TOL ? null : (da0 + da1) / 2);
  }
  if (Math.abs(dl) <= TOL) {
    if (Math.abs(d0) > TOL) return set(d0 > 0 ? "later" : "earlier", `um ${along(d0)}`, d0);
    if (Math.abs(da0) > TOL || Math.abs(da1) > TOL) return set("across", `um ${acrossAmt((da0 + da1) / 2, aLo(bo))}`, null, (da0 + da1) / 2);
    return set("other", "Form anders");
  }
  const ends = [Math.abs(d0) > TOL && `Anfang ${along(d0)} ${d0 > 0 ? "später" : "früher"}`, Math.abs(d1) > TOL && `Ende ${along(d1)} ${d1 > 0 ? "später" : "früher"}`].filter(Boolean).join(", ");
  return set(dl > 0 ? "longer" : "shorter", ends, dl);
}

// ---------- filter presets ("Vorlagen", as in simplepdfclipper) ----------

// Round 4: the built-in presets leave moved labels out where only real changes count.
const ALL = Object.fromEntries(CATS.map(([k]) => [k, true]));
const only = (...ks) => Object.fromEntries(CATS.map(([k]) => [k, ks.includes(k)]));
export const BUILTIN = [
  { name: "Alle Änderungen", filter: ALL, builtin: true },
  { name: "Nur Terminänderungen", filter: only("later", "earlier", "longer", "shorter"), builtin: true },
  { name: "Ohne verschobene Beschriftungen", filter: { ...ALL, textmove: false }, builtin: true },
  { name: "Ohne Text", filter: { ...ALL, text: false }, builtin: true },
  { name: "Nur Text", filter: only("text"), builtin: true },
];
const PKEY = "compareview.presets";
export function userPresets() { try { return JSON.parse(localStorage.getItem(PKEY) || "[]"); } catch { return []; } }
export function savePresets(list) { try { localStorage.setItem(PKEY, JSON.stringify(list)); } catch {} emit("presets"); }
export const fullFilter = () => {
  const f = Object.fromEntries(CATS.map(([k]) => [k, catOn(k)]));
  for (const [k] of RANGES) if (rangeOf(k)) f[k] = rangeOf(k).slice();
  return f;
};
export const sameFilter = (f) => CATS.every(([k]) => (f[k] !== false) === catOn(k)) && RANGES.every(([k]) => JSON.stringify(f[k] || null) === JSON.stringify(rangeOf(k)));
export const setFilter = (f) => setCV({ filter: { ...f } });

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
export const placeLabel = (g) => catLabel(g.cat);
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
  const show = peek ? only || peek : basePlan;
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
  allPlaces(); // sets it.place
  const vis = R.items.filter((it) => (!it.place || shownPlace(it.place)) && it.box.x1 >= vr.x0 && it.box.x0 <= vr.x1 && it.box.y1 >= vr.y0 && it.box.y0 <= vr.y1);
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
  // x–x–x size (slider, %): scales the ×, the dashes and gaps, and a little the line weight.
  const z = (CV.xsize || 70) / 100, lwPx = (1 + 0.7 * z) * d;
  const D = Math.max(4 * d, out) / s, t = lwPx / s, dash = 9 * z * d / s, gap = 9 * z * d / s, crosses = [];
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
  ctx.strokeStyle = YELLOW_INK; ctx.lineWidth = lwPx; ctx.lineCap = "round";
  const k = 3.6 * z * d;
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
    // Selected places (round 5: a set, may be empty; B and C still use one index).
    const sels = CS.selSet ? gs.filter((g) => CS.selSet.has(g)) : [gs[CS.sel]].filter(Boolean);
    if (selected && !CS.peek) for (const g of sels) {
      const b = placeBox(g), m = 8 + CV.outline;
      const x = (b.x0 - V.x0) * V.s - m, y = (b.y0 - V.y0) * V.s - m, w = (b.x1 - b.x0) * V.s + 2 * m, hh = (b.y1 - b.y0) * V.s + 2 * m;
      if (x > V.w + 40 || y > V.h + 40 || x + w < -40 || y + hh < -40) continue;
      ctx.strokeStyle = "#1d1d1f"; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.roundRect(x, y, Math.max(w, 12), Math.max(hh, 12), 6); ctx.stroke(); ctx.setLineDash([]);
      const n = g.no;
      pill(ctx, x, y - 24 < 2 ? y + hh + 4 : y - 24, String(n), { bg: "#1d1d1f" }); // round 7: just the number, no "/ total"
    }
    if (CS.peek) pill(ctx, V.w / 2 - 90, 12, label || "Plan ohne Markierungen (Strg)", { bg: "#1d1d1f" });
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
export function compareViewer(host, { only = null, onChange, overlayExtra, down = () => ({}), hover = () => "default" } = {}) {
  const cache = layerCache();
  const viewer = createViewer(host, {
    paint: (view, w, hh) => {
      if (!S.result) return null;
      const gO = cache("old", view, w, hh, 0), gN = cache("new", view, w, hh, S.offset);
      return paintCompare({ view, w, h: hh, gO, gN, only });
    },
    overlay: (ctx, V) => {
      const plans = only ? [only] : CS.peek ? [CS.peek] : CV.base === "both" ? ["old", "new"] : [CV.base];
      const label = (only || CS.peek) === "old" ? "nur alter Plan, ohne Markierungen (Strg + Leertaste)" : "nur neuer Plan, ohne Markierungen (Leertaste)";
      drawOverlay(ctx, V, { plans, only, label });
      if (overlayExtra) overlayExtra(ctx, V);
    },
    // Left button: by default nothing (B, C); variant A selects places (round 5). Pan with the
    // right or middle mouse button (round 3: Space no longer pans anywhere).
    hover,
    down,
    onChange,
  });
  return viewer;
}

/**
 * Zoom to a place: it fills about half the view, with at least 80 mm around it.
 * Round 2 (places ticket, user): the view flies there instead of jumping, so it shows whether
 * the next place is near (a short pan) or somewhere else (out, across, back in). Smooth zoom
 * after van Wijk & Nuij, "Smooth and efficient zooming and panning" (2003). Instant with
 * "reduce motion"; stops as soon as the user pans or zooms.
 */
export function fitPlace(viewer, g) {
  const b = placeBox(g);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const wmm = Math.max(b.x1 - b.x0, 80), hmm = Math.max(b.y1 - b.y0, 80);
  const V = viewer.V, from = { ...V };
  globalThis.__V = V; // prototype: lets the headless check watch the flight
  viewer.fit({ x0: cx - wmm, x1: cx + wmm, y0: cy - hmm, y1: cy + hmm }, 0); // fit() measures the view first
  const to = { x0: V.x0, y0: V.y0, s: V.s };
  if (!from.s || !V.w || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // view as [centre x, centre y, width in mm]
  const p0 = [from.x0 + V.w / 2 / from.s, from.y0 + V.h / 2 / from.s, V.w / from.s], p1 = [to.x0 + V.w / 2 / to.s, to.y0 + V.h / 2 / to.s, V.w / to.s];
  const path = smoothZoom(p0, p1), ms = Math.min(900, Math.max(250, path.len * 450));
  if (path.len < 1e-3) return;
  const id = (viewer.flight = (viewer.flight || 0) + 1), t0 = performance.now();
  let last = null;
  const frame = (now) => {
    if (viewer.flight !== id) return;
    if (last && (V.x0 !== last.x0 || V.y0 !== last.y0 || V.s !== last.s)) return; // the user took over
    const t = Math.min(1, (now - t0) / ms), e = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t); // ease in and out
    const [ux, uy, w] = t < 1 ? path(e) : p1, s = V.w / w;
    viewer.setView(ux - V.w / 2 / s, uy - V.h / 2 / s, s);
    last = { x0: V.x0, y0: V.y0, s: V.s };
    if (t < 1) requestAnimationFrame(frame);
  };
  viewer.setView(from.x0, from.y0, from.s);
  last = { x0: V.x0, y0: V.y0, s: V.s };
  requestAnimationFrame(frame);
}
/** The smooth zoom path from view p0 to p1 ([cx, cy, width]); path(t) for t in 0..1, path.len its length. */
function smoothZoom([x0, y0, w0], [x1, y1, w1]) {
  const rho = Math.SQRT2, dx = x1 - x0, dy = y1 - y0, d2 = dx * dx + dy * dy;
  if (d2 < 1e-12) { // only zooming
    const S = Math.log(w1 / w0) / rho, f = (t) => [x0 + t * dx, y0 + t * dy, w0 * Math.exp(rho * t * S)];
    f.len = Math.abs(S); return f;
  }
  const d = Math.sqrt(d2), r = (b) => Math.log(Math.sqrt(b * b + 1) - b);
  const r0 = r((w1 * w1 - w0 * w0 + 4 * d2) / (2 * w0 * 2 * d)), r1 = r((w1 * w1 - w0 * w0 - 4 * d2) / (2 * w1 * 2 * d)), S = (r1 - r0) / rho;
  const f = (t) => {
    const s = t * S, u = (w0 / (2 * d)) * (Math.cosh(r0) * Math.tanh(rho * s + r0) - Math.sinh(r0));
    return [x0 + u * dx, y0 + u * dy, (w0 * Math.cosh(r0)) / Math.cosh(rho * s + r0)];
  };
  f.len = Math.abs(S); return f;
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
 * ← / → (and J / K): previous / next place. Hold Space: only the New Plan, without marks;
 * Ctrl + Space: only the Old Plan. M: marks on/off. Returns a cleanup function.
 */
export function keys({ go, redraw, hide, esc }) {
  let space = false;
  const peek = (p) => { if (CS.peek !== p) { CS.peek = p; redraw(); } };
  const down = (e) => {
    if (e.target.closest("input, textarea, select")) return;
    if (e.ctrlKey && e.altKey) return; // the prototype switcher
    if (e.ctrlKey && e.key !== " " && e.key !== "Control") return; // Ctrl + other keys: the browser's
    if (e.key === " ") { e.preventDefault(); space = true; peek(e.ctrlKey ? "old" : "new"); }
    else if (e.key === "Control") { if (space) peek("old"); }
    else if (e.key === "ArrowRight" || e.key === "j" || e.key === "J") { e.preventDefault(); go(+1); }
    else if (e.key === "ArrowLeft" || e.key === "k" || e.key === "K") { e.preventDefault(); go(-1); }
    else if (e.key === "m" || e.key === "M") setCV({ marks: !CV.marks });
    else if ((e.key === "h" || e.key === "H") && hide) hide();
    else if (e.key === "Escape" && esc) esc();
  };
  const up = (e) => {
    if (e.key === " ") { space = false; peek(null); }
    else if (e.key === "Control" && space) peek("new");
  };
  const blur = () => { space = false; peek(null); };
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
export function xSizeSlider() {
  const val = h("span", { style: "min-width:42px;text-align:right;font-variant-numeric:tabular-nums" });
  const inp = h("input", { type: "range", min: "40", max: "160", step: "5", style: "flex:1;min-width:80px" });
  inp.oninput = () => { val.textContent = inp.value + " %"; setCV({ xsize: +inp.value }); };
  const el = h("label", { title: "Größe und Abstand der x, Strichstärke", style: "display:flex;align-items:center;gap:8px;padding-left:12px" }, h("span", {}, "Größe der x"), inp, val);
  el.redraw = () => { el.style.display = CV.removed === "xxx" ? "flex" : "none"; if (document.activeElement !== inp) { inp.value = CV.xsize; val.textContent = CV.xsize + " %"; } };
  el.redraw();
  return el;
}

/** A small picture of a place with its marks, into a canvas of css size w × h. */
export function drawThumb(canvas, g, w, hh) {
  const d = devicePixelRatio, W = Math.round(w * d), H = Math.round(hh * d), b = placeBox(g);
  if (canvas.width !== W) { canvas.width = W; canvas.height = H; }
  const mw = Math.max(b.x1 - b.x0, 30) * 1.3, mh = Math.max(b.y1 - b.y0, 30) * 1.3;
  const s = Math.min(W / mw, H / mh);
  const view = { x0: (b.x0 + b.x1) / 2 - W / 2 / s, y0: (b.y0 + b.y1) / 2 - H / 2 / s, s };
  const gO = renderGray(S.plans.old, S.axis, view, W, H, 0), gN = renderGray(S.plans.new, S.axis, view, W, H, S.offset);
  const peek = CS.peek; CS.peek = null;
  canvas.getContext("2d").putImageData(paintCompare({ view, w: W, h: H, gO, gN }), 0, 0);
  CS.peek = peek;
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
