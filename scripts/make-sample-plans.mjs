// Generates two synthetic Old Plan / New Plan pairs to develop and judge the comparison
// against, since real Plans are confidential (see GLOSSARY.md for the terms).
//
//   samples/down-old.pdf, samples/down-new.pdf    Time direction down: a time-distance
//       diagram, km across the top in the Header, days down the left edge of the Body,
//       legend and stamp in the Footer. About 14 m long, so it needs /UserUnit.
//   samples/right-old.pdf, samples/right-new.pdf  Time direction right: a small classic
//       bar chart, task table in the Header (left), legend and stamp in the Footer (right).
//   samples/activities-old.pdf, ...-new.pdf       Activities drawn in one go, for Places.
//   samples/dense-old.pdf, samples/dense-new.pdf  Time direction down, 14 m long, thousands
//       of Activities drawn in one go, a good part of them changed: thousands of Places and
//       tens of thousands of marks, for measuring how the comparison view copes with many
//       marks (issue #57). Not in the ground truth: no planted change is listed.
//   samples/ground-truth.json                     Offsets, Body bounds and the planted
//       Differences (where, what) for judging detection.
//
// In each pair the New Plan covers a later timespan (starts later, ends later), so its
// Body is shifted by the Offset, has a different length and leaves an Overhang at both
// ends; the Footer moves with the end of the Body. On top of that, a known handful of
// changes is planted in the overlap. Header and Footer text differ too (must be ignored).
//
// Built from simplepdfclipper's scripts/make-test-plan.mjs (copied, not shared).
// Deterministic: same output on every run.

import * as mupdf from "mupdf";
import { mkdirSync, writeFileSync } from "node:fs";

const MAX_UNITS = 14400; // PDF page size limit per side
const PT_MM = 25.4 / 72;

// ---- Deterministic PRNG ----------------------------------------------------
let seed = 20261117;
const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => a + rand() * (b - a);
const round = (n, step) => Math.round(n / step) * step;

const f = (n) => (Math.round(n * 1000) / 1000).toString();
const r2 = (n) => Math.round(n * 100) / 100;

// ---- Text metrics (for ground-truth boxes) --------------------------------------
const FONTS = { F1: new mupdf.Font("Helvetica"), F2: new mupdf.Font("Helvetica-Bold") };
function textWidthMm(font, sizePt, s) {
  let w = 0;
  for (const ch of s) w += FONTS[font].advanceGlyph(FONTS[font].encodeCharacter(ch));
  return w * sizePt * PT_MM;
}

/** Encode a JS string as a PDF literal string (Latin-1 subset of WinAnsi). */
function pdfStr(s) {
  let out = "(";
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (ch === "(" || ch === ")" || ch === "\\") out += "\\" + ch;
    else if (c < 32 || c > 126) out += "\\" + (c & 0xff).toString(8).padStart(3, "0");
    else out += ch;
  }
  return out + ")";
}

// ---- Bounding boxes in page mm (top-down) ----------------------------------------
const box = (x0, y0, x1, y1) => ({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) });
const union = (...bs) => {
  bs = bs.filter(Boolean);
  return bs.length ? { x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)), x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)) } : null;
};
const grow = (b, d) => b && { x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d };
const roundBox = (b) => b && { x0: r2(b.x0), y0: r2(b.y0), x1: r2(b.x1), y1: r2(b.y1) };

// ---- A page being drawn: coordinates in mm, origin top-left -----------------
function makePage(wMm, hMm) {
  const longIn = Math.max(wMm, hMm) / 25.4;
  // Like the real schedule: a page longer than 200 in sets /UserUnit so its long side is
  // exactly 14,400 units. So Old and New Plan of different length have different UserUnits.
  const userUnit = longIn > 200 ? (longIn * 72) / MAX_UNITS : 1;
  const MM = 72 / 25.4 / userUnit; // PDF units per mm
  const H = hMm * MM;
  const ops = [];
  const patterns = []; // { name, stream, origin: [x, y] | null }
  const X = (mm) => f(mm * MM);
  const Y = (mm) => f(H - mm * MM);
  const L = (mm) => f(mm * MM);
  const p = {
    wMm, hMm, userUnit, ops, patterns,
    push: (s) => ops.push(s),
    rgb: (c, stroke) => ops.push(`${f(c[0])} ${f(c[1])} ${f(c[2])} ${stroke ? "RG" : "rg"}`),
    lw: (mm) => ops.push(`${L(mm)} w`),
    dash: (onMm, offMm) => ops.push(onMm ? `[${L(onMm)} ${L(offMm)}] 0 d` : "[] 0 d"),
    line: (x1, y1, x2, y2) => ops.push(`${X(x1)} ${Y(y1)} m ${X(x2)} ${Y(y2)} l S`),
    rectFill: (x, y, w, h) => ops.push(`${X(x)} ${Y(y + h)} ${L(w)} ${L(h)} re f`),
    rectStroke: (x, y, w, h) => ops.push(`${X(x)} ${Y(y + h)} ${L(w)} ${L(h)} re S`),
    poly: (pts, op) => ops.push(pts.map(([x, y], i) => `${X(x)} ${Y(y)} ${i ? "l" : "m"}`).join(" ") + ` h ${op}`),
    clip: (x, y, w, h) => ops.push(`q ${X(x)} ${Y(y + h)} ${L(w)} ${L(h)} re W n`),
    unclip: () => ops.push("Q"),
    /** Draw text with its baseline at (x, y); returns its box. */
    text: (font, sizePt, x, y, s) => {
      ops.push(`BT /${font} ${f(sizePt / userUnit)} Tf 1 0 0 1 ${X(x)} ${Y(y)} Tm ${pdfStr(s)} Tj ET`);
      const em = sizePt * PT_MM;
      return box(x, y - 0.72 * em, x + textWidthMm(font, sizePt, s), y + 0.22 * em);
    },
    /** Draw upright text (reading upwards) with its baseline starting at (x, y); returns its box. */
    textUp: (font, sizePt, x, y, s) => {
      ops.push(`BT /${font} ${f(sizePt / userUnit)} Tf 0 1 -1 0 ${X(x)} ${Y(y)} Tm ${pdfStr(s)} Tj ET`);
      const em = sizePt * PT_MM;
      return box(x - 0.72 * em, y - textWidthMm(font, sizePt, s), x + 0.22 * em, y);
    },
    /**
     * A hatch pattern: 45° lines in `color`, one cell of `cellMm`. Its origin (pattern
     * /Matrix) is at `originMm` (page mm) when given, so the phase moves with the shape;
     * with null the phase is tied to the page, as PDF does by default.
     */
    hatch: (color, cellMm, originMm, lineMm = 0.12) => {
      const name = `H${patterns.length + 1}`;
      const c = cellMm * MM;
      const e = c * 0.25;
      const stream =
        `${f(color[0])} ${f(color[1])} ${f(color[2])} RG ${f(lineMm * MM)} w ` +
        `0 0 m ${f(c)} ${f(c)} l S ${f(-e)} ${f(c - e)} m ${f(e)} ${f(c + e)} l S ${f(c - e)} ${f(-e)} m ${f(c + e)} ${f(e)} l S`;
      patterns.push({ name, stream, cell: c, origin: originMm && [originMm[0] * MM, H - originMm[1] * MM] });
      return name;
    },
    fillPattern: (name, pts) => ops.push(`q /Pattern cs /${name} scn ` + pts.map(([x, y], i) => `${X(x)} ${Y(y)} ${i ? "l" : "m"}`).join(" ") + " h f Q"),
  };
  return p;
}

function savePage(p, path) {
  const doc = new mupdf.PDFDocument();
  const fonts = doc.newDictionary();
  fonts.put("F1", doc.addSimpleFont(FONTS.F1, "Latin"));
  fonts.put("F2", doc.addSimpleFont(FONTS.F2, "Latin"));
  const res = doc.newDictionary();
  res.put("Font", fonts);
  if (p.patterns.length) {
    const pats = doc.newDictionary();
    for (const pat of p.patterns) {
      const d = doc.newDictionary();
      d.put("Type", doc.newName("Pattern"));
      d.put("PatternType", 1);
      d.put("PaintType", 1);
      d.put("TilingType", 1);
      const bbox = doc.newArray();
      for (const v of [0, 0, pat.cell, pat.cell]) bbox.push(v);
      d.put("BBox", bbox);
      d.put("XStep", pat.cell);
      d.put("YStep", pat.cell);
      d.put("Resources", doc.newDictionary());
      if (pat.origin) {
        const m = doc.newArray();
        for (const v of [1, 0, 0, 1, pat.origin[0], pat.origin[1]]) m.push(v);
        d.put("Matrix", m);
      }
      pats.put(pat.name, doc.addStream(pat.stream, d));
    }
    res.put("Pattern", pats);
  }
  const MM = 72 / 25.4 / p.userUnit;
  const content = p.ops.join("\n");
  const pageObj = doc.addPage([0, 0, p.wMm * MM, p.hMm * MM], 0, res, content);
  if (p.userUnit !== 1) pageObj.put("UserUnit", p.userUnit);
  doc.insertPage(-1, pageObj);
  const out = doc.saveToBuffer("compress,garbage").asUint8Array();
  writeFileSync(path, out);
  return { file: path, bytes: out.length, ops: p.ops.length, contentBytes: content.length };
}

// ---- Calendar ---------------------------------------------------------------------
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const MON = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const dateOf = (day0, d) => new Date(day0.getTime() + d * 86400000);
const isoWeek = (date) => {
  const t = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
};
const dmy = (date) =>
  `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.${String(date.getUTCFullYear()).slice(2)}`;

// ---- What a planted change's Place says (ADR 0006): Wann and Wo as the list shows them ----
/** "03.06.–12.07.27" from the first to the last day covered, "am 03.06.27" for one day. */
function wannText(day0, first, last) {
  const a = dateOf(day0, first), b = dateOf(day0, last);
  if (first === last) return `am ${dmy(a)}`;
  return a.getUTCFullYear() === b.getUTCFullYear() ? `${dmy(a).slice(0, 6)}–${dmy(b)}` : `${dmy(a)}–${dmy(b)}`;
}
const km1 = (km) => km.toFixed(1).replace(".", ",");

const TRADES = [
  ["Gleisbau", [0.2, 0.45, 0.8]],
  ["Oberleitung", [0.85, 0.45, 0.1]],
  ["Kabeltiefbau", [0.35, 0.6, 0.25]],
  ["LST", [0.6, 0.3, 0.65]],
  ["Ingenieurbau", [0.45, 0.45, 0.45]],
  ["Weichen", [0.75, 0.2, 0.25]],
];
const VERBS = ["einbauen", "ausbauen", "umbauen", "erneuern", "rückbauen", "herstellen", "prüfen"];
const OBJECTS = ["Gleis 1", "Gleis 2", "Weiche", "Mast", "Kabeltrog", "Bahnsteig", "Durchlass", "Signal", "EÜ", "Lärmschutzwand"];
const fmtKm = (km) => km.toFixed(3).replace(".", ",");
const RED = [0.8, 0, 0];

// =====================================================================================
// Pair 1: Time direction down (time-distance diagram)
// =====================================================================================
function downPair() {
  const W = 1189;
  const HEADER = 150; // Header band height, same in both Plans
  const FOOTER = 260; // Footer band height
  const TIMECOL = 80; // time labels at the Body's left edge
  const KM0 = 10, KM1 = 40;
  const KX = (km) => TIMECOL + ((km - KM0) * (W - TIMECOL - 10)) / (KM1 - KM0); // km -> x mm
  const DAY = 10; // mm per day
  const DAY0 = new Date(Date.UTC(2027, 0, 4)); // master day 0, a Monday
  const OLD = { start: 0, days: 190 * 7 }; // master days covered
  const NEW = { start: 8 * 7, days: (190 - 8 + 12) * 7 }; // starts 8 weeks later, ends 12 weeks later
  const TOTAL = NEW.start + NEW.days;
  const STATIONS = [
    [11.2, "Adorf"], [15.85, "Bstadt Hbf"], [19.4, "Cdorf"], [24.1, "Dhausen"],
    [28.75, "Eberg Pbf"], [33.3, "Fheim"], [38.6, "Gburg"],
  ];

  // ---- Random Activities over the whole master timespan (identical in both Plans) ----
  const acts = [];
  for (let i = 0; i < 520; i++) {
    const [trade, color] = pick(TRADES);
    const t0 = Math.floor(between(-10, TOTAL - 5));
    const kind = rand() < 0.62 ? "line" : "stripe";
    const ka = round(between(KM0 + 0.5, KM1 - 4), 0.05);
    if (kind === "line") {
      const dur = Math.floor(between(4, 60));
      const kb = rand() < 0.2 ? ka : round(Math.min(KM1 - 0.5, ka + between(-1.5, 4)), 0.05);
      acts.push({ kind, trade, color, t0, t1: t0 + dur, ka, kb, feet: rand() < 0.35, label: `${pick(OBJECTS)} ${pick(VERBS)}` });
    } else {
      const dur = Math.floor(between(5, 40));
      acts.push({
        kind, trade, color, t0, t1: t0 + dur, ka, kb: round(ka + between(-1, 3), 0.05), w: round(between(0.3, 2), 0.05),
        feet: rand() < 0.2, label: `${pick(OBJECTS)} ${pick(VERBS)}`,
      });
    }
  }
  // Closures ("Sperrungen"): slanted red-hatched zones over a wide km range.
  for (let i = 0; i < 60; i++) {
    const t0 = Math.floor(between(-3, TOTAL - 3));
    const ka = round(between(KM0 + 0.5, KM1 - 9), 0.1);
    acts.push({ kind: "closure", color: RED, t0, t1: t0 + Math.floor(between(2, 6)), ka, kb: ka + round(between(-0.5, 1), 0.05), w: round(between(2, 8), 0.1), label: `Sperrung Gl. ${1 + Math.floor(rand() * 2)}` });
  }

  // ---- Planted changes (master coordinates, all well inside the overlap) -------------
  const ob = TRADES[0][1], ol = TRADES[1][1], kt = TRADES[2][1], ls = TRADES[3][1], ib = TRADES[4][1], we = TRADES[5][1];
  const planted = [
    {
      id: "D1", what: "Line Activity with feet moved 3 days later (30 mm)",
      old: { kind: "line", color: ob, t0: 150, t1: 190, ka: 12.4, kb: 15.6, feet: true, label: "Gleis 1 erneuern" },
      new: { kind: "line", color: ob, t0: 153, t1: 193, ka: 12.4, kb: 15.6, feet: true, label: "Gleis 1 erneuern" },
    },
    {
      id: "D2", what: "Hatched stripe moved 0.5 km towards higher km (18.3 mm)",
      old: { kind: "stripe", color: ol, t0: 300, t1: 330, ka: 21.0, kb: 22.5, w: 1.2, label: "Mast umbauen" },
      new: { kind: "stripe", color: ol, t0: 300, t1: 330, ka: 21.5, kb: 23.0, w: 1.2, label: "Mast umbauen" },
    },
    {
      id: "D3", what: "Line Activity with feet moved 1 day earlier (10 mm), the smallest move",
      old: { kind: "line", color: kt, t0: 452, t1: 470, ka: 30.0, kb: 31.2, feet: true, label: "Kabeltrog herstellen" },
      new: { kind: "line", color: kt, t0: 451, t1: 469, ka: 30.0, kb: 31.2, feet: true, label: "Kabeltrog herstellen" },
    },
    {
      id: "D4", what: "Hatched stripe extended: ends 7 days later (start unchanged)",
      old: { kind: "stripe", color: ib, t0: 600, t1: 625, ka: 26.0, kb: 26.0, w: 0.6, label: "EÜ Dhausen herstellen" },
      new: { kind: "stripe", color: ib, t0: 600, t1: 632, ka: 26.0, kb: 26.0, w: 0.6, label: "EÜ Dhausen herstellen" },
    },
    {
      id: "D5", what: "Activity label text changed (verb): 'Gleis 2 umbauen' -> 'Gleis 2 erneuern'",
      old: { kind: "line", color: ob, t0: 760, t1: 800, ka: 16.5, kb: 20.0, label: "Gleis 2 umbauen" },
      new: { kind: "line", color: ob, t0: 760, t1: 800, ka: 16.5, kb: 20.0, label: "Gleis 2 erneuern" },
      labelOnly: true,
    },
    {
      id: "D6", what: "Activity label text changed (two digits swapped): 'Weiche km 34,450' -> 'Weiche km 34,540'",
      old: { kind: "stripe", color: we, t0: 905, t1: 915, ka: 34.4, kb: 34.4, w: 0.15, label: `Weiche km ${fmtKm(34.45)}` },
      new: { kind: "stripe", color: we, t0: 905, t1: 915, ka: 34.4, kb: 34.4, w: 0.15, label: `Weiche km ${fmtKm(34.54)}` },
      labelOnly: true,
    },
    {
      id: "D7", what: "Activity added (New Plan only)",
      old: null,
      new: { kind: "line", color: ls, t0: 1040, t1: 1075, ka: 13.0, kb: 17.5, feet: true, label: "Signal einbauen" },
    },
    {
      id: "D8", what: "Activity removed (Old Plan only)",
      old: { kind: "stripe", color: kt, t0: 1150, t1: 1180, ka: 36.0, kb: 37.5, w: 0.8, label: "Kabeltrog rückbauen" },
      new: null,
    },
    {
      id: "D9", what: "Closure zone (red hatch) moved 2 days later (20 mm)",
      old: { kind: "closure", color: RED, t0: 1250, t1: 1254, ka: 20.0, kb: 20.6, w: 6.0, label: "Sperrung Gl. 2" },
      new: { kind: "closure", color: RED, t0: 1252, t1: 1256, ka: 20.0, kb: 20.6, w: 6.0, label: "Sperrung Gl. 2" },
    },
  ];

  function draw(plan, version) {
    const bodyLen = plan.days * DAY;
    const H = HEADER + bodyLen + FOOTER;
    const p = makePage(W, H);
    const DY = (d) => HEADER + (d - plan.start) * DAY; // master day -> y mm
    const isNew = version === "new";
    p.rgb([1, 1, 1], false);
    p.rectFill(0, 0, W, H);

    // ---- Header (not compared; "Stand" and "Index" differ) ----
    p.rgb([0, 0, 0], false);
    p.text("F2", 32, 10, 22, "Bauablaufplan ABS Musterstadt - Weg-Zeit-Diagramm (synthetisch)");
    p.text("F1", 12, 10, 36, isNew ? "Stand: 22.02.2027  Index d  Fortschreibung" : "Stand: 03.11.2026  Index c");
    p.rgb([0, 0, 0], true);
    p.lw(0.35);
    for (const [km, name] of STATIONS) {
      p.rectStroke(KX(km) - 22, 62, 44, 22);
      p.text("F2", 10, KX(km) - 20, 76, name);
      p.text("F1", 7, KX(km) - 20, 82, `km ${fmtKm(km)}`);
    }
    p.lw(0.5);
    p.line(0, HEADER, W, HEADER);
    p.line(TIMECOL, HEADER - 40, TIMECOL, HEADER);
    p.text("F2", 9, 4, HEADER - 26, "Zeit");
    p.text("F2", 9, KX(KM0) + 2, HEADER - 44, "Strecke 1234 Musterstadt - Gburg, Bahn-km");
    for (let km100 = KM0 * 10; km100 <= KM1 * 10; km100++) {
      const xx = KX(km100 / 10);
      const full = km100 % 10 === 0;
      p.lw(full ? 0.35 : 0.12);
      p.line(xx, HEADER - (full ? 14 : 5), xx, HEADER);
      if (full) p.text("F1", 9, xx - 5, HEADER - 18, `${km100 / 10},0`);
      else if (km100 % 5 === 0) p.text("F1", 5, xx - 2, HEADER - 7, `,${km100 % 10}`);
    }

    // ---- Body (the only part compared) ----
    p.clip(0, HEADER, W, bodyLen);
    for (let d = plan.start; d < plan.start + plan.days; d++) {
      const y = DY(d);
      const date = dateOf(DAY0, d);
      const wd = d % 7; // 0 = Monday
      if (wd >= 5) {
        p.rgb([0.94, 0.94, 0.94], false);
        p.rectFill(TIMECOL, y, KX(KM1) - TIMECOL, DAY);
      }
      // day lines, drawn per km like verbose exporters do
      p.rgb([0.85, 0.85, 0.85], true);
      p.lw(0.08);
      for (let km = KM0; km < KM1; km++) p.line(KX(km), y, KX(km + 1), y);
      p.rgb([0, 0, 0], false);
      p.text("F1", 6, 62, y + 7, `${["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"][wd]} ${date.getUTCDate()}`);
      if (wd === 0) {
        p.rgb([0.3, 0.3, 0.3], true);
        p.lw(0.25);
        p.line(0, y, KX(KM1), y);
        p.text("F2", 8, 3, y + 8, `KW ${String(isoWeek(date)).padStart(2, "0")}`);
        p.text("F1", 7, 3, y + 16, dmy(date));
        // km grid, drawn per week block
        p.rgb([0.7, 0.7, 0.7], true);
        p.lw(0.1);
        for (let km = KM0; km <= KM1; km++) p.line(KX(km), y, KX(km), y + 7 * DAY);
      }
      if (date.getUTCDate() === 1) {
        p.rgb([0, 0, 0], true);
        p.lw(0.6);
        p.line(0, y, KX(KM1), y);
        p.text("F2", 9, 30, y + 8, `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`);
      }
    }
    p.rgb([0, 0, 0], true);
    p.lw(0.35);
    p.line(TIMECOL, HEADER, TIMECOL, HEADER + bodyLen);
    // station lines: one long line each, so their length differs between the Plans
    // dashed, so their dash phase starts at each Body's top: after the Offset the dashes
    // of Old and New no longer coincide (a control, see ground truth)
    p.rgb([0.2, 0.2, 0.2], true);
    p.lw(0.3);
    p.dash(4, 1.5);
    for (const [km] of STATIONS) p.line(KX(km), HEADER, KX(km), HEADER + bodyLen);
    p.dash(0);

    // Activities: drawn whole when they touch the Body, clipped at its edges.
    const visible = (a) => a.t1 + 3 >= plan.start && a.t0 - 3 <= plan.start + plan.days;
    const drawAct = (a) => {
      const y0 = DY(a.t0), y1 = DY(a.t1);
      let shape;
      if (a.kind === "line") {
        p.rgb(a.color, true);
        p.lw(0.6);
        p.line(KX(a.ka), y0, KX(a.kb), y1);
        shape = grow(box(KX(a.ka), y0, KX(a.kb), y1), 0.3);
      } else {
        const pts = [[KX(a.ka), y0], [KX(a.ka + a.w), y0], [KX(a.kb + a.w), y1], [KX(a.kb), y1]];
        const closure = a.kind === "closure";
        // each area gets its own pattern whose origin moves with the area
        const pat = p.hatch(a.color, closure ? 2.5 : 1.5, pts[0], closure ? 0.2 : 0.12);
        p.fillPattern(pat, pts);
        p.rgb(a.color, true);
        p.lw(closure ? 0.4 : 0.25);
        p.poly(pts, "S");
        shape = grow(union(...pts.map(([x, y]) => box(x, y, x, y))), 0.2);
      }
      let feet = null;
      if (a.feet) {
        // staging area at start and end: a short block across the km range
        const light = a.color.map((c) => 1 - (1 - c) * 0.4);
        const footW = 14, footH = 2 * DAY;
        const fa = [KX(a.ka) - footW / 2, y0 - footH], fb = [KX(a.kb) - footW / 2, y1];
        for (const [fx, fy] of [fa, fb]) {
          p.rgb(light, false);
          p.rectFill(fx, fy, footW, footH);
          p.rgb(a.color, true);
          p.lw(0.25);
          p.rectStroke(fx, fy, footW, footH);
        }
        feet = grow(union(box(fa[0], fa[1], fa[0] + footW, fa[1] + footH), box(fb[0], fb[1], fb[0] + footW, fb[1] + footH)), 0.15);
      }
      p.rgb(a.kind === "closure" ? RED : [0, 0, 0], false);
      const lx = Math.max(KX(a.ka), KX(a.kb)) + (a.kind === "line" ? 2 : KX(a.w + KM0) - KX(KM0) + 2);
      const label = p.text("F1", 7, lx, (y0 + y1) / 2 + 1, a.label);
      return { shape: union(shape, feet), label };
    };
    for (const a of acts) if (visible(a)) drawAct(a);
    const boxes = {};
    for (const c of planted) {
      const a = c[version];
      if (a) boxes[c.id] = drawAct(a);
    }
    p.unclip();
    p.rgb([0, 0, 0], true);
    p.lw(0.5);
    p.line(0, HEADER + bodyLen, W, HEADER + bodyLen);

    // ---- Footer (not compared; moves with the end of the Body, its text differs) ----
    const fy = HEADER + bodyLen;
    p.rgb([0, 0, 0], false);
    p.text("F2", 12, 10, fy + 16, "Legende");
    TRADES.forEach(([name, color], i) => {
      const ly = fy + 30 + i * 12;
      p.rgb(color, true);
      p.lw(0.6);
      p.line(10, ly, 40, ly - 6);
      p.rgb([0, 0, 0], false);
      p.text("F1", 9, 46, ly - 1, name);
    });
    {
      const pts = [[150, fy + 30], [175, fy + 30], [185, fy + 50], [160, fy + 50]];
      p.fillPattern(p.hatch(TRADES[0][1], 1.5, pts[0]), pts);
      p.rgb([0, 0, 0], false);
      p.text("F1", 9, 192, fy + 43, "Bauabschnitt mit Bereich (schraffiert)");
      const cl = [[150, fy + 60], [185, fy + 60], [190, fy + 72], [155, fy + 72]];
      p.fillPattern(p.hatch(RED, 2.5, cl[0], 0.2), cl);
      p.rgb([0, 0, 0], false);
      p.text("F1", 9, 196, fy + 69, "Sperrung");
      p.rgb([0.5, 0.65, 0.85], false);
      p.rectFill(150, fy + 82, 14, 8);
      p.rgb([0, 0, 0], false);
      p.text("F1", 9, 170, fy + 89, "Baustelleneinrichtung (Fuß)");
    }
    // stamp
    const sx = W - 420, sw = 410;
    p.rgb([0, 0, 0], true);
    p.lw(0.5);
    p.rectStroke(sx, fy + 10, sw, FOOTER - 20);
    p.rgb([0, 0, 0], false);
    p.text("F2", 14, sx + 6, fy + 26, "ABS Musterstadt - Gburg");
    p.text("F1", 10, sx + 6, fy + 40, "Planinhalt: Bauablaufplan, Weg-Zeit-Diagramm");
    p.text("F1", 10, sx + 6, fy + 52, `Zeitraum: ${dmy(dateOf(DAY0, plan.start))} - ${dmy(dateOf(DAY0, plan.start + plan.days - 1))}`);
    p.text("F1", 10, sx + 6, fy + 64, `Maßstab: Zeit 1 Tag = ${DAY} mm, Weg 1 km = ${r2(KX(KM0 + 1) - KX(KM0))} mm`);
    const revs = [["a", "12.05.2026", "Erstausgabe"], ["b", "30.07.2026", "Bauphasen angepasst"], ["c", "03.11.2026", "Sperrpausen eingearbeitet"]];
    if (isNew) revs.push(["d", "22.02.2027", "Fortschreibung, Zeitraum verschoben"]);
    p.text("F2", 9, sx + 6, fy + 84, "Index   Datum         Änderung");
    revs.forEach(([idx, date, what], i) => p.text("F1", 9, sx + 6, fy + 96 + i * 10, `${idx}          ${date}    ${what}`));
    p.text("F2", 11, sx + 6, fy + FOOTER - 20, isNew ? "Index d" : "Index c");

    return { p, boxes, header: [0, HEADER], body: [HEADER, HEADER + bodyLen], footer: [HEADER + bodyLen, H] };
  }

  const old = draw(OLD, "old");
  const neu = draw(NEW, "new");
  const offsetMm = (NEW.start - OLD.start) * DAY; // New Body moves down by this to lie on the Old Body
  const changes = planted.map((c) => {
    const pickBox = (v) => {
      const b = (v === "old" ? old : neu).boxes[c.id];
      return b ? roundBox(c.labelOnly ? b.label : union(b.shape, b.label)) : null;
    };
    const d = [];
    if (c.old) d.push({ kind: "Removed", plan: "old", boxMm: pickBox("old") });
    if (c.new) d.push({ kind: "Added", plan: "new", boxMm: pickBox("new") });
    return { id: c.id, what: c.what, differences: d, place: placeOf(c) };
  });
  /**
   * The Place each change must come out as. This pair draws no Activity in one go (no white
   * underlay under its hatches), so its Places are grouped by nearness (ADR 0005). A line
   * Activity's label is set far from its line, without a leader: it is a Place of its own
   * (labelPlace), named by its own text. Other labels are named only when they sit beside
   * the shape (within 3 mm); else the Place is named by its shape. Wann and Wo come from the
   * shape as drawn, feet included (the New one first).
   */
  function placeOf(c) {
    const KIND = {
      D1: ["later", [], "3 Tage"], D2: ["movedAcross", ["labelMoved"], "500 m"], D3: ["earlier", [], "1 Tag"],
      D4: ["longer", ["labelMoved"], "7 Tage"], D5: ["textChanged", []], D6: ["textChanged", []], D7: ["new", []],
      D8: ["gone", []], D9: ["later", ["labelMoved"], "2 Tage"],
    }[c.id];
    const a = c.new ?? c.old, place = { kind: KIND[0], kinds: [KIND[0], ...KIND[1]], ...(KIND[2] ? { um: KIND[2] } : {}) };
    if (c.labelOnly) return { ...place, name: c.new.label, oldName: c.old.label, nameFrom: "text" };
    const feet = a.feet ? 2 : 0, footKm = a.feet ? 7 / (KX(KM0 + 1) - KX(KM0)) : 0;
    // Wo is read from the Header's km numbers, which stand left of their ticks (their middle
    // 1.9 mm before it): so the km read are that much higher than the ticks say.
    const read = (5 - textWidthMm("F1", 9, "10,0") / 2) / (KX(KM0 + 1) - KX(KM0));
    const lo = Math.min(a.ka, a.kb) - footKm + read, hi = Math.max(a.ka, a.kb) + (a.w ?? 0) + footKm + read;
    Object.assign(place, {
      // D4: the nearest text beside its New shape is a closure's label lying on its extension
      // (a random neighbour), nearer than its own label 2 mm off: rule 2 takes the nearest.
      name: c.id === "D4" ? "Sperrung Gl. 2" : null,
      ...(c.id === "D4" ? { nameFrom: "beside" } : { shape: a.kind === "line" ? "Linie" : "Schraffur" }),
      wann: wannText(DAY0, a.t0 - feet, a.t1 - 1 + feet),
      wo: `km ${km1(lo)}–${km1(hi)}`,
    });
    if (a.kind === "line") place.labelPlace = { kind: c.new && c.old ? "labelMoved" : c.new ? "new" : "gone", name: a.label, nameFrom: "text" };
    return place;
  }
  const controls = [
    {
      id: "C1", what: `Unchanged dashed station lines (x ${STATIONS.map(([km]) => r2(KX(km))).join(", ")} mm): one line each over the whole Body, dash phase starting at the Body's top, so after the Offset the dashes are out of phase by Offset mod period (${offsetMm} mm mod 5.5 mm = ${r2(offsetMm % 5.5)} mm) and the objects differ in length. Not a Difference.`,
    },
    {
      id: "C2", what: "Unchanged hatched stripes and closures: each has its own pattern whose origin (/Matrix) is at the area's corner, so the hatch phase moves with the area. Not a Difference.",
    },
    {
      id: "C3", what: "Activities crossing a Body edge are drawn whole and clipped there, so the same Activity is a different-length object in Old and New. Not a Difference.",
    },
    {
      id: "C4", what: "Occlusion: the feet are opaque, so moving them (D1, D3) hides or reveals ink beneath. Such raster Differences lie within the union of that change's Removed and Added boxes and belong to that change.",
    },
  ];
  return {
    name: "down", timeDirection: "down", old, neu, offsetMm, changes, controls,
    describe: (plan, version, r) => ({
      file: r.file, bytes: r.bytes, drawingOps: r.ops,
      pageMm: [W, r2(plan.p.hMm)], userUnit: plan.p.userUnit,
      headerMm: plan.header, bodyMm: plan.body.map(r2), footerMm: plan.footer.map(r2),
      timespan: `${dmy(dateOf(DAY0, (version === "old" ? OLD : NEW).start))} - ${dmy(dateOf(DAY0, (version === "old" ? OLD : NEW).start + (version === "old" ? OLD : NEW).days - 1))}`,
    }),
    overhang: {
      oldOnlyMm: [HEADER, HEADER + offsetMm],
      newOnlyMm: [HEADER + (OLD.start + OLD.days - NEW.start) * DAY, HEADER + NEW.days * DAY],
      note: "Old: Body start to start+Offset (first 8 weeks) has no counterpart; New: last 12 weeks have none.",
    },
  };
}

// =====================================================================================
// Pair 2: Time direction right (small classic bar chart)
// =====================================================================================
function rightPair() {
  const HEADER = 130; // task table at the left
  const FOOTER = 100; // legend and stamp at the right
  const WEEK = 12; // mm per week
  const AXIS = 30; // time axis at the Body's top edge
  const ROW = 8;
  const ROWS = 20;
  const H = AXIS + ROWS * ROW + 20;
  const DAY0 = new Date(Date.UTC(2027, 2, 1)); // master week 0 starts on a Monday
  const OLD = { start: 0, weeks: 30 };
  const NEW = { start: 3, weeks: 32 }; // starts 3 weeks later, ends 5 weeks later
  const TOTAL = NEW.start + NEW.weeks;
  const PLANTED_ROWS = [2, 6, 10, 14, 17];

  const tasks = [];
  for (let r = 0; r < ROWS; r++) {
    const [trade, color] = pick(TRADES);
    const name = `${pick(OBJECTS)} ${pick(VERBS)}`;
    const bars = [];
    if (!PLANTED_ROWS.includes(r)) {
      let w = Math.floor(between(-2, 8));
      while (w < TOTAL) {
        const dur = Math.round(between(1.5, 7) * 7) / 7;
        if (rand() < 0.12) bars.push({ kind: "milestone", w });
        else bars.push({ kind: "bar", w0: w, w1: w + dur, label: rand() < 0.5 ? `${Math.round(dur * 5)} AT` : "" });
        w += dur + between(2, 10);
      }
    }
    tasks.push({ trade, color, name, bars });
  }
  const t = (r) => tasks[r].color;
  const planted = [
    {
      id: "R1", what: "Bar moved 1 week later (12 mm)", row: PLANTED_ROWS[0],
      old: { kind: "bar", w0: 8, w1: 12, label: "20 AT" },
      new: { kind: "bar", w0: 9, w1: 13, label: "20 AT" },
    },
    {
      id: "R2", what: "Bar label text changed: 'Abnahme 15 AT' -> 'Abnahme 18 AT'", row: PLANTED_ROWS[1], labelOnly: true,
      old: { kind: "bar", w0: 14, w1: 17, label: "Abnahme 15 AT" },
      new: { kind: "bar", w0: 14, w1: 17, label: "Abnahme 18 AT" },
    },
    { id: "R3", what: "Bar added (New Plan only)", row: PLANTED_ROWS[2], old: null, new: { kind: "bar", w0: 20, w1: 23.4, label: "Nachtrag" } },
    { id: "R4", what: "Milestone removed (Old Plan only)", row: PLANTED_ROWS[3], old: { kind: "milestone", w: 11 }, new: null },
    {
      id: "C5", what: "Unchanged hatched bar whose pattern has no /Matrix, so its phase is tied to the page: after the Offset the hatch lines are out of phase with the bar by Offset mod cell (36 mm mod 1.4 mm = 1.0 mm). Not a Difference.",
      row: PLANTED_ROWS[4], control: true,
      old: { kind: "bar", w0: 16, w1: 24, label: "Sperrung", hatchPage: true },
      new: { kind: "bar", w0: 16, w1: 24, label: "Sperrung", hatchPage: true },
    },
  ];

  function draw(plan, version) {
    const bodyLen = plan.weeks * WEEK;
    const W = HEADER + bodyLen + FOOTER;
    const p = makePage(W, H);
    const WX = (w) => HEADER + (w - plan.start) * WEEK;
    const RY = (r) => AXIS + r * ROW;
    const isNew = version === "new";
    p.rgb([1, 1, 1], false);
    p.rectFill(0, 0, W, H);

    // ---- Header: title + task table (not compared; one task name differs) ----
    p.rgb([0, 0, 0], false);
    p.text("F2", 11, 4, 9, "Terminplan Musterbahnhof");
    p.text("F1", 7, 4, 16, isNew ? "Stand: 22.03.2027  Index 4" : "Stand: 01.03.2027  Index 3");
    p.text("F2", 7, 4, AXIS - 2, "Nr.");
    p.text("F2", 7, 16, AXIS - 2, "Vorgang");
    p.rgb([0.4, 0.4, 0.4], true);
    p.lw(0.15);
    tasks.forEach((task, r) => {
      p.rectStroke(0, RY(r), 12, ROW);
      p.rectStroke(12, RY(r), HEADER - 12, ROW);
      p.rgb([0, 0, 0], false);
      p.text("F1", 7, 2, RY(r) + 5.6, String(r + 1));
      p.text("F1", 7, 14, RY(r) + 5.6, isNew && r === 4 ? `${task.name} (geändert)` : task.name);
      p.rgb([0.4, 0.4, 0.4], true);
    });

    // ---- Body ----
    p.clip(HEADER, 0, bodyLen, H);
    for (let w = plan.start; w < plan.start + plan.weeks; w++) {
      const x = WX(w);
      const date = dateOf(DAY0, w * 7);
      if (w % 2) {
        p.rgb([0.95, 0.95, 0.95], false);
        p.rectFill(x, AXIS, WEEK, ROWS * ROW);
      }
      p.rgb([0.7, 0.7, 0.7], true);
      p.lw(0.1);
      p.line(x, AXIS - 10, x, AXIS + ROWS * ROW);
      p.rgb([0, 0, 0], false);
      p.text("F1", 6, x + 1, AXIS - 3, `KW ${isoWeek(date)}`);
      if (date.getUTCDate() <= 7) {
        p.rgb([0, 0, 0], true);
        p.lw(0.35);
        p.line(x, AXIS - 20, x, AXIS);
        p.rgb([0, 0, 0], false);
        p.text("F2", 7, x + 1, AXIS - 13, `${MON[date.getUTCMonth()]} ${date.getUTCFullYear()}`);
      }
    }
    p.rgb([0.85, 0.85, 0.85], true);
    p.lw(0.1);
    for (let r = 0; r <= ROWS; r++) p.line(HEADER, RY(r), HEADER + bodyLen, RY(r));
    const drawBar = (r, b) => {
      const color = t(r);
      const y = RY(r);
      if (b.kind === "milestone") {
        const cx = WX(b.w), cy = y + ROW / 2, s = 2.2;
        p.rgb([0, 0, 0], false);
        p.poly([[cx, cy - s], [cx + s, cy], [cx, cy + s], [cx - s, cy]], "f");
        return { shape: box(cx - s, cy - s, cx + s, cy + s), label: null };
      }
      const x0 = WX(b.w0), x1 = WX(b.w1);
      if (b.hatchPage) {
        p.fillPattern(p.hatch(RED, 1.4, null), [[x0, y + 1.5], [x1, y + 1.5], [x1, y + ROW - 1.5], [x0, y + ROW - 1.5]]);
        p.rgb(RED, true);
      } else {
        p.rgb(color, false);
        p.rectFill(x0, y + 1.5, x1 - x0, ROW - 3);
        p.rgb([0, 0, 0], true);
      }
      p.lw(0.12);
      p.rectStroke(x0, y + 1.5, x1 - x0, ROW - 3);
      p.rgb([0, 0, 0], false);
      const label = b.label ? p.text("F1", 6, x1 + 1.5, y + 5.4, b.label) : null;
      return { shape: grow(box(x0, y + 1.5, x1, y + ROW - 1.5), 0.1), label };
    };
    tasks.forEach((task, r) => task.bars.forEach((b) => drawBar(r, b)));
    const boxes = {};
    for (const c of planted) if (c[version]) boxes[c.id] = drawBar(c.row, c[version]);
    p.unclip();
    p.rgb([0, 0, 0], true);
    p.lw(0.35);
    p.line(HEADER, 0, HEADER, H);
    p.line(HEADER + bodyLen, 0, HEADER + bodyLen, H);

    // ---- Footer: legend + stamp (not compared; moves with the end of the Body) ----
    const fx = HEADER + bodyLen;
    p.rgb([0, 0, 0], false);
    p.text("F2", 9, fx + 4, 10, "Legende");
    TRADES.forEach(([name, color], i) => {
      p.rgb(color, false);
      p.rectFill(fx + 4, 16 + i * 8, 10, 4);
      p.rgb([0, 0, 0], false);
      p.text("F1", 7, fx + 17, 19.6 + i * 8, name);
    });
    p.rgb([0, 0, 0], true);
    p.lw(0.35);
    p.rectStroke(fx + 4, H - 80, FOOTER - 8, 74);
    p.rgb([0, 0, 0], false);
    p.text("F2", 9, fx + 7, H - 70, "Musterbahnhof, Umbau");
    p.text("F1", 7, fx + 7, H - 60, "Terminplan Bauphasen");
    p.text("F1", 7, fx + 7, H - 50, `Zeitraum: ${dmy(dateOf(DAY0, plan.start * 7))} -`);
    p.text("F1", 7, fx + 7, H - 43, `${dmy(dateOf(DAY0, (plan.start + plan.weeks) * 7 - 1))}`);
    p.text("F2", 9, fx + 7, H - 14, isNew ? "Index 4" : "Index 3");

    return { p, boxes, header: [0, HEADER], body: [HEADER, HEADER + bodyLen], footer: [HEADER + bodyLen, W] };
  }

  const old = draw(OLD, "old");
  const neu = draw(NEW, "new");
  const offsetMm = (NEW.start - OLD.start) * WEEK; // New Body moves right by this to lie on the Old Body
  const pickBox = (c, v) => {
    const b = (v === "old" ? old : neu).boxes[c.id];
    return b ? roundBox(c.labelOnly ? b.label : union(b.shape, b.label)) : null;
  };
  const changes = planted.filter((c) => !c.control).map((c) => {
    const d = [];
    if (c.old) d.push({ kind: "Removed", plan: "old", boxMm: pickBox(c, "old") });
    if (c.new) d.push({ kind: "Added", plan: "new", boxMm: pickBox(c, "new") });
    return { id: c.id, what: c.what, differences: d, place: placeOf(c) };
  });
  /**
   * The Place each change must come out as: on a bar chart it is named by its row in the
   * Header; the text by the bar is a note (ADR 0006). Grouped by nearness (no Activities
   * drawn in one go), so a bar's label beside it belongs to its Place.
   */
  function placeOf(c) {
    const base = { name: tasks[c.row].name, nameFrom: "row" };
    if (c.id === "R1") return { ...base, kind: "later", kinds: ["later", "labelMoved"], note: "20 AT", wann: wannText(DAY0, 9 * 7, 13 * 7 - 1), um: "7 Tage" };
    if (c.id === "R2") return { ...base, kind: "textChanged", kinds: ["textChanged"], note: "Abnahme 18 AT" };
    if (c.id === "R3") return { ...base, kind: "new", kinds: ["new"], note: "Nachtrag", wann: wannText(DAY0, 20 * 7, 163) }; // its end is 0.34 mm before a day boundary: on it (ADR 0006)
    return { ...base, kind: "gone", kinds: ["gone"], shape: "Raute", wann: wannText(DAY0, 11 * 7, 11 * 7) };
  }
  const controls = [
    ...planted.filter((c) => c.control).map((c) => ({ id: c.id, what: c.what, boxMm: { old: pickBox(c, "old"), new: pickBox(c, "new") } })),
    { id: "C6", what: "Header: task 5's name differs ('... (geändert)'); Header is not compared. Not a Difference." },
  ];
  return {
    name: "right", timeDirection: "right", old, neu, offsetMm, changes, controls,
    describe: (plan, version, r) => ({
      file: r.file, bytes: r.bytes, drawingOps: r.ops,
      pageMm: [r2(plan.p.wMm), H], userUnit: plan.p.userUnit,
      headerMm: plan.header, bodyMm: plan.body.map(r2), footerMm: plan.footer.map(r2),
      timespan: `${dmy(dateOf(DAY0, (version === "old" ? OLD : NEW).start * 7))} - ${dmy(dateOf(DAY0, ((version === "old" ? OLD : NEW).start + (version === "old" ? OLD : NEW).weeks) * 7 - 1))}`,
    }),
    overhang: {
      oldOnlyMm: [HEADER, HEADER + offsetMm],
      newOnlyMm: [HEADER + (OLD.start + OLD.weeks - NEW.start) * WEEK, HEADER + NEW.weeks * WEEK],
      note: "Old: first 3 weeks have no counterpart; New: last 5 weeks have none.",
    },
  };
}

// =====================================================================================
// Pair 3: Activities drawn in one go (time down, small), for Places (ADR 0005, 0006, 0008)
// =====================================================================================
// Drawn as the Plan software draws a time-distance diagram: each Activity in one go (a white
// underlay, its hatch, the outline, a centre line for a line Activity, hatched feet, then its
// label: a white background per line, the text in the Activity's colour, a short leader).
// km markers are drawn in their own black pass, free notes in black. The km scale changes
// per section (squeezed on open track, stretched in the station), read from upright labels
// in the Header; dates stand in a date column, hours in an hour strip (the axis zones).
// Fully deterministic, no random numbers: the other two pairs stay as they are.
function activityPair() {
  const W = 700, HEADER = 120, FOOTER = 40, DAY = 48; // 2 mm per hour
  const DAY0 = new Date(Date.UTC(2027, 0, 4)); // master day 0, a Monday
  const OLD = { start: 0, days: 20 }, NEW = { start: 1, days: 20 }; // New starts a day later
  // km across, piecewise: open track 50 mm per km, the station (km 12–13) 200 mm per km
  const SECTIONS = [[10, 60], [12, 160], [13, 360], [18, 610]];
  const KX = (km) => {
    for (let i = 1; i < SECTIONS.length; i++) {
      const [k0, x0] = SECTIONS[i - 1], [k1, x1] = SECTIONS[i];
      if (km <= k1 || i === SECTIONS.length - 1) return x0 + ((km - k0) * (x1 - x0)) / (k1 - k0);
    }
  };
  const KM_MARKS = [10, 10.5, 11, 11.5, 12, 12.25, 12.5, 12.75, 13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17, 17.5, 18];
  const [gb, ol, kt, ls, ib, we] = TRADES.map(([, c]) => c);
  const BLUE = [0.1, 0.2, 0.9];

  // Planted changes, master days (fractions are hours) and km.
  const H = 1 / 24;
  const planted = [
    {
      id: "A1", what: "Line Activity with feet and its km marker moved 8 hours later",
      old: { line: true, color: gb, t0: 3, t1: 5, ka: 10.4, kb: 11.6, feet: true, label: ["Gleis 1 erneuern"], marker: "km 10,4 + 0" },
      new: { line: true, color: gb, t0: 3 + 8 * H, t1: 5 + 8 * H, ka: 10.4, kb: 11.6, feet: true, label: ["Gleis 1 erneuern"], marker: "km 10,4 + 0" },
      place: { kind: "later", kinds: ["later", "labelMoved"], um: "8 Std." },
    },
    {
      id: "A2", what: "Hatched stripe moved 0.5 km across (open track)",
      old: { color: ol, t0: 6, t1: 8, ka: 14.0, kb: 14.0, w: 0.6, label: ["Mast umbauen"] },
      new: { color: ol, t0: 6, t1: 8, ka: 14.5, kb: 14.5, w: 0.6, label: ["Mast umbauen"] },
      place: { kind: "movedAcross", kinds: ["movedAcross", "labelMoved"], um: "500 m" },
    },
    {
      id: "A3", what: "Hatched stripe with a two-line label extended by 1 day 6 hours (label at its start, unchanged)",
      old: { color: ib, t0: 9, t1: 11, ka: 15.5, kb: 15.5, w: 0.5, label: ["Gleis 2 erneuern", "mit Schotter"] },
      new: { color: ib, t0: 9, t1: 12.25, ka: 15.5, kb: 15.5, w: 0.5, label: ["Gleis 2 erneuern", "mit Schotter"] },
      place: { kind: "longer", kinds: ["longer"], um: "1 Tag 6 Std." },
    },
    {
      id: "A4", what: "Line Activity label text changed: 'Kabeltrog herstellen' -> 'Kabeltrog verlegen'",
      old: { line: true, color: kt, t0: 12, t1: 14, ka: 16.5, kb: 17.5, label: ["Kabeltrog herstellen"] },
      new: { line: true, color: kt, t0: 12, t1: 14, ka: 16.5, kb: 17.5, label: ["Kabeltrog verlegen"] },
      labelOnly: true,
      place: { kind: "textChanged", kinds: ["textChanged"], oldName: "Kabeltrog herstellen" },
    },
    {
      id: "A5", what: "Label moved to the other side of its Activity (shape unchanged)",
      old: { color: we, t0: 15, t1: 17, ka: 10.5, kb: 10.8, w: 0.4, label: ["Weiche einbauen"] },
      new: { color: we, t0: 15, t1: 17, ka: 10.5, kb: 10.8, w: 0.4, label: ["Weiche einbauen"], labelLeft: true },
      labelOnly: true,
      place: { kind: "labelMoved", kinds: ["labelMoved"] },
    },
    {
      id: "A6", what: "Activity recoloured (hatch, outline and label)",
      old: { color: ls, t0: 2, t1: 4, ka: 15.5, kb: 16.0, w: 0.5, label: ["Signal prüfen"] },
      new: { color: BLUE, t0: 2, t1: 4, ka: 15.5, kb: 16.0, w: 0.5, label: ["Signal prüfen"] },
      restyleOnly: true,
      place: { kind: "recoloured", kinds: ["recoloured"] },
    },
    {
      id: "A7", what: "Outline drawn thicker (0.25 -> 0.4 mm), same colour",
      old: { color: kt, t0: 12, t1: 14, ka: 12.2, kb: 12.5, w: 0.15, label: ["Bahnsteig erneuern"] },
      new: { color: kt, t0: 12, t1: 14, ka: 12.2, kb: 12.5, w: 0.15, label: ["Bahnsteig erneuern"], outline: 0.4 },
      restyleOnly: true,
      place: { kind: "lineWidth", kinds: ["lineWidth"] },
    },
    {
      id: "A8", what: "Line Activity added (New Plan only)",
      old: null,
      new: { line: true, color: ls, t0: 16, t1: 18, ka: 15.0, kb: 17.0, label: ["Signal einbauen"] },
      place: { kind: "new", kinds: ["new"] },
    },
    {
      id: "A9", what: "Hatched stripe removed (Old Plan only); its corner touches A10's",
      old: { color: kt, t0: 6, t1: 8, ka: 16.8, kb: 16.8, w: 0.4, label: ["Kabeltrog rückbauen"] },
      new: null,
      place: { kind: "gone", kinds: ["gone"] },
    },
    {
      id: "A10", what: "Hatched stripe extended by 1 day and recoloured; it starts at A9's corner",
      old: { color: kt, t0: 8, t1: 9, ka: 17.2, kb: 17.2, w: 0.3, label: ["Kabeltrog verlegen"] },
      new: { color: BLUE, t0: 8, t1: 10, ka: 17.2, kb: 17.2, w: 0.3, label: ["Kabeltrog verlegen"] },
      place: { kind: "longer", kinds: ["longer", "recoloured"], um: "1 Tag" },
    },
    {
      id: "A11", what: "Free note over two lines added (black, outside any Activity)",
      old: null,
      new: { note: ["Achtung: Sperrpause", "beachten"], x: 620, t: 14.5 },
      place: { kind: "new", kinds: ["new"], name: "Achtung: Sperrpause beachten", nameFrom: "text" },
    },
    {
      id: "A12", what: "Unlabelled hatched stripe added",
      old: null,
      new: { color: ib, t0: 18, t1: 19, ka: 13.5, kb: 13.5, w: 1.0, label: [] },
      place: { kind: "new", kinds: ["new"], name: null, shape: "Schraffur" },
    },
  ];
  // Unchanged Activities around them, some touching the planted ones.
  const still = [
    { color: ol, t0: 8, t1: 10, ka: 14.0, kb: 14.0, w: 0.6, label: ["Mast prüfen"] }, // follows A2's old corner
    { color: gb, t0: 1, t1: 19, ka: 11.8, kb: 11.8, w: 0.1, label: ["Gleis 3 sperren"] }, // long, crosses all
    { line: true, color: ib, t0: 0, t1: 3, ka: 13.2, kb: 14.2, label: ["EÜ prüfen"] }, // crosses the Body start
    { color: we, t0: 18.5, t1: 21, ka: 16.0, kb: 16.5, w: 0.3, label: ["Weiche prüfen"] }, // crosses the Body end
  ];

  function draw(plan, version) {
    const bodyLen = plan.days * DAY, Hp = HEADER + bodyLen + FOOTER;
    const p = makePage(W, Hp);
    const DY = (d) => HEADER + (d - plan.start) * DAY;
    p.rgb([1, 1, 1], false);
    p.rectFill(0, 0, W, Hp);
    // ---- Header: title, upright km labels at the marks (no plain number row) ----
    p.rgb([0, 0, 0], false);
    p.text("F2", 14, 10, 14, "Bauablaufplan Musterbahnhof (synthetisch)");
    p.text("F1", 9, 10, 22, version === "new" ? "Stand: Index b" : "Stand: Index a");
    p.rgb([0, 0, 0], true);
    p.lw(0.35);
    for (const km of KM_MARKS) {
      const a = Math.floor(km * 10 + 1e-9) / 10, m = Math.round((km - a) * 1000);
      const s = `${["Bf", "Bü", "Mast", "EÜ"][Math.round(km * 4) % 4]} km ${a.toFixed(1).replace(".", ",")} + ${m}`;
      p.line(KX(km), HEADER - 8, KX(km), HEADER);
      p.rgb([0, 0, 0], false);
      p.textUp("F1", 7, KX(km) + 0.25 * 7 * PT_MM, HEADER - 10, s); // centred across its mark
    }
    p.lw(0.5);
    p.line(0, HEADER, W, HEADER);
    // ---- Body ----
    p.clip(0, HEADER, W, bodyLen);
    for (let d = plan.start; d < plan.start + plan.days; d++) {
      const y = DY(d), date = dateOf(DAY0, d);
      p.rgb([0.3, 0.3, 0.3], true);
      p.lw(0.25);
      p.line(0, y, W - 10, y);
      p.rgb([0.8, 0.8, 0.8], true);
      p.lw(0.08);
      for (const h of [6, 12, 18]) p.line(26, y + h * 2, W - 10, y + h * 2);
      p.rgb([0, 0, 0], false);
      p.text("F1", 6, 4, y + 5, `${["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"][d % 7]} ${dmy(date)}`);
      // hour labels just above their line
      for (const h of [6, 12, 18, 24]) p.text("F1", 5, 30, y + h * 2 - 0.6, String(h));
    }
    p.rgb([0.7, 0.7, 0.7], true);
    p.lw(0.1);
    for (const km of [10, 11, 12, 13, 14, 15, 16, 17, 18]) p.line(KX(km), HEADER, KX(km), HEADER + bodyLen);

    const boxes = {};
    const drawAct = (a) => {
      const y0 = DY(a.t0), y1 = DY(a.t1), half = 0.4;
      const pts = a.line
        ? [[KX(a.ka) - half, y0], [KX(a.ka) + half, y0], [KX(a.kb) + half, y1], [KX(a.kb) - half, y1]]
        : [[KX(a.ka), y0], [KX(a.ka + a.w), y0], [KX(a.kb + a.w), y1], [KX(a.kb), y1]];
      p.rgb([1, 1, 1], false);
      p.poly(pts, "f");
      p.fillPattern(p.hatch(a.color, a.line ? 0.6 : 1.5, pts[0], 0.12), pts);
      p.rgb(a.color, true);
      p.lw(a.outline ?? (a.line ? 0.1 : 0.25));
      p.poly(pts, "S");
      if (a.line) {
        p.lw(0.6);
        p.line(KX(a.ka), y0, KX(a.kb), y1);
      }
      let shape = grow(union(...pts.map(([x, y]) => box(x, y, x, y))), 0.3);
      if (a.feet) {
        const fw = 10, fh = 6;
        for (const [fx, fy] of [[KX(a.ka) - fw / 2, y0 - fh], [KX(a.kb) - fw / 2, y1]]) {
          const fp = [[fx, fy], [fx + fw, fy], [fx + fw, fy + fh], [fx, fy + fh]];
          p.fillPattern(p.hatch(a.color, 1, fp[0], 0.1), fp);
          p.rgb(a.color, true);
          p.lw(0.25);
          p.rectStroke(fx, fy, fw, fh);
          shape = union(shape, grow(box(fx, fy, fx + fw, fy + fh), 0.15));
        }
      }
      let label = null;
      if (a.label.length) {
        // near its start, beside the shape (right, or left), with a short leader
        const ly = y0 + 4;
        const right = pts[1][0] + ((pts[2][0] - pts[1][0]) * (ly - y0)) / (y1 - y0);
        const left = pts[0][0] + ((pts[3][0] - pts[0][0]) * (ly - y0)) / (y1 - y0);
        const wMax = Math.max(...a.label.map((s) => textWidthMm("F1", 7, s)));
        const lx = a.labelLeft ? left - 3 - wMax : right + 3;
        const col = a.labelColor ?? a.color;
        a.label.forEach((s, i) => {
          const by = ly + 1 + i * 2.8;
          const tb = box(lx, by - 0.72 * 7 * PT_MM, lx + textWidthMm("F1", 7, s), by + 0.22 * 7 * PT_MM);
          const bg = grow(tb, 0.3);
          p.rgb([1, 1, 1], false);
          p.rectFill(bg.x0, bg.y0, bg.x1 - bg.x0, bg.y1 - bg.y0);
          p.rgb(col, false);
          p.text("F1", 7, lx, by, s);
          label = union(label, bg);
        });
        p.rgb(a.color, true);
        p.lw(0.12);
        if (a.labelLeft) p.line(left, ly, label.x1, ly);
        else p.line(right, ly, label.x0, ly);
        label = grow(label, 0.1);
      }
      return { shape, label };
    };
    for (const a of still) drawAct(a);
    for (const c of planted) {
      const a = c[version];
      if (a && !a.note) boxes[c.id] = drawAct(a);
    }
    // km markers: their own black pass, a tick and the text beside the Activity's start
    p.rgb([0, 0, 0], true);
    for (const c of planted) {
      const a = c[version];
      if (!a?.marker) continue;
      const x = KX(a.ka) - 8, y = DY(a.t0) + 10;
      p.lw(0.15);
      p.line(x, y, x + 6, y);
      p.rgb([0, 0, 0], false);
      const mb = p.text("F1", 5, x - textWidthMm("F1", 5, a.marker) - 1, y + 0.8, a.marker);
      boxes[c.id].marker = grow(union(mb, box(x, y, x + 6, y)), 0.2);
      p.rgb([0, 0, 0], true);
    }
    // free notes in black
    for (const c of planted) {
      const a = c[version];
      if (!a?.note) continue;
      let nb = null;
      a.note.forEach((s, i) => {
        p.rgb([0, 0, 0], false);
        nb = union(nb, p.text("F1", 7, a.x, DY(a.t) + i * 2.8, s));
      });
      boxes[c.id] = { shape: null, label: grow(nb, 0.2) };
    }
    p.unclip();
    p.rgb([0, 0, 0], true);
    p.lw(0.5);
    p.line(0, HEADER + bodyLen, W, HEADER + bodyLen);
    p.rgb([0, 0, 0], false);
    p.text("F1", 9, 10, HEADER + bodyLen + 14, version === "new" ? "Index b" : "Index a");
    return { p, boxes, header: [0, HEADER], body: [HEADER, HEADER + bodyLen], footer: [HEADER + bodyLen, Hp] };
  }

  const old = draw(OLD, "old"), neu = draw(NEW, "new");
  const offsetMm = (NEW.start - OLD.start) * DAY;
  const kmText = (lo, hi) => `km ${km1(lo)}–${km1(hi)}`;
  const kmOf = (x) => {
    for (let i = 1; i < SECTIONS.length; i++) {
      const [k0, x0] = SECTIONS[i - 1], [k1, x1] = SECTIONS[i];
      if (x <= x1 || i === SECTIONS.length - 1) return k0 + ((x - x0) * (k1 - k0)) / (x1 - x0);
    }
  };
  const changes = planted.map((c) => {
    const pick = (v) => {
      const b = (v === "old" ? old : neu).boxes[c.id];
      if (!b) return null;
      return roundBox(c.labelOnly ? b.label : union(b.shape, b.label, b.marker));
    };
    const d = [];
    if (c.old && !c.restyleOnly) d.push({ kind: "Removed", plan: "old", boxMm: pick("old") });
    if (c.new) d.push({ kind: "Added", plan: "new", boxMm: pick("new") });
    const a = c.new ?? c.old, place = { ...c.place };
    if (!a.note) {
      // named by its Activity's label (read whole), placed by its shape (the New one first)
      if (!("name" in place)) place.name = a.label.join(" ");
      const x0 = a.line ? KX(Math.min(a.ka, a.kb)) - 0.4 : KX(Math.min(a.ka, a.kb)), x1 = a.line ? KX(Math.max(a.ka, a.kb)) + 0.4 : KX(Math.max(a.ka, a.kb) + a.w);
      place.wo = kmText(kmOf(x0), kmOf(x1));
      const frac = (t) => Math.abs(t - Math.round(t)) > 1e-9;
      place.wann = frac(a.t0) || frac(a.t1)
        ? `${dmy(dateOf(DAY0, Math.floor(a.t0))).slice(0, 6)} ${String(Math.round((a.t0 % 1) * 24)).padStart(2, "0")}:00 – ${dmy(dateOf(DAY0, Math.floor(a.t1)))} ${String(Math.round((a.t1 % 1) * 24)).padStart(2, "0")}:00`
        : wannText(DAY0, a.t0, a.t1 - 1);
    }
    return { id: c.id, what: c.what, differences: d, place };
  });
  return {
    name: "activities", timeDirection: "down", old, neu, offsetMm, changes,
    controls: [
      { id: "C7", what: "A9 and A10 touch corner to corner (and A2's old shape touches an unchanged Activity): nearness would join them; the drawing order keeps them apart. Two Places, not one." },
      { id: "C8", what: "Unchanged Activities crossing the Body's start and end, and a long one crossing all planted changes: no Place." },
    ],
    describe: (plan, version, r) => ({
      file: r.file, bytes: r.bytes, drawingOps: r.ops,
      pageMm: [W, r2(plan.p.hMm)], userUnit: plan.p.userUnit,
      headerMm: plan.header, bodyMm: plan.body.map(r2), footerMm: plan.footer.map(r2),
      timespan: `${dmy(dateOf(DAY0, (version === "old" ? OLD : NEW).start))} - ${dmy(dateOf(DAY0, (version === "old" ? OLD : NEW).start + (version === "old" ? OLD : NEW).days - 1))}`,
      // the Zeitachse zones (step 2): the date column and the hour strip
      axisZonesMm: { time: [{ x0: 2, y0: plan.body[0], x1: 24, y1: plan.body[1] }, { x0: 28, y0: plan.body[0], x1: 36, y1: plan.body[1] }] },
    }),
    overhang: {
      oldOnlyMm: [HEADER, HEADER + offsetMm],
      newOnlyMm: [HEADER + (OLD.start + OLD.days - NEW.start) * DAY, HEADER + NEW.days * DAY],
      note: "Old: the first day has no counterpart; New: the last day has none.",
    },
  };
}

// =====================================================================================
// Pair 4: dense (time down, 14 m), for measuring the comparison view with many marks
// =====================================================================================
// Drawn like the activities pair (each Activity in one go: white underlay, hatch, outline,
// centre line, a label on a white background with a leader), but thousands of them over a
// 14 m Body, and a good part changed in the New Plan: moved later or earlier, longer,
// relabelled, removed, added. Its own random numbers, so the other pairs stay as they are.
function densePair() {
  let s = 4711;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const pk = (arr) => arr[Math.floor(rnd() * arr.length)];
  const btw = (a, b) => a + rnd() * (b - a);
  const W = 1189, HEADER = 150, FOOTER = 120, DAY = 10;
  const KM0 = 10, KM1 = 40, TIMECOL = 60;
  const KX = (km) => TIMECOL + ((km - KM0) * (W - TIMECOL - 10)) / (KM1 - KM0);
  const DAY0 = new Date(Date.UTC(2027, 0, 4));
  const OLD = { start: 0, days: 1330 }, NEW = { start: 14, days: 1330 };
  const TOTAL = NEW.start + NEW.days;
  const N = Number(process.env.DENSE_ACTIVITIES || 4000);
  const acts = [];
  for (let i = 0; i < N; i++) {
    const [, color] = pk(TRADES);
    const line = rnd() < 0.7;
    const t0 = Math.floor(btw(OLD.start + NEW.start + 5, OLD.start + OLD.days - 60));
    const ka = btw(KM0 + 0.3, KM1 - 3);
    const a = line
      ? { line, color, t0, t1: t0 + Math.floor(btw(3, 40)), ka, kb: Math.min(KM1 - 0.3, ka + btw(-1, 2.5)), w: 0, label: `${pk(OBJECTS)} ${pk(VERBS)}` }
      : { line, color, t0, t1: t0 + Math.floor(btw(3, 25)), ka, kb: ka + btw(-0.5, 1.5), w: btw(0.2, 1), label: `${pk(OBJECTS)} ${pk(VERBS)}` };
    // As on a full real schedule: a second label line (km range and track), hatched feet, and
    // week ticks along the Activity, so that each Place has a few more marks.
    a.note = `km ${fmtKm(a.ka)} – ${fmtKm(a.kb)} Gl. ${1 + Math.floor(rnd() * 3)} ${pk(TRADES)[0]}`;
    a.feet = rnd() < 0.6;
    const r = rnd();
    // About a third changed: moved, longer, relabelled, removed; and some added.
    const nu =
      r < 0.08 ? { ...a, t0: a.t0 + 2, t1: a.t1 + 2 }
      : r < 0.14 ? { ...a, t0: a.t0 - 1, t1: a.t1 - 1 }
      : r < 0.2 ? { ...a, t1: a.t1 + 3 }
      : r < 0.26 ? { ...a, label: `${a.label} (neu)` }
      : r < 0.3 ? null
      : a;
    acts.push({ old: r < 0.97 ? a : null, new: r < 0.97 ? nu : { ...a } });
  }

  function draw(plan, version) {
    const bodyLen = plan.days * DAY, Hp = HEADER + bodyLen + FOOTER;
    const p = makePage(W, Hp);
    const DY = (d) => HEADER + (d - plan.start) * DAY;
    p.rgb([1, 1, 1], false);
    p.rectFill(0, 0, W, Hp);
    p.rgb([0, 0, 0], false);
    p.text("F2", 28, 10, 24, "Bauablaufplan dicht (synthetisch)");
    p.text("F1", 12, 10, 40, version === "new" ? "Stand: Index b" : "Stand: Index a");
    p.rgb([0, 0, 0], true);
    for (let km = KM0; km <= KM1; km++) {
      p.lw(0.35);
      p.line(KX(km), HEADER - 14, KX(km), HEADER);
      p.rgb([0, 0, 0], false);
      p.text("F1", 9, KX(km) - 5, HEADER - 18, `${km},0`);
    }
    p.lw(0.5);
    p.line(0, HEADER, W, HEADER);
    p.clip(0, HEADER, W, bodyLen);
    for (let d = plan.start; d < plan.start + plan.days; d++) {
      const y = DY(d);
      if (d % 7 === 0) {
        p.rgb([0.3, 0.3, 0.3], true);
        p.lw(0.25);
        p.line(0, y, W - 10, y);
        p.rgb([0, 0, 0], false);
        p.text("F1", 7, 4, y + 6, `KW ${String(isoWeek(dateOf(DAY0, d))).padStart(2, "0")} ${dmy(dateOf(DAY0, d))}`);
      }
    }
    p.rgb([0.7, 0.7, 0.7], true);
    p.lw(0.1);
    for (let km = KM0; km <= KM1; km++) p.line(KX(km), HEADER, KX(km), HEADER + bodyLen);
    const drawAct = (a) => {
      const y0 = DY(a.t0), y1 = DY(a.t1), half = 0.4;
      const pts = a.line
        ? [[KX(a.ka) - half, y0], [KX(a.ka) + half, y0], [KX(a.kb) + half, y1], [KX(a.kb) - half, y1]]
        : [[KX(a.ka), y0], [KX(a.ka + a.w), y0], [KX(a.kb + a.w), y1], [KX(a.kb), y1]];
      p.rgb([1, 1, 1], false);
      p.poly(pts, "f");
      p.fillPattern(p.hatch(a.color, a.line ? 1 : 2.5, pts[0], 0.12), pts);
      p.rgb(a.color, true);
      p.lw(a.line ? 0.1 : 0.25);
      p.poly(pts, "S");
      if (a.line) {
        p.lw(0.6);
        p.line(KX(a.ka), y0, KX(a.kb), y1);
      }
      // week ticks across the Activity
      p.lw(0.15);
      for (let d = a.t0 + 7; d < a.t1; d += 7) {
        const f = (d - a.t0) / (a.t1 - a.t0), x = KX(a.ka + (a.kb - a.ka) * f);
        p.line(x - 1.5, DY(d), x + 1.5, DY(d));
      }
      if (a.feet) {
        const fw = 10, fh = 2 * DAY;
        for (const [fx, fy] of [[KX(a.ka) - fw / 2, y0 - fh], [KX(a.kb) - fw / 2, y1]]) {
          const fp = [[fx, fy], [fx + fw, fy], [fx + fw, fy + fh], [fx, fy + fh]];
          p.fillPattern(p.hatch(a.color, 1.5, fp[0], 0.1), fp);
          p.rgb(a.color, true);
          p.lw(0.25);
          p.rectStroke(fx, fy, fw, fh);
        }
      }
      const ly = y0 + 4;
      const right = pts[1][0] + ((pts[2][0] - pts[1][0]) * (ly - y0)) / (y1 - y0);
      const lx = right + 3;
      let first = null;
      [a.label, a.note].forEach((s, i) => {
        const by = ly + 1 + i * 2.8;
        const tb = grow(box(lx, by - 0.72 * 7 * PT_MM, lx + textWidthMm("F1", 7, s), by + 0.22 * 7 * PT_MM), 0.3);
        first ??= tb;
        p.rgb([1, 1, 1], false);
        p.rectFill(tb.x0, tb.y0, tb.x1 - tb.x0, tb.y1 - tb.y0);
        p.rgb(a.color, false);
        p.text("F1", 7, lx, by, s);
      });
      p.rgb(a.color, true);
      p.lw(0.12);
      p.line(right, ly, first.x0, ly);
    };
    for (const a of acts) if (a[version]) drawAct(a[version]);
    p.unclip();
    p.rgb([0, 0, 0], true);
    p.lw(0.5);
    p.line(0, HEADER + bodyLen, W, HEADER + bodyLen);
    p.rgb([0, 0, 0], false);
    p.text("F1", 12, 10, HEADER + bodyLen + 20, version === "new" ? "Index b" : "Index a");
    return { p, header: [0, HEADER], body: [HEADER, HEADER + bodyLen], footer: [HEADER + bodyLen, Hp] };
  }
  return { name: "dense", old: draw(OLD, "old"), neu: draw(NEW, "new"), offsetMm: (NEW.start - OLD.start) * DAY, changed: acts.filter((a) => a.old !== a.new).length, total: acts.length };
}

// ---- Write everything ------------------------------------------------------------
mkdirSync("samples", { recursive: true });
const truth = {
  generator: "scripts/make-sample-plans.mjs",
  coordinates: "page mm, origin top-left of each Plan's own page; boxes are approximate (text boxes from font metrics)",
  offsetMeaning: "Move the New Plan's Body this far along the Time direction (down or right) and it lies exactly on the Old Plan's Body: oldPos = newPos + offsetMm",
  changesMeaning: "Planted changes in the overlap of the Bodies; each lists the Differences it must produce (Removed in the Old Plan, Added in the New Plan)",
  controlsMeaning: "Things that look different but are not Differences: detection must not report them",
  ignore: [
    "Header and Footer differ on purpose (Stand, Index, revision rows, period): not compared",
    "Overhang content: not compared",
  ],
  pairs: [],
};
// The activities pair comes last and draws no random numbers, so the other two stay as they were.
for (const pair of [downPair(), rightPair(), activityPair()]) {
  const ro = savePage(pair.old.p, `samples/${pair.name}-old.pdf`);
  const rn = savePage(pair.neu.p, `samples/${pair.name}-new.pdf`);
  truth.pairs.push({
    name: pair.name,
    timeDirection: pair.timeDirection,
    old: pair.describe(pair.old, "old", ro),
    new: pair.describe(pair.neu, "new", rn),
    offsetMm: pair.offsetMm,
    overhangMm: pair.overhang,
    changes: pair.changes,
    controls: pair.controls,
  });
  for (const [r, plan] of [[ro, pair.old], [rn, pair.neu]])
    console.log(`${r.file}: ${(r.bytes / 1e6).toFixed(2)} MB, ${r2(plan.p.wMm)} x ${r2(plan.p.hMm)} mm, UserUnit ${r2(plan.p.userUnit * 1e4) / 1e4}, ${r.ops} drawing ops`);
  console.log(`  ${pair.name}: Offset ${pair.offsetMm} mm, ${pair.changes.length} planted changes`);
}
// The dense pair is for measuring only: written, not in the ground truth.
{
  const pair = densePair();
  for (const [plan, v] of [[pair.old, "old"], [pair.neu, "new"]]) {
    const r = savePage(plan.p, `samples/${pair.name}-${v}.pdf`);
    console.log(`${r.file}: ${(r.bytes / 1e6).toFixed(2)} MB, ${r2(plan.p.wMm)} x ${r2(plan.p.hMm)} mm, UserUnit ${r2(plan.p.userUnit * 1e4) / 1e4}, ${r.ops} drawing ops`);
  }
  console.log(`  ${pair.name}: Offset ${pair.offsetMm} mm, ${pair.changed} of ${pair.total} Activities changed (not in the ground truth)`);
}
writeFileSync("samples/ground-truth.json", JSON.stringify(truth, null, 2) + "\n");
console.log("samples/ground-truth.json");
