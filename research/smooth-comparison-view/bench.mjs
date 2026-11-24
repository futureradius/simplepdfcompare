// RESEARCH (throwaway) for issue #11: rendering costs of the 14 m synthetic pair
// (samples/down-old.pdf, samples/down-new.pdf from `npm run samples`), in Edge.
// run.mjs opens bench.html and calls window.bench(); everything is timed here.
//
// Frame as in the prototype: Old Plan page mm; the New Plan sits 560 mm further down
// (the pair's Offset). Viewport 1600 x 1000 device px (DPR 1). Time runs down.
//
// Sources: "down" (this repo's synthetic pair), "dense" (simplepdfclipper's generated
// Test Plan, copied to samples/sibling-test-plan.pdf, used as both Old and New), or
// "files" (two PDFs picked on the page; only timings and counts are shown).

const VW = 1600, VH = 1000;
let OFFSET = 560, ACROSS = 1189, L_OLD = 13710, L_NEW = 13990;
const SOURCES = {
  down: { "down-old": "/samples/down-old.pdf", "down-new": "/samples/down-new.pdf", offset: 560 },
  dense: { "down-old": "/samples/sibling-test-plan.pdf", "down-new": "/samples/sibling-test-plan.pdf", offset: 0 },
};
let source = "down";
const picked = {};
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const r1 = (v) => Math.round(v * 10) / 10;

function startWorker() {
  const w = new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" });
  let next = 1;
  const pending = new Map();
  const t0 = performance.now();
  const ready = new Promise((res) => {
    w.onmessage = (e) => {
      if (e.data.ready) { res(performance.now() - t0); return; }
      const p = pending.get(e.data.id);
      pending.delete(e.data.id);
      if (e.data.ok) p.res({ ...e.data, rtMs: performance.now() - p.t }); else p.rej(new Error(e.data.error));
    };
  });
  const call = (op, args, transfer = []) => new Promise((res, rej) => { const id = next++; pending.set(id, { res, rej, t: performance.now() }); w.postMessage({ id, op, args }, transfer); });
  return { w, call, ready };
}

const bytesOf = async (f) => {
  if (source === "files") return new Uint8Array(await picked[f === "down-old" ? "old" : "new"].arrayBuffer());
  return new Uint8Array(await (await fetch(SOURCES[source][f])).arrayBuffer());
};

/** Reads both Plans' sizes (page mm) so the views fit whatever is measured. */
async function readSizes() {
  const mupdf = await import("/node_modules/mupdf/dist/mupdf.js");
  const size = async (f) => { const doc = mupdf.Document.openDocument(await bytesOf(f), "application/pdf"); const b = doc.loadPage(0).getBounds(); doc.destroy(); return [(b[2] - b[0]) * 25.4 / 72, (b[3] - b[1]) * 25.4 / 72]; };
  const o = await size("down-old"), n = await size("down-new");
  ACROSS = Math.max(o[0], n[0]); L_OLD = o[1]; L_NEW = n[1];
  OFFSET = source === "files" ? 0 : SOURCES[source].offset;
  return { oldMm: o.map(Math.round), newMm: n.map(Math.round) };
}

/** The views measured, each { label, x0, y0, s }. */
function views() {
  const t0 = 0, t1 = Math.max(L_OLD, L_NEW + OFFSET), cy = L_OLD / 2;
  const whole = Math.min((VW - 40) / ACROSS, (VH - 40) / (t1 - t0));
  const at = (label, s, c = cy) => ({ label, s, x0: ACROSS / 2 - VW / 2 / s, y0: c - VH / 2 / s });
  return [
    { ...at("whole Plan", whole, (t0 + t1) / 2) },
    at("s 0.15", 0.15), at("s 0.3", 0.3), at("s 0.6", 0.6),
    at("Body across", (VW - 40) / ACROSS),
    at("1:1 (3.78)", 96 / 25.4),
    at("s 12", 12),
  ];
}

async function mainThread(out) {
  const mupdf = await import("/node_modules/mupdf/dist/mupdf.js");
  const K = 25.4 / 72, res = {};
  const lists = {};
  for (const [name, f] of [["old", "down-old"], ["new", "down-new"]]) {
    const b = await bytesOf(f);
    const t0 = performance.now();
    const doc = mupdf.Document.openDocument(b, "application/pdf");
    const page = doc.loadPage(0);
    const t1 = performance.now();
    lists[name] = page.toDisplayList(false);
    res[name] = { openMs: r1(t1 - t0), listMs: r1(performance.now() - t1) };
  }
  const gray = (dl, v, shift) => {
    const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, VW, VH], false);
    pix.clear(255);
    const dev = new mupdf.DrawDevice([K * v.s, 0, 0, K * v.s, -v.x0 * v.s, (shift - v.y0) * v.s], pix);
    dl.run(dev, mupdf.Matrix.identity); dev.close(); dev.destroy();
    const px = Uint8Array.from(pix.getPixels()); pix.destroy();
    return px;
  };
  res.renderGrayBoth = {};
  for (const v of views()) {
    const ts = [];
    for (let i = 0; i < 3; i++) { const t0 = performance.now(); gray(lists.old, v, 0); gray(lists.new, v, OFFSET); ts.push(performance.now() - t0); }
    res.renderGrayBoth[v.label] = r1(med(ts));
  }
  out.mainThread = res;
}

async function workers(out) {
  const res = {};
  // One worker holding both Plans (as the sibling holds one).
  const one = startWorker();
  res.workerStartMs = r1(await one.ready);
  res.open = {};
  for (const [name, f] of [["old", "down-old"], ["new", "down-new"]]) {
    const b = await bytesOf(f);
    const r = await one.call("open", { name, bytes: b }, [b.buffer]);
    res.open[name] = { openMs: r1(r.result.openMs), listMs: r1(r.result.listMs), mm: [Math.round(r.result.wMm), Math.round(r.result.hMm)] };
  }
  // Per view: worker render time (RGBA and gray), copy-out, round trip, both Plans one after the other.
  res.perView = {};
  for (const v of views()) {
    const row = {};
    for (const mode of ["rgba", "gray"]) {
      const runs = [], rts = [], copies = [];
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        const a = await one.call("render", { name: "old", ...v, w: VW, h: VH, mode, shift: 0 });
        const b = await one.call("render", { name: "new", ...v, w: VW, h: VH, mode, shift: OFFSET });
        rts.push(performance.now() - t0);
        runs.push(a.result.runMs + b.result.runMs);
        copies.push(a.result.copyMs + b.result.copyMs);
      }
      row[mode] = { renderBothMs: r1(med(runs)), copyOutMs: r1(med(copies)), roundTripBothMs: r1(med(rts)) };
    }
    res.perView[v.label] = { s: Math.round(v.s * 1000) / 1000, ...row };
  }
  // The display-list walk alone: a 16 x 16 px render, deep in the Plan.
  {
    const ts = [];
    for (let i = 0; i < 5; i++) ts.push((await one.call("render", { name: "old", x0: 600, y0: 7000, s: 1.31, w: 16, h: 16 })).result.runMs);
    res.walkOnlyMs = r1(med(ts));
  }
  // Transfer + bitmap: worker RGBA -> ImageData (no copy) -> createImageBitmap, on the main thread.
  {
    const ts = [], tsGray = [];
    for (let i = 0; i < 3; i++) {
      const r = (await one.call("render", { name: "old", ...views()[4], w: VW, h: VH })).result;
      const t0 = performance.now();
      const bmp = await createImageBitmap(new ImageData(new Uint8ClampedArray(r.pixels.buffer), VW, VH));
      ts.push(performance.now() - t0); bmp.close();
      const g = (await one.call("render", { name: "old", ...views()[4], w: VW, h: VH, mode: "gray" })).result.pixels;
      const t1 = performance.now();
      const img = new ImageData(VW, VH), d = img.data;
      for (let j = 0; j < VW * VH; j++) { d[4 * j] = d[4 * j + 1] = d[4 * j + 2] = g[j]; d[4 * j + 3] = 255; }
      const bmp2 = await createImageBitmap(img);
      tsGray.push(performance.now() - t1); bmp2.close();
    }
    res.toBitmapMs = { fromRGBA: r1(med(ts)), fromGrayIncludingExpand: r1(med(tsGray)) };
  }
  // Two workers, one per Plan, rendering in parallel: wall time for both.
  {
    const wo = startWorker(), wn = startWorker();
    await Promise.all([wo.ready, wn.ready]);
    const bo = await bytesOf("down-old"), bn = await bytesOf("down-new");
    await Promise.all([wo.call("open", { name: "old", bytes: bo }, [bo.buffer]), wn.call("open", { name: "new", bytes: bn }, [bn.buffer])]);
    res.twoWorkers = {};
    for (const v of views()) {
      const ts = [];
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        await Promise.all([wo.call("render", { name: "old", ...v, w: VW, h: VH, shift: 0 }), wn.call("render", { name: "new", ...v, w: VW, h: VH, shift: OFFSET })]);
        ts.push(performance.now() - t0);
      }
      res.twoWorkers[v.label] = r1(med(ts));
    }
    wo.w.terminate(); wn.w.terminate();
  }
  // Cached overview / pyramid levels: the whole Plan once, at a few scales.
  res.overview = {};
  for (const s of [0.125, 0.25, 0.5, 1]) {
    const w = Math.round(ACROSS * s), h = Math.round(L_OLD * s);
    const r = await one.call("render", { name: "old", x0: 0, y0: 0, s, w, h });
    const t0 = performance.now();
    const bmp = await createImageBitmap(new ImageData(new Uint8ClampedArray(r.result.pixels.buffer), w, h));
    const bmpMs = performance.now() - t0;
    res.overview["s " + s] = { px: `${w} x ${h}`, mpx: Math.round((w * h) / 1e5) / 10, mb: Math.round((w * h * 4) / 1e5) / 10, renderMs: r1(r.result.runMs), toBitmapMs: r1(bmpMs) };
    bmp.close();
  }
  // Tiles of 512 x 512 px at a few scales (a zoom pyramid's unit of work).
  res.tile512 = {};
  for (const s of [0.5, 1.31, 3.78, 12]) {
    const ts = [];
    for (let i = 0; i < 5; i++) ts.push((await one.call("render", { name: "old", x0: 300 + i * 50, y0: 6000 + i * 400, s, w: 512, h: 512 })).result.runMs);
    const tiles = Math.ceil((ACROSS * s) / 512) * Math.ceil((L_OLD * s) / 512);
    res.tile512["s " + s] = { renderMs: r1(med(ts)), tilesForWholePlan: tiles, wholePlanS: r1((tiles * med(ts)) / 1000) };
  }
  // A list thumbnail (220 x 150 px around a place, ~2 px/mm), rendered in the worker, both Plans.
  {
    const ts = [];
    for (let i = 0; i < 5; i++) {
      const v = { x0: 200 + i * 80, y0: 3000 + i * 1500, s: 2, w: 220, h: 150 };
      const a = await one.call("render", { name: "old", ...v }), b = await one.call("render", { name: "new", ...v, shift: OFFSET });
      ts.push(a.result.runMs + b.result.runMs);
    }
    res.thumbBothInWorkerMs = r1(med(ts));
  }
  // Skipping small objects: census, then a coarse display list without objects < 1 / 3 / 15 mm
  // (15 mm is one device pixel in the whole-Plan view).
  res.census = (await one.call("census", { name: "old" })).result;
  res.census.ms = r1(res.census.ms);
  res.coarse = {};
  for (const cfg of [{ minMm: 1 }, { minMm: 3 }, { minMm: 15 }, { noTiles: true }]) {
    const c = (await one.call("coarse", { name: "old", ...cfg })).result;
    const row = { buildMs: r1(c.ms), kept: c.kept, dropped: c.dropped };
    for (const v of [views()[0], views()[2], views()[4]]) {
      const full = [], co = [];
      for (let i = 0; i < 3; i++) {
        full.push((await one.call("render", { name: "old", ...v, w: VW, h: VH })).result.runMs);
        co.push((await one.call("render", { name: "old", ...v, w: VW, h: VH, list: "coarse" })).result.runMs);
      }
      row[v.label] = { fullMs: r1(med(full)), coarseMs: r1(med(co)) };
    }
    res.coarse[cfg.noTiles ? "hatch patterns dropped" : `< ${cfg.minMm} mm dropped`] = row;
  }
  one.w.terminate();
  out.workers = res;
}

/**
 * Main-thread compositing of cached bitmaps, as a cached-overview viewer would do on every
 * frame while panning: white, Old bitmap, New bitmap with "darken" (= min of the two greys),
 * then a white veil for "Plan blass". Timed with a 1 px read-back to force the GPU to finish,
 * and as frames per second over 60 requestAnimationFrame frames.
 */
async function compositing(out) {
  const one = startWorker();
  await one.ready;
  const bmps = {}, sharp = {};
  const across = views()[4];
  for (const [name, f, shift] of [["old", "down-old", 0], ["new", "down-new", OFFSET]]) {
    const b = await bytesOf(f);
    await one.call("open", { name, bytes: b }, [b.buffer]);
    const s = 0.5, w = Math.round(ACROSS * s), h = Math.round((L_OLD + OFFSET + 300) * s);
    const r = (await one.call("render", { name, x0: 0, y0: 0, s, w, h, shift })).result;
    bmps[name] = { bmp: await createImageBitmap(new ImageData(new Uint8ClampedArray(r.pixels.buffer), w, h)), s, x0: 0, y0: 0 };
    // A sharp layer as the sibling keeps it: the view plus 25 % margin, at the view's scale.
    const mx = VW * 0.25, my = VH * 0.25, sw = Math.round(VW + 2 * mx), sh = Math.round(VH + 2 * my);
    const v = { x0: across.x0 - mx / across.s, y0: across.y0 - my / across.s, s: across.s };
    const q = (await one.call("render", { name, ...v, w: sw, h: sh, shift })).result;
    sharp[name] = { bmp: await createImageBitmap(new ImageData(new Uint8ClampedArray(q.pixels.buffer), sw, sh)), s: v.s, x0: v.x0, y0: v.y0 };
  }
  one.w.terminate();
  const frame = (ctx, layers, v, quality) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, VW, VH);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = quality;
    for (const [i, name] of ["old", "new"].entries()) {
      const { bmp, s, x0, y0 } = layers[name], k = v.s / s;
      ctx.globalCompositeOperation = i ? "darken" : "source-over";
      ctx.drawImage(bmp, (x0 - v.x0) * v.s, (y0 - v.y0) * v.s, bmp.width * k, bmp.height * k);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(255,255,255,.65)"; ctx.fillRect(0, 0, VW, VH);
  };
  const res = {};
  const cases = [
    ["overview 0.5 px/mm, smoothing high", bmps, "high", [views()[0], views()[2], across]],
    ["overview 0.5 px/mm, smoothing low", bmps, "low", [views()[0], views()[2], across]],
    ["sharp layer 1:1 (view + 25 %)", sharp, "low", [across]],
  ];
  for (const [label, layers, quality, vs] of cases) {
    const row = {};
    for (const v of vs) {
      // A fresh canvas each time: read-backs can move a canvas to the CPU in Chromium.
      const c = document.createElement("canvas");
      c.width = VW; c.height = VH; document.body.append(c);
      const ctx = c.getContext("2d");
      let n = 0, js = 0;
      const t0 = performance.now();
      await new Promise((done) => { const step = () => { const t = performance.now(); frame(ctx, layers, { ...v, y0: v.y0 + (n * 2) / v.s }, quality); js += performance.now() - t; if (++n < 90) requestAnimationFrame(step); else done(); }; requestAnimationFrame(step); });
      const fps = Math.round(90000 / (performance.now() - t0));
      const ts = [];
      for (let i = 0; i < 10; i++) { const t = performance.now(); frame(ctx, layers, v, quality); ctx.getImageData(0, 0, 1, 1); ts.push(performance.now() - t); }
      row[v.label] = { rafFps: fps, jsPerFrameMs: r1(js / 90), withReadbackMs: r1(med(ts)) };
      c.remove();
    }
    res[label] = row;
  }
  out.compositing = res;
}

/**
 * The sibling's sharp render after the view rests: visible area plus 25 % on each side,
 * both Plans in two workers at once, at DPR 1 and 1.5 (same css view, more device px).
 * Also the two whole-Plan overviews at 0.5 px/mm, made in parallel when the Plans open.
 */
async function sharp(out) {
  const wo = startWorker(), wn = startWorker();
  await Promise.all([wo.ready, wn.ready]);
  const bo = await bytesOf("down-old"), bn = await bytesOf("down-new");
  await Promise.all([wo.call("open", { name: "old", bytes: bo }, [bo.buffer]), wn.call("open", { name: "new", bytes: bn }, [bn.buffer])]);
  const res = { overviewsBothParallelMs: null, sharpWithMargin: {} };
  {
    const s = 0.5, t0 = performance.now();
    await Promise.all([
      wo.call("render", { name: "old", x0: 0, y0: 0, s, w: Math.round(ACROSS * s), h: Math.round(L_OLD * s) }),
      wn.call("render", { name: "new", x0: 0, y0: 0, s, w: Math.round(ACROSS * s), h: Math.round(L_NEW * s) }),
    ]);
    res.overviewsBothParallelMs = r1(performance.now() - t0);
  }
  for (const dpr of [1, 1.5]) {
    for (const v of views().slice(3)) {
      const s = v.s * dpr, w = Math.round(VW * dpr * 1.5), h = Math.round(VH * dpr * 1.5);
      const x0 = v.x0 - (VW * 0.25) / v.s, y0 = v.y0 - (VH * 0.25) / v.s;
      const ts = [];
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        await Promise.all([wo.call("render", { name: "old", x0, y0, s, w, h }), wn.call("render", { name: "new", x0, y0: y0 - OFFSET, s, w, h })]);
        ts.push(performance.now() - t0);
      }
      res.sharpWithMargin[`DPR ${dpr}, ${v.label}`] = { px: `${w} x ${h}`, bothParallelMs: r1(med(ts)) };
    }
  }
  wo.w.terminate(); wn.w.terminate();
  out.sharp = res;
}

/**
 * Band display lists (worker.mjs bands()): the Old Plan cut along time into n bands; renders
 * walk only the bands they touch. Compared with the full list on the same regions, and
 * checked pixel by pixel against it.
 */
async function bandBench(out) {
  const one = startWorker();
  await one.ready;
  const b = await bytesOf("down-old");
  await one.call("open", { name: "old", bytes: b }, [b.buffer]);
  const res = {};
  const v = views();
  const regions = [
    ["s 0.6, view", { ...v[3], w: VW, h: VH }],
    ["Body across, view", { ...v[4], w: VW, h: VH }],
    ["Body across, view + 25 %", { x0: v[4].x0 - (VW * 0.25) / v[4].s, y0: v[4].y0 - (VH * 0.25) / v[4].s, s: v[4].s, w: VW * 1.5, h: VH * 1.5 }],
    ["1:1, view", { ...v[5], w: VW, h: VH }],
    ["thumbnail 220 x 150 at 2 px/mm", { x0: 400, y0: L_OLD * 0.4, s: 2, w: 220, h: 150 }],
  ];
  for (const n of [14, 28]) {
    const built = (await one.call("bands", { name: "old", n })).result;
    const row = { buildMs: r1(built.ms), structureCalls: built.structureCalls, objectsPerBandMedian: med(built.perBand), objectsPerBandMax: Math.max(...built.perBand) };
    for (const [label, r] of regions) {
      const full = [], band = [];
      let used = 0;
      for (let i = 0; i < 3; i++) {
        full.push((await one.call("render", { name: "old", ...r })).result.runMs);
        const q = (await one.call("renderBands", { name: "old", ...r })).result;
        band.push(q.runMs); used = q.bandsUsed;
      }
      row[label] = { fullMs: r1(med(full)), bandsMs: r1(med(band)), bandsUsed: used };
    }
    row.pixelCheck = (await one.call("sameAsFull", { name: "old", ...regions[1][1] })).result;
    res[`${n} bands`] = row;
  }
  one.w.terminate();
  out.bands = res;
}

window.bench = async (which = ["mainThread", "workers", "compositing", "sharp", "bands"], src = "down") => {
  source = src;
  const out = { source, ua: navigator.userAgent, hw: navigator.hardwareConcurrency, viewport: `${VW} x ${VH} device px` };
  out.sizes = await readSizes();
  if (which.includes("sharp")) await sharp(out);
  if (which.includes("mainThread")) await mainThread(out);
  if (which.includes("workers")) await workers(out);
  if (which.includes("compositing")) await compositing(out);
  if (which.includes("bands")) await bandBench(out);
  return out;
};

document.getElementById("go").onclick = async () => {
  picked.old = document.getElementById("old").files[0];
  picked.new = document.getElementById("new").files[0];
  const pre = document.getElementById("out");
  if (!picked.old || !picked.new) { pre.textContent = "Pick both PDFs first."; return; }
  pre.textContent = "measuring… (about a minute)";
  pre.textContent = JSON.stringify(await window.bench(["workers", "sharp"], "files"), null, 1);
};
