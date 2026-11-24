// PROTOTYPE (throwaway) · Comparison view, variant A "Plan + Liste".
// One map view of the whole Plan with all marks, a sidebar with the count and the list of
// places with Differences, ◀ ▶ to step through them, and the display settings at the bottom
// of the sidebar. A thin overview strip at the view's edge shows every place along the time
// axis and the part that is on screen; click it to jump.
import { S, on, h, fmt, CV, CS, setCV, groups, describe, placeLabel, where, dot, totals, compareViewer, fitPlace, fitWhole, keys,
  baseSwitch, outlineSlider, fadeSlider, removedSwitch, check, legend, bindRedraw, placeBox, tLo, tHi, kindOf, RED, YELLOW, YELLOW_INK } from "./common.mjs";

export default function mount(host, { back }) {
  const offs = [];
  const count = h("div", { style: "font-size:22px;font-weight:650;line-height:1.2" });
  const sums = h("div", { class: "hint" });
  const pos = h("span", { style: "flex:1;text-align:center;font-variant-numeric:tabular-nums" });
  const list = h("ol", { style: "list-style:none;margin:0;padding:0;overflow:auto;flex:1;min-height:120px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)" });
  const ctrls = [baseSwitch(), check("Markierungen zeigen", "marks", "M"), outlineSlider(), removedSwitch(), fadeSlider(), check("Kleine Stellen mit Ring zeigen", "rings")];
  const aside = h("aside", { style: "padding:14px;background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;gap:10px;min-height:0;overflow:hidden" },
    h("div", {}, count, sums),
    h("div", { style: "display:flex;align-items:center;gap:6px" },
      h("button", { onclick: () => go(-1), title: "Vorige Stelle (←)" }, "◀ vorige"), pos, h("button", { onclick: () => go(1), title: "Nächste Stelle (→)" }, "nächste ▶")),
    list,
    h("details", { open: "" }, h("summary", { style: "cursor:pointer;font-weight:600" }, "Darstellung"),
      h("div", { style: "display:flex;flex-direction:column;gap:8px;margin-top:8px" },
        h("div", { style: "display:flex;align-items:center;gap:8px" }, h("span", {}, "Unter den Markierungen"), ctrls[0]),
        ctrls[1], ctrls[2], h("div", { style: "display:flex;align-items:center;gap:8px" }, h("span", {}, "Weggefallenes"), ctrls[3]), ctrls[4], ctrls[5],
        h("p", { class: "hint", style: "margin:0" }, h("kbd", {}, "Shift"), " halten: der andere Plan, ohne Markierungen · ", h("kbd", {}, "M"), " Markierungen aus/an"))),
    legend(),
    h("div", { style: "display:flex;gap:6px" }, h("button", { onclick: back }, "← Ausrichten"), h("button", { onclick: () => fitWhole(viewer) }, "Ganzer Plan")));
  const vwrap = h("div", { class: "view", style: "position:absolute;inset:10px 40px 10px 10px;border:1px solid var(--line);border-radius:8px" });
  const strip = h("canvas", { title: "Übersicht: alle Stellen entlang der Zeit. Klicken springt dorthin.", style: "position:absolute;top:10px;height:calc(100% - 20px);right:8px;width:24px;cursor:pointer;border-radius:6px;background:#fff;border:1px solid var(--line)" });
  const main = h("div", { style: "position:relative;min-height:0" }, vwrap, strip);
  const root = h("div", { style: "height:100%;display:grid;grid-template-columns:310px minmax(0,1fr)" }, aside, main);
  host.append(root);
  if (S.axis === "x") { vwrap.style.inset = "10px 10px 40px 10px"; Object.assign(strip.style, { top: "auto", left: "10px", right: "auto", bottom: "8px", width: "calc(100% - 20px)", height: "24px" }); }

  const viewer = compareViewer(vwrap, { onChange: () => drawStrip() });

  function drawSide() {
    const gs = groups(), c = totals();
    if (!S.result) { count.textContent = "Vergleiche…"; sums.textContent = ""; list.replaceChildren(); pos.textContent = ""; return; }
    count.textContent = gs.length ? `${gs.length} Stellen mit Unterschieden` : "Keine Unterschiede";
    sums.replaceChildren(
      h("span", { style: `color:${RED};font-weight:600` }, `${c.new} dazugekommen`), " · ",
      h("span", { style: `color:${YELLOW_INK};font-weight:600` }, `${c.old} weggefallen`), " · ",
      h("span", { style: "font-weight:600" }, `${c.both} geändert`));
    pos.textContent = gs.length ? `${CS.sel + 1} von ${gs.length}` : "–";
    list.replaceChildren(...gs.map((g, i) => h("li", {
      style: `display:flex;gap:8px;align-items:flex-start;padding:7px 8px;cursor:pointer;border-radius:6px;${i === CS.sel ? "background:color-mix(in srgb,var(--accent) 12%,#fff)" : ""}`,
      onclick: () => select(i),
    }, h("b", { style: "min-width:22px;text-align:right;font-variant-numeric:tabular-nums" }, String(i + 1)), h("span", { style: "margin-top:4px" }, dot(g)),
      h("span", {}, h("span", { style: "font-weight:600" }, placeLabel(g)), h("span", { class: "muted" }, " · " + where(g)), h("br"), h("span", { class: "hint" }, describe(g))))));
    const cur = list.children[CS.sel];
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }

  function drawStrip() {
    const r = strip.getBoundingClientRect(), d = devicePixelRatio;
    if (!r.width || !S.result) return;
    strip.width = r.width * d; strip.height = r.height * d;
    const ctx = strip.getContext("2d"), vert = S.axis === "y", len = vert ? r.height : r.width, thick = vert ? r.width : r.height;
    ctx.scale(d, d);
    const [w0, w1] = S.result.win, at = (t) => 4 + ((t - w0) / (w1 - w0)) * (len - 8);
    const rect = (a, b, c0, c1, col) => { ctx.fillStyle = col; if (vert) ctx.fillRect(c0, a, c1 - c0, Math.max(2, b - a)); else ctx.fillRect(a, c0, Math.max(2, b - a), c1 - c0); };
    // The part on screen.
    const V = viewer.V, v0 = vert ? V.y0 : V.x0, v1 = v0 + (vert ? V.h : V.w) / V.s;
    rect(at(Math.max(v0, w0)), at(Math.min(v1, w1)), 1, thick - 1, "rgba(29,95,214,.14)");
    groups().forEach((g, i) => {
      const b = placeBox(g), k = kindOf(g), sel = i === CS.sel;
      const col = k === "old" ? YELLOW : RED;
      if (k === "both") { rect(at(tLo(b)), at(tHi(b)), sel ? 1 : 5, thick / 2, YELLOW); rect(at(tLo(b)), at(tHi(b)), thick / 2, sel ? thick - 1 : thick - 5, RED); }
      else rect(at(tLo(b)), at(tHi(b)), sel ? 1 : 5, sel ? thick - 1 : thick - 5, col);
      if (sel) { ctx.strokeStyle = "#1d1d1f"; ctx.lineWidth = 1.5; const a = at(tLo(b)) - 2, z = Math.max(at(tHi(b)) + 2, a + 5); if (vert) ctx.strokeRect(0.75, a, thick - 1.5, z - a); else ctx.strokeRect(a, 0.75, z - a, thick - 1.5); }
    });
  }
  strip.onclick = (e) => {
    const r = strip.getBoundingClientRect(), [w0, w1] = S.result.win, vert = S.axis === "y";
    const t = w0 + ((vert ? e.clientY - r.top : e.clientX - r.left) - 4) / ((vert ? r.height : r.width) - 8) * (w1 - w0);
    let best = -1, bd = Infinity;
    groups().forEach((g, i) => { const b = placeBox(g), c = (tLo(b) + tHi(b)) / 2, dd = Math.abs(c - t); if (dd < bd) { bd = dd; best = i; } });
    const px = bd / (w1 - w0) * (vert ? r.height : r.width);
    if (best >= 0 && px < 12) select(best);
    else { const V = viewer.V; if (vert) viewer.setView(V.x0, t - V.h / 2 / V.s); else viewer.setView(t - V.w / 2 / V.s, V.y0); }
  };

  function select(i) {
    const gs = groups();
    if (!gs.length) return;
    CS.sel = (i + gs.length) % gs.length;
    drawSide(); fitPlace(viewer, gs[CS.sel]); drawStrip();
  }
  const go = (d) => select(CS.sel + d);

  offs.push(keys({ go, redraw: () => viewer.update(1) }));
  offs.push(bindRedraw(...ctrls));
  offs.push(on((w) => {
    if (w === "cv") { viewer.update(20); drawStrip(); }
    if (w === "result") { CS.sel = Math.min(CS.sel, Math.max(0, groups().length - 1)); if (!fitted && groups().length) { fitted = true; requestAnimationFrame(() => select(CS.sel)); } drawSide(); viewer.update(10); drawStrip(); }
  }));
  drawSide();
  let fitted = !!S.result;
  requestAnimationFrame(() => { if (S.result && groups().length) select(CS.sel); else fitWhole(viewer); drawStrip(); });
  new ResizeObserver(() => drawStrip()).observe(strip);
  return () => { offs.forEach((f) => f()); root.remove(); };
}
export const NAME = "Plan + Liste";
void fmt; void setCV;
