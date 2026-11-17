// PROTOTYPE (throwaway) for "Which Difference detection holds up on the synthetic pair?".
// Runs object matching and tolerant raster diff on the synthetic pairs (npm run samples),
// scores them against samples/ground-truth.json and writes samples/detection-report.html.
//
//   npm run proto:detection            (both pairs)
//   npm run proto:detection -- right   (one pair)
import * as mupdf from "mupdf";
import fs from "node:fs";
import { K, extractObjects } from "./extract.mjs";
import {
  placeObjects, matchObjects, refineOffset, objectDifferences, rasterDiff, cellComponents, mergeBoxes, score,
} from "./detect.mjs";

const BYEYE_ERROR = 0.4; // mm: how far a by-eye Offset is assumed off
const RASTER_PX_PER_MM = 4;
const gt = JSON.parse(fs.readFileSync("samples/ground-truth.json", "utf8"));
const only = process.argv[2];
const now = () => performance.now();
const ms = (t) => Math.round(now() - t);

// ---------- MuPDF ----------

function loadPlan(file) {
  const doc = mupdf.Document.openDocument(fs.readFileSync(file), "application/pdf");
  const page = doc.loadPage(0);
  const t0 = now();
  const dl = page.toDisplayList();
  return { doc, page, dl, displayListMs: ms(t0) };
}

// ---------- MuPDF: render ----------

/** Render a rect of the Old frame (mm) of a Plan whose page is shifted by `shift` mm along the Time direction. */
function renderGray(dl, rect, axis, shift, s) {
  const w = Math.round((rect.x1 - rect.x0) * s), h = Math.round((rect.y1 - rect.y0) * s);
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, w, h], false);
  pix.clear(255);
  const dx = axis === "x" ? shift : 0, dy = axis === "y" ? shift : 0;
  const dev = new mupdf.DrawDevice([K * s, 0, 0, K * s, (dx - rect.x0) * s, (dy - rect.y0) * s], pix);
  dl.run(dev, mupdf.Matrix.identity);
  dev.close();
  const out = Uint8Array.from(pix.getPixels());
  dev.destroy(); pix.destroy();
  return { px: out, w, h };
}

function cropPNG(dl, rect, maxW = 460, maxH = 560) {
  const s = Math.max(0.4, Math.min(12, maxW / (rect.x1 - rect.x0), maxH / (rect.y1 - rect.y0)));
  const w = Math.max(1, Math.round((rect.x1 - rect.x0) * s)), h = Math.max(1, Math.round((rect.y1 - rect.y0) * s));
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, w, h], false);
  pix.clear(255);
  const dev = new mupdf.DrawDevice([K * s, 0, 0, K * s, -rect.x0 * s, -rect.y0 * s], pix);
  dl.run(dev, mupdf.Matrix.identity);
  dev.close();
  const png = Buffer.from(pix.asPNG()).toString("base64");
  dev.destroy(); pix.destroy();
  return { src: `data:image/png;base64,${png}`, rect };
}

// ---------- scenarios ----------

function windowFor(pair, offset) {
  const o = pair.old.bodyMm, n = pair.new.bodyMm;
  // 0.5 mm in from each edge: a Body's border line is not comparable content.
  return [Math.max(o[0], n[0] + offset) + 0.5, Math.min(o[1], n[1] + offset) - 0.5];
}

function runObjects(pair, P, offsetUsed, refine, textUnit = "word") {
  const axis = pair.timeDirection === "down" ? "y" : "x";
  const timings = {};
  let offset = offsetUsed, refined = null;
  if (refine) {
    const t0 = now();
    refined = refineOffset(P.oldObjs, P.newObjs, { axis, guess: offsetUsed, range: 5 });
    offset = refined.offset;
    timings.refine = ms(t0);
  }
  const win = windowFor(pair, offset);
  let t0 = now();
  const oldP = placeObjects(P.oldObjs, { axis, shift: 0, win });
  const newP = placeObjects(P.newObjs, { axis, shift: offset, win });
  timings.place = ms(t0);
  t0 = now();
  const m = matchObjects(oldP, newP, 0.05);
  timings.match = ms(t0);
  t0 = now();
  const rem = objectDifferences(m.oldUnmatched, oldP, { textUnit });
  const add = objectDifferences(m.newUnmatched, newP, { textUnit });
  timings.group = ms(t0);
  const back = (b) => (axis === "y" ? { ...b, y0: b.y0 - offset, y1: b.y1 - offset } : { ...b, x0: b.x0 - offset, x1: b.x1 - offset });
  return {
    offset, refined, timings,
    detected: { Removed: rem.boxes, Added: add.boxes.map(back) },
    stats: { objectsOld: oldP.length, objectsNew: newP.length, unmatchedOld: rem.rawObjects, unmatchedNew: add.rawObjects, changedWords: rem.words + add.words },
  };
}

function runRaster(pair, P, offsetUsed, rPx) {
  const axis = pair.timeDirection === "down" ? "y" : "x";
  const s = RASTER_PX_PER_MM;
  const win = windowFor(pair, offsetUsed);
  const across = Math.max(axis === "y" ? pair.old.pageMm[0] : pair.old.pageMm[1], axis === "y" ? pair.new.pageMm[0] : pair.new.pageMm[1]);
  const len = win[1] - win[0];
  const cw = Math.ceil(axis === "y" ? across : len), ch = Math.ceil(axis === "y" ? len : across); // 1 mm cells, Old frame from (0|win0)
  const cellsRem = new Uint16Array(cw * ch), cellsAdd = new Uint16Array(cw * ch);
  const BAND = 400, M = 2; // mm; margin for the dilation
  let render = 0, diff = 0, inkPx = 0;
  for (let b0 = win[0]; b0 < win[1]; b0 += BAND) {
    const b1 = Math.min(win[1], b0 + BAND);
    const rect = axis === "y" ? { x0: 0, x1: across, y0: b0 - M, y1: b1 + M } : { x0: b0 - M, x1: b1 + M, y0: 0, y1: across };
    let t0 = now();
    const o = renderGray(P.oldDl, rect, axis, 0, s), n = renderGray(P.newDl, rect, axis, offsetUsed, s);
    render += now() - t0; t0 = now();
    const d = rasterDiff(o.px, n.px, o.w, o.h, rPx);
    for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) {
      const i = y * o.w + x;
      if (!d.rem[i] && !d.add[i]) continue;
      const mx = rect.x0 + (x + 0.5) / s, my = rect.y0 + (y + 0.5) / s;
      const tPos = axis === "y" ? my : mx;
      if (tPos < b0 || tPos >= b1) continue; // margin belongs to the neighbour band
      const cx = Math.floor(axis === "y" ? mx : mx - win[0]), cy = Math.floor(axis === "y" ? my - win[0] : my);
      if (cx < 0 || cy < 0 || cx >= cw || cy >= ch) continue;
      if (d.rem[i]) cellsRem[cy * cw + cx]++;
      if (d.add[i]) cellsAdd[cy * cw + cx]++;
      inkPx++;
    }
    diff += now() - t0;
  }
  const toMm = (c) => (axis === "y" ? { x0: c.x0, x1: c.x1, y0: c.y0 + win[0], y1: c.y1 + win[0] } : { x0: c.x0 + win[0], x1: c.x1 + win[0], y0: c.y0, y1: c.y1 });
  let t0 = now();
  const rem = mergeBoxes(cellComponents(cellsRem, cw, ch).map(toMm), 1);
  const add = mergeBoxes(cellComponents(cellsAdd, cw, ch).map(toMm), 1);
  const group = ms(t0);
  const back = (b) => (axis === "y" ? { ...b, y0: b.y0 - offsetUsed, y1: b.y1 - offsetUsed } : { ...b, x0: b.x0 - offsetUsed, x1: b.x1 - offsetUsed });
  return {
    offset: offsetUsed, timings: { render: Math.round(render), diff: Math.round(diff), group },
    detected: { Removed: rem, Added: add.map(back) },
    stats: { diffPx: inkPx, mpxPerPlan: +((cw * ch * s * s) / 1e6).toFixed(0) },
  };
}

const SCENARIOS = [
  { id: "obj-exact", method: "Objects", label: "Objects, exact Offset", run: (pair, P) => runObjects(pair, P, pair.offsetMm, false) },
  { id: "obj-span", method: "Objects", label: "Objects, exact Offset, changed text as whole label", run: (pair, P) => runObjects(pair, P, pair.offsetMm, false, "span") },
  { id: "obj-eye", method: "Objects", label: `Objects, by-eye Offset (${BYEYE_ERROR} mm off)`, run: (pair, P) => runObjects(pair, P, pair.offsetMm + BYEYE_ERROR, false) },
  { id: "obj-refined", method: "Objects", label: `Objects, by-eye Offset auto-refined`, run: (pair, P) => runObjects(pair, P, pair.offsetMm + BYEYE_ERROR, true) },
  { id: "ras-1", method: "Raster", label: "Raster ±0.25 mm, exact Offset", run: (pair, P) => runRaster(pair, P, pair.offsetMm, 1) },
  { id: "ras-1-eye", method: "Raster", label: `Raster ±0.25 mm, by-eye Offset (${BYEYE_ERROR} mm off)`, run: (pair, P) => runRaster(pair, P, pair.offsetMm + BYEYE_ERROR, 1) },
  { id: "ras-2-eye", method: "Raster", label: `Raster ±0.5 mm, by-eye Offset (${BYEYE_ERROR} mm off)`, run: (pair, P) => runRaster(pair, P, pair.offsetMm + BYEYE_ERROR, 2) },
];

// ---------- main ----------

const report = { generated: new Date().toISOString(), byEyeError: BYEYE_ERROR, scenarios: SCENARIOS.map(({ id, label, method }) => ({ id, label, method })), pairs: [] };

for (const pair of gt.pairs) {
  if (only && pair.name !== only) continue;
  console.log(`\n== ${pair.name} (time ${pair.timeDirection}, Offset ${pair.offsetMm} mm)`);
  const axis = pair.timeDirection === "down" ? "y" : "x";
  const O = loadPlan(pair.old.file), N = loadPlan(pair.new.file);
  let t0 = now();
  const oldObjs = extractObjects(O.page);
  const extractOld = ms(t0); t0 = now();
  const newObjs = extractObjects(N.page);
  const extractNew = ms(t0);
  console.log(`display list ${O.displayListMs}/${N.displayListMs} ms, extract ${extractOld}/${extractNew} ms, ${oldObjs.length}/${newObjs.length} objects`);
  const P = { oldObjs, newObjs, oldDl: O.dl, newDl: N.dl };

  const results = [];
  for (const sc of SCENARIOS) {
    const t = now();
    const r = sc.run(pair, P);
    r.totalMs = ms(t);
    r.score = score(r.detected, pair.changes, { axis, offsetTrue: pair.offsetMm });
    const fa = r.score.falseAlarms.Removed.length + r.score.falseAlarms.Added.length;
    console.log(`${sc.label.padEnd(48)} found ${r.score.found}/${r.score.total}, false alarms ${fa}, ${r.totalMs} ms ${JSON.stringify(r.timings)}${r.refined ? ` refined → ${r.offset.toFixed(3)} (${r.refined.votes} votes)` : ""}`);
    results.push({ id: sc.id, ...r });
  }

  // Crops: each planted change in both Plans, and a sample of each scenario's false alarms.
  const shiftBox = (b, d) => (axis === "y" ? { ...b, y0: b.y0 + d, y1: b.y1 + d } : { ...b, x0: b.x0 + d, x1: b.x1 + d });
  const grow = (b, m) => ({ x0: b.x0 - m, y0: b.y0 - m, x1: b.x1 + m, y1: b.y1 + m });
  const changes = pair.changes.map((c) => {
    const inOld = c.differences.map((d) => (d.plan === "old" ? d.boxMm : shiftBox(d.boxMm, pair.offsetMm)));
    const u = inOld.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));
    const m = Math.max(4, 0.08 * Math.max(u.x1 - u.x0, u.y1 - u.y0));
    const rectOld = grow(u, m), rectNew = shiftBox(rectOld, -pair.offsetMm);
    return { id: c.id, what: c.what, gt: c.differences, old: cropPNG(O.dl, rectOld), new: cropPNG(N.dl, rectNew) };
  });
  for (const r of results) {
    const fa = [...r.score.falseAlarms.Removed.map((b) => ({ kind: "Removed", b })), ...r.score.falseAlarms.Added.map((b) => ({ kind: "Added", b }))];
    r.faCount = fa.length;
    r.faCrops = fa.slice(0, 8).map(({ kind, b }) => {
      const bo = kind === "Removed" ? b : shiftBox(b, r.offset);
      const rectOld = grow(bo, Math.max(3, 0.3 * Math.max(bo.x1 - bo.x0, bo.y1 - bo.y0)));
      return { kind, old: cropPNG(O.dl, rectOld, 300, 300), new: cropPNG(N.dl, shiftBox(rectOld, -r.offset), 300, 300) };
    });
    delete r.score.falseAlarms;
  }
  report.pairs.push({
    name: pair.name, timeDirection: pair.timeDirection, offsetMm: pair.offsetMm, axis,
    window: windowFor(pair, pair.offsetMm), pageMm: { old: pair.old.pageMm, new: pair.new.pageMm },
    objects: { old: oldObjs.length, new: newObjs.length }, prep: { displayList: [O.displayListMs, N.displayListMs], extract: [extractOld, extractNew] },
    changes, results,
  });
}

const tpl = fs.readFileSync(new URL("./report.html", import.meta.url), "utf8");
fs.writeFileSync("samples/detection-report.html", tpl.replace("/*DATA*/null", () => JSON.stringify(report, (k, v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v))));
console.log("\nwrote samples/detection-report.html");
