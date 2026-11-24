// RESEARCH (throwaway) for issue #11: a MuPDF engine in a module Web Worker, like
// simplepdfclipper's src/engine/worker.ts + core.ts, but holding several Plans by name.
// Every reply carries the time spent inside the worker, so the caller can split
// round-trip time into render time and transfer/queue time.
import * as mupdf from "/node_modules/mupdf/dist/mupdf.js";

const K = 25.4 / 72; // pt -> mm (page bounds already include /UserUnit)
const plans = {};

/** Part of a Plan at s px/mm, top-left at (x0, y0) mm; the Plan shifted by `shift` mm down. */
function render({ name, x0, y0, s, w, h, mode = "rgba", shift = 0, list = "dl" }) {
  const p = plans[name];
  const t0 = performance.now();
  const pix = mode === "gray" ? new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, w, h], false) : new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, w, h], true);
  pix.clear(255);
  const dev = new mupdf.DrawDevice([K * s, 0, 0, K * s, -x0 * s, (shift - y0) * s], pix);
  p[list].run(dev, mupdf.Matrix.identity);
  dev.close();
  dev.destroy();
  const t1 = performance.now();
  const pixels = pix.getPixels().slice();
  pix.destroy();
  const t2 = performance.now();
  return { pixels, w, h, runMs: t1 - t0, copyMs: t2 - t1 };
}

/**
 * A second display list without the objects whose box is smaller than `minMm` in both
 * directions: a JS Device that forwards everything else to a DisplayListDevice.
 * Clips, groups and tiles are always forwarded so nesting stays intact.
 */
function coarse({ name, minMm = 0, noTiles = false, into = "coarse" }) {
  const p = plans[name];
  const t0 = performance.now();
  const out = new mupdf.DisplayList(p.dl.getBounds());
  const target = new mupdf.DisplayListDevice(out);
  let kept = 0, dropped = 0, skip = 0;
  const small = (r) => (r[2] - r[0]) * K < minMm && (r[3] - r[1]) * K < minMm;
  const fwd = (fn) => (...a) => { if (!skip) target[fn](...a); };
  const dev = new mupdf.Device({
    fillPath(path, eo, ctm, cs, color, alpha) { if (skip) return; if (small(path.getBounds(null, ctm))) { dropped++; return; } kept++; target.fillPath(path, eo, ctm, cs, color, alpha); },
    strokePath(path, st, ctm, cs, color, alpha) { if (skip) return; if (small(path.getBounds(st, ctm))) { dropped++; return; } kept++; target.strokePath(path, st, ctm, cs, color, alpha); },
    fillText(text, ctm, cs, color, alpha) { if (skip) return; if (small(text.getBounds(null, ctm))) { dropped++; return; } kept++; target.fillText(text, ctm, cs, color, alpha); },
    strokeText: fwd("strokeText"), clipPath: fwd("clipPath"), clipStrokePath: fwd("clipStrokePath"), clipText: fwd("clipText"), clipStrokeText: fwd("clipStrokeText"),
    ignoreText: fwd("ignoreText"), fillShade: fwd("fillShade"), fillImage: fwd("fillImage"), fillImageMask: fwd("fillImageMask"), clipImageMask: fwd("clipImageMask"),
    popClip: fwd("popClip"), beginMask: fwd("beginMask"), endMask: fwd("endMask"), beginGroup: fwd("beginGroup"), endGroup: fwd("endGroup"),
    // noTiles: drop hatch patterns entirely (to see what the zoomed-out render spends on them).
    beginTile: (...a) => { if (noTiles || skip) { skip++; dropped++; return 0; } return target.beginTile(...a); },
    endTile: () => { if (noTiles || skip) { skip--; return; } target.endTile(); },
    beginLayer: fwd("beginLayer"), endLayer: fwd("endLayer"),
  });
  p.dl.run(dev, mupdf.Matrix.identity);
  dev.close(); target.close();
  p[into] = out;
  return { ms: performance.now() - t0, kept, dropped };
}

/**
 * Band display lists: the Plan cut along the time axis (y) into `n` bands, each its own
 * display list holding only the objects that reach into it, built in ONE pass. Clips,
 * groups, masks and tiles go to every band so nesting stays intact. A render then walks
 * only the bands it touches, each clipped to its band so objects in two bands are not
 * drawn twice.
 */
function bands({ name, n }) {
  const p = plans[name];
  const t0 = performance.now();
  const b = p.dl.getBounds(), H = (b[3] - b[1]) / n;
  const lists = [], devs = [], counts = new Array(n).fill(0);
  for (let i = 0; i < n; i++) { const l = new mupdf.DisplayList([b[0], b[1] + i * H, b[2], b[1] + (i + 1) * H]); lists.push(l); devs.push(new mupdf.DisplayListDevice(l)); }
  let structure = 0;
  const each = (r, f) => {
    const i0 = Math.max(0, Math.floor((r[1] - b[1]) / H)), i1 = Math.min(n - 1, Math.floor((r[3] - b[1]) / H));
    for (let i = i0; i <= i1; i++) { counts[i]++; f(devs[i]); }
  };
  const all = (fn) => (...a) => { structure++; for (const d of devs) d[fn](...a); };
  const dev = new mupdf.Device({
    fillPath(path, eo, ctm, cs, color, alpha) { each(path.getBounds(null, ctm), (d) => d.fillPath(path, eo, ctm, cs, color, alpha)); },
    strokePath(path, st, ctm, cs, color, alpha) { each(path.getBounds(st, ctm), (d) => d.strokePath(path, st, ctm, cs, color, alpha)); },
    fillText(text, ctm, cs, color, alpha) { each(text.getBounds(null, ctm), (d) => d.fillText(text, ctm, cs, color, alpha)); },
    strokeText: all("strokeText"), clipPath: all("clipPath"), clipStrokePath: all("clipStrokePath"), clipText: all("clipText"), clipStrokeText: all("clipStrokeText"),
    ignoreText: all("ignoreText"), fillShade: all("fillShade"), fillImage: all("fillImage"), fillImageMask: all("fillImageMask"), clipImageMask: all("clipImageMask"),
    popClip: all("popClip"), beginMask: all("beginMask"), endMask: all("endMask"), beginGroup: all("beginGroup"), endGroup: all("endGroup"),
    beginTile: (...a) => { structure++; let r = 0; for (const d of devs) r = d.beginTile(...a); return r; }, endTile: all("endTile"),
    beginLayer: all("beginLayer"), endLayer: all("endLayer"),
  });
  p.dl.run(dev, mupdf.Matrix.identity);
  dev.close();
  for (const d of devs) d.close();
  p.bands = { lists, H, y0: b[1] };
  return { ms: performance.now() - t0, n, perBand: counts, structureCalls: structure };
}

/** As render(), but through the band lists the region touches. */
function renderBands({ name, x0, y0, s, w, h, shift = 0 }) {
  const p = plans[name], B = p.bands;
  const t0 = performance.now();
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, w, h], true);
  pix.clear(255);
  const m = [K * s, 0, 0, K * s, -x0 * s, (shift - y0) * s];
  const dev = new mupdf.DrawDevice(m, pix);
  // Region in page pt: y from (y0 - shift) mm to (y0 - shift + h / s) mm.
  const top = (y0 - shift) / K, bottom = (y0 - shift + h / s) / K;
  let used = 0;
  for (let i = 0; i < B.lists.length; i++) {
    const a = B.y0 + i * B.H, z = a + B.H;
    if (z < top || a > bottom) continue;
    used++;
    const clip = new mupdf.Path();
    clip.rect(-1e5, a, 1e5, z);
    dev.clipPath(clip, false, mupdf.Matrix.identity);
    B.lists[i].run(dev, mupdf.Matrix.identity);
    dev.popClip();
  }
  dev.close(); dev.destroy();
  const t1 = performance.now();
  const pixels = pix.getPixels().slice();
  pix.destroy();
  return { pixels, w, h, runMs: t1 - t0, bandsUsed: used };
}

/** Counts drawn objects by their size in mm (how many are sub-pixel at a given scale). */
function census({ name }) {
  const p = plans[name], sizes = [];
  let glyphs = 0, tiles = 0, tileCells = 0, inTile = 0, objsInTiles = 0;
  const add = (r) => { if (inTile) { objsInTiles++; return; } sizes.push(Math.max(r[2] - r[0], r[3] - r[1]) * K); };
  const dev = new mupdf.Device({
    fillPath(path, eo, ctm) { add(path.getBounds(null, ctm)); },
    strokePath(path, st, ctm) { add(path.getBounds(st, ctm)); },
    fillText(text, ctm) { text.walk({ showGlyph() { glyphs++; } }); add(text.getBounds(null, ctm)); },
    // Tiling patterns (hatches): how many pattern cells cover the hatched areas.
    beginTile(area, view, xstep, ystep, ctm) {
      tiles++; inTile++;
      const sx = Math.hypot(ctm[0], ctm[1]), sy = Math.hypot(ctm[2], ctm[3]);
      tileCells += Math.ceil((area[2] - area[0]) / (Math.abs(xstep) * sx)) * Math.ceil((area[3] - area[1]) / (Math.abs(ystep) * sy));
      return 0;
    },
    endTile() { inTile--; },
  });
  const t0 = performance.now();
  p.dl.run(dev, mupdf.Matrix.identity);
  dev.close();
  sizes.sort((a, b) => a - b);
  const under = (mm) => sizes.filter((v) => v < mm).length;
  return { ms: performance.now() - t0, objects: sizes.length, glyphs, tiles, tileCells, objsInTiles, under: { "0.5mm": under(0.5), "1mm": under(1), "3mm": under(3), "10mm": under(10) }, medianMm: sizes[sizes.length >> 1] };
}

const ops = {
  open({ name, bytes }) {
    const t0 = performance.now();
    const doc = mupdf.Document.openDocument(bytes, "application/pdf");
    const page = doc.loadPage(0);
    const b = page.getBounds();
    const t1 = performance.now();
    const dl = page.toDisplayList(false);
    const t2 = performance.now();
    plans[name] = { doc, page, dl };
    return { openMs: t1 - t0, listMs: t2 - t1, wMm: (b[2] - b[0]) * K, hMm: (b[3] - b[1]) * K };
  },
  render, coarse, census, bands, renderBands,
  /** Both pictures of the same region, full list vs band lists: how many bytes differ, and by how much at most. */
  sameAsFull(args) {
    const a = render(args), b = renderBands(args);
    let diff = 0, max = 0;
    for (let i = 0; i < a.pixels.length; i++) { const d = Math.abs(a.pixels[i] - b.pixels[i]); if (d) { diff++; if (d > max) max = d; } }
    return { bytes: a.pixels.length, diff, max };
  },
};

onmessage = (e) => {
  const { id, op, args } = e.data;
  const t0 = performance.now();
  try {
    const result = ops[op](args);
    const workMs = performance.now() - t0;
    postMessage({ id, ok: true, result, workMs }, result && result.pixels ? [result.pixels.buffer] : []);
  } catch (err) {
    postMessage({ id, ok: false, error: String((err && err.stack) || err) });
  }
};
postMessage({ ready: true });
