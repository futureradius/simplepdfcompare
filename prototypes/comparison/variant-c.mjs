// PROTOTYPE (throwaway) · Comparison view, variant C "Alt | Neu".
// Two views side by side (stacked when time runs to the right), always showing the same
// spot: the Old Plan with what was Removed (yellow), the New Plan with what was Added (red).
// Pan or zoom either one and the other follows; a cross shows the pointer in the other view.
// One toolbar across the top holds the count, ◀ ▶, a place picker and the settings.
import { S, on, h, CV, CS, groups, describe, placeLabel, where, totals, compareViewer, fitPlace, fitWhole, keys,
  outlineSlider, fadeSlider, removedSwitch, check, bindRedraw, screen, RED, YELLOW_INK } from "./common.mjs";
import { COLORS } from "../alignment/shared.mjs";

export default function mount(host, { back }) {
  const offs = [];
  const pos = h("span", { style: "min-width:70px;text-align:center;font-variant-numeric:tabular-nums;font-weight:600" });
  const pick = h("select", { style: "max-width:300px;padding:4px 6px;border-radius:7px;border:1px solid var(--line);background:#fff" });
  pick.onchange = () => select(+pick.value);
  const sums = h("span", { class: "hint" });
  const ctrls = [check("Markierungen", "marks", "M"), outlineSlider(), removedSwitch(), fadeSlider(), check("Ringe", "rings", "Kleine Stellen mit Ring zeigen")];
  const more = h("details", { style: "position:relative" }, h("summary", { style: "cursor:pointer;list-style:none;padding:5px 10px;border:1px solid var(--line);border-radius:7px" }, "Darstellung ▾"),
    h("div", { style: "position:absolute;right:0;top:36px;z-index:6;width:300px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px;box-shadow:0 8px 30px rgba(0,0,0,.15);display:flex;flex-direction:column;gap:9px" },
      ctrls[3], ctrls[4], h("p", { class: "hint", style: "margin:0" }, h("kbd", {}, "Shift"), " halten: beide Pläne ohne Markierungen")));
  const bar = h("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 14px;background:#fff;border-bottom:1px solid var(--line)" },
    h("button", { onclick: back }, "← Ausrichten"),
    h("button", { onclick: () => go(-1), title: "Vorige Stelle (←)" }, "◀"), pos, h("button", { onclick: () => go(1), title: "Nächste Stelle (→)" }, "▶"),
    pick, sums, h("span", { style: "flex:1" }),
    ctrls[0], h("div", { style: "width:190px" }, ctrls[1]), h("span", { class: "hint" }, "Weg:"), ctrls[2], more,
    h("button", { onclick: () => fitWhole(vOld) }, "Ganzer Plan"));
  const vert = S.axis === "y";
  const pane = (which) => {
    const v = h("div", { class: "view", style: "position:absolute;inset:34px 6px 6px 6px;border:1px solid var(--line);border-radius:8px" });
    const head = h("div", { style: "position:absolute;left:8px;right:8px;top:6px;display:flex;align-items:center;gap:8px;font-weight:650" },
      h("span", { style: `width:12px;height:12px;border-radius:50%;background:${which === "old" ? COLORS.old : COLORS.new}` }),
      which === "old" ? "Alter Plan" : "Neuer Plan",
      h("span", { class: "hint", style: "font-weight:400" }, which === "old" ? "· gelb: weggefallen" : "· rot: dazugekommen (auch umgefärbt)"),
      h("span", { class: "hint", style: "font-weight:400;margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, (S.names || {})[which] || ""));
    return { el: h("div", { style: "position:relative;min-width:0;min-height:0" }, head, v), v };
  };
  const pO = pane("old"), pN = pane("new");
  const grid = h("div", { style: `flex:1;min-height:0;display:grid;padding:4px;${vert ? "grid-template-columns:1fr 1fr" : "grid-template-rows:1fr 1fr"}` }, pO.el, pN.el);
  const root = h("div", { style: "height:100%;display:flex;flex-direction:column" }, bar, grid);
  host.append(root);

  // The pointer, mirrored as a cross in the other view.
  let cursor = null;
  const cross = (from) => (ctx, V) => {
    if (!cursor || cursor.from === from) return;
    screen(ctx, () => {
      const x = (cursor.x - V.x0) * V.s, y = (cursor.y - V.y0) * V.s;
      ctx.strokeStyle = "rgba(29,29,31,.7)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x - 14, y); ctx.lineTo(x + 14, y); ctx.moveTo(x, y - 14); ctx.lineTo(x, y + 14); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.stroke();
    });
  };
  let syncing = false;
  const follow = (other) => (V) => { if (syncing || !other()) return; syncing = true; other().setView(V.x0, V.y0, V.s); syncing = false; };
  // eslint-disable-next-line prefer-const
  let vOld, vNew;
  vOld = compareViewer(pO.v, { only: "old", onChange: follow(() => vNew), overlayExtra: cross("old") });
  vNew = compareViewer(pN.v, { only: "new", onChange: follow(() => vOld), overlayExtra: cross("new") });
  for (const [p, from, other] of [[pO.v, "old", () => vNew], [pN.v, "new", () => vOld]]) {
    p.addEventListener("pointermove", (e) => {
      const V = (from === "old" ? vOld : vNew).V, r = p.getBoundingClientRect();
      cursor = { from, x: V.x0 + (e.clientX - r.left) / V.s, y: V.y0 + (e.clientY - r.top) / V.s };
      other().redrawOverlay();
    });
    p.addEventListener("pointerleave", () => { cursor = null; other().redrawOverlay(); });
  }

  function drawBar() {
    const gs = groups(), c = totals();
    if (!S.result) { pos.textContent = "…"; sums.textContent = "Vergleiche…"; pick.replaceChildren(); return; }
    pos.textContent = gs.length ? `${CS.sel + 1} von ${gs.length}` : "–";
    sums.replaceChildren(h("span", { style: `color:${RED};font-weight:600` }, `${c.new} dazu`), " · ", h("span", { style: `color:${YELLOW_INK};font-weight:600` }, `${c.old} weg`), " · ", h("b", {}, `${c.both} geändert`));
    pick.replaceChildren(...gs.map((g, i) => h("option", { value: String(i) }, `${i + 1} · ${placeLabel(g)} · ${where(g)} · ${describe(g)}`)));
    pick.value = String(CS.sel);
  }
  function select(i) {
    const gs = groups();
    if (!gs.length) return;
    CS.sel = (i + gs.length) % gs.length;
    drawBar(); fitPlace(vOld, gs[CS.sel]);
  }
  const go = (d) => select(CS.sel + d);
  const both = () => { vOld.update(10); vNew.update(10); };

  offs.push(keys({ go, redraw: () => { vOld.update(1); vNew.update(1); } }));
  offs.push(bindRedraw(...ctrls));
  offs.push(on((w) => {
    if (w === "cv") both();
    if (w === "result") { CS.sel = Math.min(CS.sel, Math.max(0, groups().length - 1)); if (!fitted && groups().length) { fitted = true; requestAnimationFrame(() => select(CS.sel)); } drawBar(); both(); }
  }));
  drawBar();
  let fitted = !!S.result;
  requestAnimationFrame(() => { if (groups().length) select(CS.sel); else fitWhole(vOld); });
  return () => { offs.forEach((f) => f()); root.remove(); };
}
export const NAME = "Alt | Neu";
void CV;
