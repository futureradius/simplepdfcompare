// PROTOTYPE (throwaway) · Variant C "Übereinander, direkt": no setup step. The pair opens
// straight into one view of both Plans laid on top of each other (Old blue, New red,
// matching = black) with guessed or remembered lines and the detected Offset, and the
// places with Differences already marked. Everything is corrected in place: drag a line,
// slide the New Plan, draw an area; the marks follow. Colours / blink / swipe to check.
import { createViewer, tint, grayToImage } from "./viewer.mjs";
import {
  S, on, h, A, L, fmt, rectTA, tOf, aOf, setAxis, setOffset, copyLinesToNew, layerCache, drawBody, drawIgnores, lineDrag,
  hitLine, areaDrag, ignoreList, nudgeKeys, COLORS, tag, fillRect, strokeRect,
} from "./shared.mjs";

export default function mount(stage) {
  const offs = [];
  let tool = "look", mode = "tint", blinkOld = true, blinkTimer = 0, swipeA = null, popover = null;
  const vertical = S.axis === "y";
  const root = h("div", { style: "position:absolute;inset:0" });
  const viewEl = h("div", { class: "view", style: "position:absolute;inset:0" });
  root.append(viewEl);
  stage.append(root);
  const cache = layerCache();
  const win = () => [Math.max(S.body.old[0], S.body.new[0] + S.offset), Math.min(S.body.old[1], S.body.new[1] + S.offset)];

  // Swipe: before the divider (across) the Old Plan, after it the New Plan.
  function swipe(go, gn, w, hh, view) {
    const img = new ImageData(w, hh), d = img.data;
    const cut = swipeA === null ? (vertical ? w / 2 : hh / 2) : (swipeA - (vertical ? view.x0 : view.y0)) * view.s;
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, v = ((vertical ? x : y) < cut ? go : gn)[i];
      d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = v; d[4 * i + 3] = 255;
    }
    return img;
  }

  const viewer = createViewer(viewEl, {
    paint: (view, w, hh) => {
      const go = cache("old", view, w, hh, 0), gn = cache("new", view, w, hh, S.offset);
      if (mode === "blink") return grayToImage(blinkOld ? go : gn, w, hh);
      if (mode === "swipe") return swipe(go, gn, w, hh, view);
      return tint(go, gn, w, hh);
    },
    overlay: (ctx, V) => {
      const [w0, w1] = win();
      // Not compared: outside the window where both Bodies overlap.
      fillRect(ctx, rectTA(-1e5, w0, -1e4, 1e4), "rgba(255,255,255,.6)");
      fillRect(ctx, rectTA(w1, 1e5, -1e4, 1e4), "rgba(255,255,255,.6)");
      for (const which of ["old", "new"]) {
        const sh = which === "new" ? S.offset : 0, b = S.body[which];
        for (const [x0, x1] of [[b[0] + sh, w0], [w1, b[1] + sh]]) if (x1 - x0 > 0.5) {
          fillRect(ctx, rectTA(x0, x1, 0, A(which)), "rgba(232,161,0,.12)");
          tag(ctx, V, vertical ? A(which) : x0, vertical ? x0 : A(which), `Überhang: nur im ${which === "old" ? "alten" : "neuen"} Plan`, { bg: "#a87400", align: vertical ? "right" : "left", base: vertical ? "top" : "bottom", dx: vertical ? -6 : 6, dy: vertical ? 6 : -6, size: 11 });
        }
      }
      drawIgnores(ctx, V, "old", { shift: 0 });
      drawBody(ctx, V, "old", { color: COLORS.old, veil: false, suffix: " (alt)" });
      drawBody(ctx, V, "new", { color: COLORS.new, veil: false, suffix: " (neu)" });
      // Places with Differences, live.
      if (S.result && mode === "tint") for (const g of S.result.groups) {
        const b = g.box, m = 3 + 6 / V.s;
        const o = g.items.some((x) => x.src === "old"), n = g.items.some((x) => x.src === "new");
        strokeRect(ctx, V, { x0: b.x0 - m, y0: b.y0 - m, x1: b.x1 + m, y1: b.y1 + m }, o && !n ? "#e0a800" : "#dc2a1e", 2);
      }
      if (mode === "swipe") {
        const a = swipeA === null ? (vertical ? V.x0 + V.w / 2 / V.s : V.y0 + V.h / 2 / V.s) : swipeA;
        ctx.save(); ctx.strokeStyle = "#111"; ctx.lineWidth = 2 / V.s; ctx.beginPath();
        if (vertical) { ctx.moveTo(a, -1e5); ctx.lineTo(a, 1e5); } else { ctx.moveTo(-1e5, a); ctx.lineTo(1e5, a); }
        ctx.stroke(); ctx.restore();
        tag(ctx, V, vertical ? a : V.x0, vertical ? V.y0 : a, "◀ alt | neu ▶", { bg: "#111", align: "center", base: "top", dy: 60, dx: vertical ? 0 : 80 });
      }
      if (mode === "blink") tag(ctx, V, V.x0, V.y0, blinkOld ? "alter Plan" : "neuer Plan", { bg: blinkOld ? COLORS.old : COLORS.new, dx: V.w / 2, dy: 70, align: "center", size: 14 });
    },
    hover: (pt, e, V) => {
      if (mode === "swipe") { swipeA = aOf(pt); viewer.update(10); }
      for (const w of ["old", "new"]) if (hitLine(w, pt, V) >= 0) return vertical ? "ns-resize" : "ew-resize";
      if (tool === "slide") return vertical ? "ns-resize" : "ew-resize";
      return tool !== "look" || e.shiftKey ? "crosshair" : null;
    },
    down: (pt, e, V) => {
      for (const w of ["old", "new"]) { const i = hitLine(w, pt, V); if (i >= 0) return lineDrag(w, i); }
      if (tool === "slide") {
        const t0 = tOf(pt), o0 = S.offset;
        return { move: (p) => setOffset(o0 + tOf(p) - t0, "hand") };
      }
      if (e.shiftKey) return areaDrag(pt, "box", "both", "old", 0);
      if (tool === "band" || tool === "box") return areaDrag(pt, tool, "both", "old", 0);
      return null;
    },
  });

  // ---------- floating bar ----------
  const bar = h("div", { style: "position:absolute;top:10px;left:10px;right:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;pointer-events:none" });
  const card = (...k) => h("div", { style: "pointer-events:auto;display:flex;gap:6px;align-items:center;background:rgba(255,255,255,.96);border:1px solid var(--line);border-radius:10px;padding:5px 8px;box-shadow:0 2px 10px rgba(0,0,0,.08)" }, ...k);
  const offBtn = h("button", { style: "border:0;padding:3px 6px" });
  const count = h("span", { style: "font-weight:600" });
  const modeSeg = h("span", { class: "seg" }), toolSeg = h("span", { class: "seg" });
  const igBtn = h("button", {});
  const drawModes = () => modeSeg.replaceChildren(...[["tint", "Farben"], ["blink", "Blinken"], ["swipe", "Wischen"]].map(([k, l]) => h("button", { class: mode === k ? "on" : "", onclick: () => setMode(k) }, l)));
  const drawTools = () => toolSeg.replaceChildren(...[["look", "✋"], ["slide", vertical ? "⇕ Neuen schieben" : "⇔ Neuen schieben"], ["band", "Streifen ignorieren"], ["box", "Kasten ignorieren"]].map(([k, l]) => h("button", { class: tool === k ? "on" : "", title: k === "look" ? "Ansehen" : "", onclick: () => { tool = k; drawTools(); } }, l)));
  drawModes(); drawTools();
  bar.append(
    card(h("span", { class: "seg" },
      h("button", { class: S.axis === "y" ? "on" : "", title: "Zeit läuft nach unten", onclick: () => { if (S.axis !== "y") { setAxis("y"); remount(); } } }, "Zeit ↓"),
      h("button", { class: S.axis === "x" ? "on" : "", title: "Zeit läuft nach rechts", onclick: () => { if (S.axis !== "x") { setAxis("x"); remount(); } } }, "→"))),
    card(h("span", { class: "hint" }, "Versatz"), offBtn,
      h("button", { style: "padding:2px 8px", title: "−0,1 mm (Shift 1, Strg 10)", onclick: (e) => setOffset(S.offset - (e.ctrlKey ? 10 : e.shiftKey ? 1 : 0.1), "hand") }, "−"),
      h("button", { style: "padding:2px 8px", title: "+0,1 mm (Shift 1, Strg 10)", onclick: (e) => setOffset(S.offset + (e.ctrlKey ? 10 : e.shiftKey ? 1 : 0.1), "hand") }, "+")),
    card(modeSeg),
    card(toolSeg, igBtn),
    h("span", { style: "flex:1" }),
    card(count),
  );
  root.append(bar);

  // Bottom-left: where the lines came from, and jumps to them (13 m apart on the long Plan).
  const note = h("div", { style: "position:absolute;left:10px;bottom:70px;max-width:420px;pointer-events:auto;background:rgba(255,255,255,.96);border:1px solid var(--line);border-radius:10px;padding:8px 10px;box-shadow:0 2px 10px rgba(0,0,0,.08);font-size:13px" });
  root.append(note);
  const jump = (t, at) => {
    const V = viewer.V, a = A("old"), s = vertical ? (V.w - 40) / a : (V.h - 40) / a;
    if (vertical) viewer.setView(-20 / s, t - at * V.h / s, s); else viewer.setView(t - at * V.w / s, -20 / s, s);
  };
  const drawNote = () => note.replaceChildren(
    h("div", {}, S.bodyFrom === "remembered" ? "Kopf, Fuß und ignorierte Bereiche wie beim letzten Mal." : S.bodyFrom === "guess" ? h("span", {}, h("b", {}, "Kopf und Fuß geschätzt"), " – bitte prüfen.") : "Kopf und Fuß von Hand gesetzt."),
    h("div", { style: "display:flex;gap:6px;margin-top:6px;flex-wrap:wrap" },
      h("button", { onclick: () => jump(Math.min(S.body.old[0], S.body.new[0] + S.offset), 0.3) }, "Kopf ansehen"),
      h("button", { onclick: () => jump(Math.max(S.body.old[1], S.body.new[1] + S.offset), 0.7) }, "Fuß ansehen"),
      h("button", { onclick: () => viewer.fit(rectTA(Math.min(0, S.offset), Math.max(L("old"), L("new") + S.offset), 0, A("old")), 70) }, "Ganzer Plan"),
      h("button", { onclick: copyLinesToNew, title: "Kopf gleich, Fuß gleich weit vom Ende" }, "Linien neu = alt")),
    h("div", { class: "hint", style: "margin-top:6px" }, "Linien ziehen (", h("kbd", {}, "Alt"), " frei) · ", h("kbd", {}, vertical ? "↑↓" : "←→"), " Versatz · ", h("kbd", {}, "Shift"), "-Ziehen: Kasten ignorieren · schwarz = gleich, ", h("b", { style: `color:${COLORS.old}` }, "blau"), " = nur alt, ", h("b", { style: `color:${COLORS.new}` }, "rot"), " = nur neu"),
  );
  drawNote();

  function drawBar() {
    offBtn.replaceChildren(h("b", {}, fmt(S.offset, 2) + " mm"), " ", h("span", { class: "hint" }, { auto: "✓ erkannt", picked: "gewählt", hand: "von Hand" }[S.offsetFrom]), " ▾");
    count.textContent = S.busy ? S.busy : S.result ? `${S.result.groups.length} Stellen mit Unterschieden` : "";
    igBtn.textContent = `Ignoriert (${S.ignores.length}) ▾`;
  }
  drawBar();

  function pop(anchor, build) {
    if (popover) { popover.remove(); const same = popover._a === anchor; popover = null; if (same) return; }
    const r = anchor.getBoundingClientRect(), sr = root.getBoundingClientRect();
    popover = h("div", { style: `position:absolute;left:${r.left - sr.left}px;top:${r.bottom - sr.top + 6}px;z-index:5;min-width:260px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px;box-shadow:0 6px 24px rgba(0,0,0,.15)` });
    popover._a = anchor;
    build(popover);
    root.append(popover);
  }
  offBtn.onclick = () => pop(offBtn, (p) => {
    const max = Math.max(1, ...S.cands.map((c) => c.votes));
    const inp = h("input", { type: "number", step: "0.1", value: S.offset.toFixed(2) });
    inp.onchange = () => setOffset(+inp.value, "hand");
    p.append(h("div", { class: "hint", style: "margin-bottom:6px" }, "Vorschläge (Treffer = gleiche Objekte, die genau so weit verschoben sind)"),
      ...S.cands.map((c, i) => h("div", { class: "chip" + (Math.abs(c.offset - S.offset) < 0.01 ? " sel" : ""), style: "display:grid;grid-template-columns:90px 1fr 50px;border-radius:8px;margin:3px 0", onclick: () => { setOffset(c.offset, i ? "picked" : "auto"); popover.remove(); popover = null; } },
        h("b", {}, fmt(c.offset, 2) + " mm"), h("div", { class: "bar", style: `width:${(100 * c.votes) / max}%` }), h("span", { class: "muted", style: "text-align:right" }, c.votes))),
      h("div", { style: "margin-top:8px" }, h("label", {}, "genau ", inp, " mm")));
  });
  igBtn.onclick = () => pop(igBtn, (p) => { const l = h("div"); offs.push(ignoreList(l)); p.append(h("div", { class: "hint", style: "margin-bottom:4px" }, "Ignorierte Bereiche (gelten für beide Pläne)"), l); });

  function setMode(k) {
    mode = k; drawModes();
    clearInterval(blinkTimer);
    if (mode === "blink") blinkTimer = setInterval(() => { blinkOld = !blinkOld; viewer.update(0); }, 650);
    viewer.update(10);
  }

  requestAnimationFrame(() => viewer.fit(rectTA(Math.min(0, S.offset), Math.max(L("old"), L("new") + S.offset), 0, A("old")), 70));
  const key = (e) => nudgeKeys(e);
  addEventListener("keydown", key);
  offs.push(() => removeEventListener("keydown", key));
  offs.push(() => clearInterval(blinkTimer));
  offs.push(on((w) => {
    if (w === "offset") viewer.update(30);
    if (w === "body" || w === "pair" || w === "ignores") drawNote();
    drawBar();
    viewer.redrawOverlay();
  }));

  let gone = false;
  function remount() { if (gone) return; cleanup(); stage._again = mount(stage); }
  function cleanup() { gone = true; while (offs.length) offs.pop()(); root.remove(); }
  return () => { if (stage._again) { const f = stage._again; stage._again = null; f(); } else cleanup(); };
}
