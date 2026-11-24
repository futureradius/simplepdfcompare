// RESEARCH (throwaway) for issue #11: times the comparison prototype's own painting
// (prototypes/comparison/common.mjs, branch prototype/comparison-view) on the 14 m
// synthetic pair, and a vector-overlay replacement for its per-pixel mark painting.
// Called by run.mjs with a Playwright page; everything runs inside the page.

export async function protoBench(page) {
  await page.goto("http://127.0.0.1:5219/prototypes/comparison/view.html?demo=down&go=1&view=A");
  await page.waitForFunction(async () => {
    const { S } = await import("/prototypes/alignment/shared.mjs");
    return !!(S && S.result && S.result.items);
  }, null, { timeout: 120000, polling: 500 });
  await page.waitForTimeout(1500); // let the first view and thumbnails settle
  return page.evaluate(async () => {
    const C = await import("/prototypes/comparison/common.mjs");
    const { renderGray } = await import("/prototypes/alignment/engine.mjs");
    const { S } = C;
    const VW = 1600, VH = 1000, R = S.result;
    const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
    const r1 = (v) => Math.round(v * 10) / 10;
    const across = 1189, t1 = Math.max(13710, 13990 + S.offset);
    const at = (name, s, cy) => ({ name, s, x0: across / 2 - VW / 2 / s, y0: cy - VH / 2 / s });
    // The busiest place: the view centred on it, so the marks have something to draw.
    const g0 = C.groups()[0], b0 = C.placeBox(g0), cy = (b0.y0 + b0.y1) / 2;
    const views = [at("whole Plan", Math.min((VW - 40) / across, (VH - 40) / t1), t1 / 2), at("Body across (1.31)", (VW - 40) / across, cy), at("1:1 (3.78)", 96 / 25.4, cy)];
    const out = { compareMs: R.ms, items: R.items.length, places: C.groups().length, offset: S.offset, settings: { ...C.CV, filter: undefined }, perView: {} };

    // A vector replacement for paintCompare's masks and word loops: cached Plan bitmaps
    // composited by the GPU, marks drawn as paths in screen space, the grey "unchanged
    // part" as the intersection of the two mark layers ("destination-in").
    const K = (o) => o.coords;
    const pathOf = (o) => {
      if (o._vpath) return o._vpath;
      const k = K(o), path = new Path2D();
      if (o.kind === "stroke") for (let q = 0; q < k.length; q += 4) { path.moveTo(k[q], k[q + 1]); path.lineTo(k[q + 2], k[q + 3]); }
      else { let start = true; for (let q = 0; q < k.length; q += 2) { if (Number.isNaN(k[q])) { path.closePath(); start = true; continue; } if (start) { path.moveTo(k[q], k[q + 1]); start = false; } else path.lineTo(k[q], k[q + 1]); } }
      return (o._vpath = path);
    };
    const layer = () => { const c = new OffscreenCanvas(VW, VH); return [c, c.getContext("2d")]; };
    const [cv, ctx] = layer(), [lo, lctxO] = layer(), [ln, lctxN] = layer(), [li, lctxI] = layer();
    const vectorFrame = (view, bO, bN, vis) => {
      const s = view.s, out = C.CV.outline, fade = C.CV.fade / 100;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, VW, VH);
      ctx.drawImage(bO, 0, 0); ctx.globalCompositeOperation = "darken"; ctx.drawImage(bN, 0, 0);
      ctx.globalCompositeOperation = "source-over"; ctx.fillStyle = `rgba(255,255,255,${1 - fade})`; ctx.fillRect(0, 0, VW, VH);
      for (const [src, c, col] of [["old", lctxO, "rgb(240,190,0)"], ["new", lctxN, "rgb(220,42,30)"]]) {
        c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, VW, VH);
        c.setTransform(s, 0, 0, s, -view.x0 * s, -view.y0 * s);
        c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = c.fillStyle = col;
        for (const it of vis) {
          if (it.src !== src || !it.o) continue;
          const o = it.o, p = pathOf(o);
          if (o.kind === "stroke") c.lineWidth = Math.max(o.nums ? o.nums[0] : 0.2, 1.5 / s), c.stroke(p); else c.fill(p);
        }
      }
      // Halos (outline) at 30 %, then the marks, then the grey intersection on top.
      ctx.globalAlpha = 0.3;
      for (const [src, col] of [["old", "rgb(240,190,0)"], ["new", "rgb(220,42,30)"]]) {
        ctx.save(); ctx.setTransform(s, 0, 0, s, -view.x0 * s, -view.y0 * s); ctx.strokeStyle = col; ctx.lineJoin = "round"; ctx.lineCap = "round";
        for (const it of vis) if (it.src === src && it.o) { ctx.lineWidth = (it.o.nums ? it.o.nums[0] : 0) + (2 * out) / s; ctx.stroke(pathOf(it.o)); }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.drawImage(lo, 0, 0); ctx.drawImage(ln, 0, 0);
      lctxI.globalCompositeOperation = "copy"; lctxI.drawImage(lo, 0, 0);
      lctxI.globalCompositeOperation = "destination-in"; lctxI.drawImage(ln, 0, 0);
      lctxI.globalCompositeOperation = "source-in"; lctxI.fillStyle = "rgb(74,74,74)"; lctxI.fillRect(0, 0, VW, VH);
      ctx.drawImage(li, 0, 0);
      // Changed words: the Plan's own ink tinted with "screen" inside the word's box (+ halo box).
      for (const it of vis) {
        if (!it.text) continue;
        const b = it.box, x = (b.x0 - view.x0) * s, y = (b.y0 - view.y0) * s, w = (b.x1 - b.x0) * s, h = (b.y1 - b.y0) * s;
        const col = it.src === "old" ? "rgb(240,190,0)" : "rgb(220,42,30)";
        ctx.globalAlpha = 0.3; ctx.fillStyle = col; ctx.fillRect(x - out, y - out, w + 2 * out, h + 2 * out); ctx.globalAlpha = 1;
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
        ctx.drawImage(it.src === "old" ? bO : bN, 0, 0);
        ctx.globalCompositeOperation = "screen"; ctx.fillStyle = col; ctx.fillRect(x, y, w, h);
        ctx.restore();
      }
      ctx.getImageData(0, 0, 1, 1); // wait for the GPU
    };

    for (const v of views) {
      const row = { s: Math.round(v.s * 1000) / 1000 };
      let t0 = performance.now();
      const gO = renderGray(S.plans.old, S.axis, v, VW, VH, 0), gN = renderGray(S.plans.new, S.axis, v, VW, VH, S.offset);
      row.renderBothMainThreadMs = r1(performance.now() - t0);
      const mm = { x0: v.x0, y0: v.y0, x1: v.x0 + VW / v.s, y1: v.y0 + VH / v.s };
      const vis = R.items.filter((it) => it.box.x1 >= mm.x0 && it.box.x0 <= mm.x1 && it.box.y1 >= mm.y0 && it.box.y0 <= mm.y1);
      row.visibleItems = vis.length;
      const time = (f) => { const ts = []; for (let i = 0; i < 5; i++) { const t = performance.now(); f(); ts.push(performance.now() - t); } return r1(med(ts)); };
      const marks = C.CV.marks;
      C.CV.marks = false;
      row.paintBaseOnlyMs = time(() => C.paintCompare({ view: v, w: VW, h: VH, gO, gN }));
      C.CV.marks = true;
      row.paintWithMarksMs = time(() => C.paintCompare({ view: v, w: VW, h: VH, gO, gN }));
      C.CV.marks = marks;
      // Proposed: the two gray renders become bitmaps once (cached), then every frame is GPU work.
      t0 = performance.now();
      const toBmp = async (g) => { const img = new ImageData(VW, VH), d = img.data; for (let j = 0; j < VW * VH; j++) { d[4 * j] = d[4 * j + 1] = d[4 * j + 2] = g[j]; d[4 * j + 3] = 255; } return createImageBitmap(img); };
      const bO = await toBmp(gO), bN = await toBmp(gN);
      row.toBitmapsOnceMs = r1(performance.now() - t0);
      row.vectorFrameMs = time(() => vectorFrame(v, bO, bN, vis));
      bO.close(); bN.close();
      out.perView[v.name] = row;
    }
    // A list thumbnail as the prototype draws it (two main-thread renders + paintCompare).
    {
      const c = document.createElement("canvas"), gs = C.groups().slice(0, 8), ts = [];
      for (const g of gs) { const t = performance.now(); C.drawThumb(c, g, 220, 150); ts.push(performance.now() - t); }
      out.thumbPrototypeMs = r1(med(ts));
    }
    return out;
  });
}
