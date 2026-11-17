// PROTOTYPE (throwaway) · Variant B "Nebeneinander": one setup screen, the two Plans side by
// side (stacked when time runs right), scrolled together so the same moment sits at the same
// height. The Offset is the slide between them: drag the grip in the gutter, pick a
// suggestion, or nudge. A crosshair under the pointer runs through both Plans to check it.
// Lines are dragged in each Plan; Ignored areas are drawn in either and mirrored.
import { createViewer, grayToImage } from "./viewer.mjs";
import {
  S, on, h, A, fmt, rectTA, tOf, setAxis, setOffset, copyLinesToNew, layerCache, drawBody, drawIgnores, lineDrag, hitLine,
  areaDrag, ignoreList, nudgeKeys, COLORS, tag, fillRect, lineAcross,
} from "./shared.mjs";

export default function mount(stage) {
  const offs = [];
  let tool = "look", both = true, hoverT = null, syncing = false;
  const vertical = S.axis === "y";
  const root = h("div", { style: "display:flex;flex-direction:column;height:100%" });
  const bar = h("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 14px;background:#fff;border-bottom:1px solid var(--line)" });
  const grid = h("div", { style: `flex:1;min-height:0;display:grid;gap:0;${vertical ? "grid-template-columns:minmax(0,1fr) 64px minmax(0,1fr) 250px" : "grid-template-columns:minmax(0,1fr) 250px;grid-template-rows:minmax(0,1fr) 56px minmax(0,1fr)"}` });
  root.append(bar, grid);
  stage.append(root);

  // ---------- toolbar ----------
  const offVal = h("b", { style: "font-size:15px" });
  const offFrom = h("span", { class: "hint" });
  const chips = h("span", { style: "display:inline-flex;gap:4px" });
  const inp = h("input", { type: "number", step: "0.1" });
  inp.onchange = () => setOffset(+inp.value, "hand");
  const status = h("span", { class: "muted" });
  const toolSeg = h("span", { class: "seg" });
  const drawTools = () => toolSeg.replaceChildren(...[["look", "✋ Ansehen"], ["band", "Streifen ignorieren"], ["box", "Kasten ignorieren"]].map(([k, l]) => h("button", { class: tool === k ? "on" : "", onclick: () => { tool = k; drawTools(); } }, l)));
  drawTools();
  const bothBox = h("input", { type: "checkbox", checked: "" });
  bothBox.onchange = () => (both = bothBox.checked);
  bar.append(
    h("span", {}, "Zeit "), h("span", { class: "seg" },
      h("button", { class: S.axis === "y" ? "on" : "", onclick: () => { if (S.axis !== "y") { setAxis("y"); remount(); } } }, "↓"),
      h("button", { class: S.axis === "x" ? "on" : "", onclick: () => { if (S.axis !== "x") { setAxis("x"); remount(); } } }, "→")),
    h("span", { style: "width:1px;height:24px;background:var(--line)" }),
    h("span", {}, "Versatz ", offVal, " ", offFrom), chips, h("label", {}, inp, " mm"),
    h("span", { style: "width:1px;height:24px;background:var(--line)" }),
    toolSeg, h("label", { class: "hint" }, bothBox, " in beiden Plänen"),
    h("span", { style: "flex:1" }), status,
  );
  const drawBar = () => {
    offVal.textContent = fmt(S.offset, 2) + " mm";
    offFrom.textContent = { auto: "erkannt", picked: "gewählt", hand: "von Hand" }[S.offsetFrom];
    if (document.activeElement !== inp) inp.value = S.offset.toFixed(2);
    chips.replaceChildren(...S.cands.slice(0, 3).map((c, i) => h("span", { class: "chip" + (Math.abs(c.offset - S.offset) < 0.01 ? " sel" : ""), title: `${c.votes} Treffer`, onclick: () => setOffset(c.offset, i ? "picked" : "auto") }, fmt(c.offset, 0), h("span", { class: "muted" }, ` ${c.votes}`))));
    const r = S.result;
    status.replaceChildren(S.busy ? S.busy : r ? h("span", {}, `${r.groups.length} Stellen mit Unterschieden `, h("button", { class: "primary", onclick: () => alert("Hier öffnete sich die Vergleichsansicht (eigenes Ticket).") }, "Vergleichen →")) : "");
  };
  drawBar();

  // ---------- the two Plans ----------
  const win = () => [Math.max(S.body.old[0], S.body.new[0] + S.offset), Math.min(S.body.old[1], S.body.new[1] + S.offset)];
  const mkPane = (which) => {
    const cap = h("div", { style: `position:absolute;${vertical ? "top:8px;left:8px" : "top:8px;left:8px"};z-index:2;padding:2px 8px;border-radius:6px;font-weight:600;color:#fff;background:${which === "old" ? COLORS.old : COLORS.new}` }, which === "old" ? "Alter Plan" : "Neuer Plan");
    const v = h("div", { class: "view", style: "position:absolute;inset:0" });
    const box = h("div", { style: "position:relative;min-height:0;min-width:0;border:1px solid var(--line)" }, v, cap);
    return { box, v };
  };
  const po = mkPane("old"), pn = mkPane("new");
  const gutter = h("div", { style: `position:relative;background:#eceae5;cursor:${vertical ? "ns-resize" : "ew-resize"};display:grid;place-items:center;user-select:none` });
  const side = h("aside", { style: `${vertical ? "" : "grid-row:1/4;grid-column:2;"}padding:12px;background:#fff;border-left:1px solid var(--line);overflow:auto;display:flex;flex-direction:column;gap:10px` });
  if (vertical) grid.append(po.box, gutter, pn.box, side); else { grid.append(po.box, side, gutter, pn.box); po.box.style.gridColumn = gutter.style.gridColumn = pn.box.style.gridColumn = "1"; po.box.style.gridRow = "1"; gutter.style.gridRow = "2"; pn.box.style.gridRow = "3"; }

  const list = h("div");
  offs.push(ignoreList(list));
  side.append(
    h("h4", { style: "margin:0" }, "Kopf und Fuß"),
    h("p", { class: "hint", style: "margin:0" }, "Blaue Linien in jedem Plan ziehen; sie rasten an durchgehenden Linien ein (", h("kbd", {}, "Alt"), ": frei)."),
    h("button", { onclick: copyLinesToNew }, "Neuer Plan wie alter"),
    h("h4", { style: "margin:6px 0 0" }, "Versatz"),
    h("p", { class: "hint", style: "margin:0" }, "Beide Pläne laufen gemeinsam: dieselbe Zeit steht auf gleicher Höhe. Stimmt es nicht, den Griff zwischen den Plänen ziehen, einen Vorschlag oben wählen oder ", h("kbd", {}, vertical ? "↑↓" : "←→"), " drücken (", h("kbd", {}, "Shift"), " 1 mm, ", h("kbd", {}, "Strg"), " 10 mm)."),
    h("p", { class: "hint", style: "margin:0" }, "Die gestrichelte Linie unter dem Mauszeiger läuft durch beide Pläne."),
    h("h4", { style: "margin:6px 0 0" }, "Ignorierte Bereiche"),
    h("p", { class: "hint", style: "margin:0" }, "Werkzeug oben wählen und im Plan ziehen. ", h("kbd", {}, "Shift"), "-Ziehen geht immer für einen Kasten."),
    list,
  );

  const caches = { old: layerCache(), new: layerCache() };
  const views = {};
  for (const [which, pane] of [["old", po], ["new", pn]]) {
    const other = which === "old" ? "new" : "old";
    // Frame of each view: its own page mm. Old frame t = New page t + Offset.
    const toOld = (t) => (which === "old" ? t : t + S.offset), fromOld = (t) => (which === "old" ? t : t - S.offset);
    views[which] = createViewer(pane.v, {
      paint: (view, w, hh) => grayToImage(caches[which](which, view, w, hh, 0), w, hh),
      overlay: (ctx, V) => {
        // Overhang: Body without counterpart in the other Plan.
        const [w0, w1] = win(), b = S.body[which];
        const a = A(which);
        for (const [x0, x1] of [[b[0], fromOld(w0)], [fromOld(w1), b[1]]]) if (x1 - x0 > 0.5) {
          fillRect(ctx, rectTA(x0, x1, 0, a), "rgba(232,161,0,.13)");
          tag(ctx, V, vertical ? a : x0, vertical ? x0 : a, `nur im ${which === "old" ? "alten" : "neuen"} Plan · ${fmt(x1 - x0, 0)} mm`, { bg: "#a87400", align: vertical ? "right" : "left", base: vertical ? "top" : "bottom", dx: vertical ? -6 : 6, dy: vertical ? 6 : -6, size: 11 });
        }
        drawIgnores(ctx, V, which, { shift: 0 });
        drawBody(ctx, V, which, { shift: 0, color: COLORS.line });
        if (hoverT !== null) lineAcross(ctx, V, fromOld(hoverT), -1e4, 1e4, { color: "#111", px: 1, dash: [6, 4] });
      },
      hover: (pt, e, V) => {
        hoverT = toOld(tOf(pt)); views[other] && views[other].redrawOverlay();
        if (hitLine(which, pt, V, 0) >= 0) return vertical ? "ns-resize" : "ew-resize";
        return tool !== "look" || e.shiftKey ? "crosshair" : null;
      },
      down: (pt, e, V) => {
        const i = hitLine(which, pt, V, 0);
        if (i >= 0) return lineDrag(which, i, 0);
        if (e.shiftKey) return areaDrag(pt, "box", both ? "both" : which, which, 0);
        if (tool !== "look") return areaDrag(pt, tool, both ? "both" : which, which, 0);
        return null;
      },
      onChange: (V) => {
        if (syncing || !views[other]) return;
        syncing = true;
        const d = which === "old" ? -S.offset : S.offset; // other's t origin
        if (vertical) views[other].setView(V.x0, V.y0 + d, V.s); else views[other].setView(V.x0 + d, V.y0, V.s);
        syncing = false;
      },
    });
    pane.v.addEventListener("pointerleave", () => { hoverT = null; views.old.redrawOverlay(); views.new.redrawOverlay(); });
  }

  // Gutter grip: drag to slide the New Plan against the Old one.
  const grip = h("div", { style: `writing-mode:${vertical ? "vertical-rl" : "horizontal-tb"};font-size:12px;color:#444;text-align:center;line-height:1.2` });
  gutter.append(grip);
  const drawGrip = () => grip.replaceChildren(h("div", { style: "font-size:18px" }, vertical ? "⇕" : "⇔"), h("div", {}, "Versatz " + fmt(S.offset, 2) + " mm"));
  drawGrip();
  let g0 = null;
  gutter.onpointerdown = (e) => { gutter.setPointerCapture(e.pointerId); g0 = { p: vertical ? e.clientY : e.clientX, off: S.offset }; };
  gutter.onpointermove = (e) => { if (!g0) return; const d = ((vertical ? e.clientY : e.clientX) - g0.p) / views.old.V.s; setOffset(g0.off + d, "hand"); };
  gutter.onpointerup = () => (g0 = null);

  const resync = () => { const V = views.old.V; syncing = true; if (vertical) views.new.setView(V.x0, V.y0 - S.offset, V.s); else views.new.setView(V.x0 - S.offset, V.y0, V.s); syncing = false; };
  requestAnimationFrame(() => {
    const V = views.old.V, a = A("old"), t = S.body.old[0];
    const s = vertical ? (V.w - 30) / a : (V.h - 30) / a;
    if (vertical) views.old.setView(-15 / s, t - 0.2 * V.h / s, s); else views.old.setView(t - 0.2 * V.w / s, -15 / s, s);
  });

  const key = (e) => nudgeKeys(e);
  addEventListener("keydown", key);
  offs.push(() => removeEventListener("keydown", key));
  offs.push(on((w) => {
    if (w === "offset") { resync(); drawGrip(); }
    drawBar();
    views.old.redrawOverlay(); views.new.redrawOverlay();
  }));

  let gone = false;
  function remount() { if (gone) return; cleanup(); stage._again = mount(stage); }
  function cleanup() { gone = true; while (offs.length) offs.pop()(); root.remove(); }
  return () => { if (stage._again) { const f = stage._again; stage._again = null; f(); } else cleanup(); };
}
