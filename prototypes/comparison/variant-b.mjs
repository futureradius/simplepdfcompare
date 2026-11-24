// PROTOTYPE (throwaway) · Comparison view, variant B "Stelle für Stelle".
// No sidebar: the view takes the whole width and is always zoomed to one place. A bar on top
// says which place this is and what changed there, with big ◀ ▶. A filmstrip at the bottom
// shows every place as a small picture (drawn when it scrolls into sight); it is the overview.
// Alt / Neu / Beide floats in the view; the other settings sit behind ⚙.
import * as E from "../alignment/engine.mjs";
import { S, on, h, CV, CS, groups, describe, placeLabel, where, dot, totals, compareViewer, fitPlace, fitWhole, keys, paintCompare,
  baseSwitch, outlineSlider, fadeSlider, removedSwitch, check, legend, bindRedraw, placeBox, RED, YELLOW_INK } from "./common.mjs";

export default function mount(host, { back }) {
  const offs = [];
  const title = h("div", { style: "font-size:18px;font-weight:650;display:flex;align-items:center;gap:8px" });
  const what = h("div", { class: "muted", style: "font-size:13px" });
  const big = (txt, d, tip) => h("button", { title: tip, style: "font-size:18px;padding:8px 18px;border-radius:10px", onclick: () => go(d) }, txt);
  const top = h("div", { style: "display:flex;align-items:center;gap:14px;padding:10px 14px;background:#fff;border-bottom:1px solid var(--line)" },
    big("◀", -1, "Vorige Stelle (←)"), h("div", { style: "flex:1;min-width:0" }, title, what), big("▶", 1, "Nächste Stelle (→)"));
  const vwrap = h("div", { class: "view", style: "position:absolute;inset:10px;border:1px solid var(--line);border-radius:8px" });
  const ctrls = [baseSwitch(), check("Markierungen zeigen", "marks", "M"), outlineSlider(), removedSwitch(), fadeSlider(), check("Kleine Stellen mit Ring zeigen", "rings")];
  const pop = h("div", { hidden: "", style: "position:absolute;right:20px;top:62px;z-index:5;width:300px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px;box-shadow:0 8px 30px rgba(0,0,0,.15);display:flex;flex-direction:column;gap:9px" },
    h("b", {}, "Darstellung"), ctrls[1], ctrls[2], h("div", { style: "display:flex;align-items:center;gap:8px" }, h("span", {}, "Weggefallenes"), ctrls[3]), ctrls[4], ctrls[5], legend(),
    h("p", { class: "hint", style: "margin:0" }, h("kbd", {}, "Shift"), " halten: der andere Plan, ohne Markierungen · ", h("kbd", {}, "M"), " Markierungen aus/an"));
  const gear = h("button", { title: "Darstellung", style: "border-radius:50%;width:38px;height:38px;padding:0;font-size:18px;box-shadow:0 2px 8px rgba(0,0,0,.12)", onclick: () => (pop.hidden = !pop.hidden) }, "⚙");
  const floats = h("div", { style: "position:absolute;top:20px;left:20px;right:20px;z-index:4;display:flex;gap:8px;align-items:center;pointer-events:none" },
    h("div", { style: "pointer-events:auto;box-shadow:0 2px 8px rgba(0,0,0,.12);border-radius:99px" }, ctrls[0]),
    h("span", { style: "flex:1" }),
    h("button", { style: "pointer-events:auto;box-shadow:0 2px 8px rgba(0,0,0,.12)", onclick: () => fitWhole(viewer) }, "Ganzer Plan"),
    h("button", { style: "pointer-events:auto;box-shadow:0 2px 8px rgba(0,0,0,.12)", onclick: back }, "← Ausrichten"),
    h("span", { style: "pointer-events:auto" }, gear));
  const main = h("div", { style: "position:relative;flex:1;min-height:0" }, vwrap, floats, pop);
  const film = h("div", { style: "display:flex;gap:8px;overflow-x:auto;padding:10px 14px 70px;background:#fff;border-top:1px solid var(--line);flex:none" });
  const root = h("div", { style: "height:100%;display:flex;flex-direction:column" }, top, main, film);
  host.append(root);

  const viewer = compareViewer(vwrap);

  function drawTop() {
    const gs = groups(), g = gs[CS.sel];
    if (!S.result) { title.textContent = "Vergleiche…"; what.textContent = ""; return; }
    if (!g) { title.textContent = "Keine Unterschiede"; what.textContent = "Die beiden Pläne sind im verglichenen Bereich gleich."; return; }
    const c = totals();
    title.replaceChildren(dot(g, 14), `Stelle ${CS.sel + 1} von ${gs.length}`, h("span", { class: "muted", style: "font-weight:400" }, ` · ${placeLabel(g)} · ${where(g)}`));
    what.replaceChildren(describe(g), h("span", { style: "margin-left:14px" },
      h("span", { style: `color:${RED};font-weight:600` }, `${c.new} dazugekommen`), " · ", h("span", { style: `color:${YELLOW_INK};font-weight:600` }, `${c.old} weggefallen`), " · ", h("b", {}, `${c.both} geändert`), " insgesamt"));
  }

  // ---------- filmstrip ----------
  const TW = 150, TH = 104;
  let thumbs = [], queue = [], timer = 0;
  const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting && !e.target._done && !queue.includes(e.target)) { queue.push(e.target); pump(); } }, { root: film, rootMargin: "0px 300px" });
  function buildFilm() {
    io.disconnect(); queue = [];
    thumbs = groups().map((g, i) => {
      const c = h("canvas", { width: TW * devicePixelRatio, height: TH * devicePixelRatio, style: `width:${TW}px;height:${TH}px;display:block;border-radius:6px;background:#f2f1ee` });
      const el = h("button", { style: "flex:none;padding:4px;border-radius:9px;display:flex;flex-direction:column;gap:3px;align-items:stretch", onclick: () => select(i), title: describe(g) },
        c, h("span", { style: "display:flex;align-items:center;gap:5px;font-size:12px" }, dot(g, 8), h("b", {}, String(i + 1)), h("span", { class: "muted" }, placeLabel(g))));
      el._canvas = c; el._g = g;
      io.observe(el);
      return el;
    });
    film.replaceChildren(...thumbs);
    markFilm();
  }
  function pump() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const el = queue.shift();
      if (!el) return;
      drawThumb(el); el._done = true;
      if (queue.length) pump();
    }, 16);
  }
  function drawThumb(el) {
    const d = devicePixelRatio, w = TW * d, hh = TH * d, b = placeBox(el._g);
    const mw = Math.max(b.x1 - b.x0, 30) * 1.5, mh = Math.max(b.y1 - b.y0, 30) * 1.5;
    const s = Math.min(w / mw, hh / mh);
    const view = { x0: (b.x0 + b.x1) / 2 - w / 2 / s, y0: (b.y0 + b.y1) / 2 - hh / 2 / s, s };
    const gO = E.renderGray(S.plans.old, S.axis, view, w, hh, 0), gN = E.renderGray(S.plans.new, S.axis, view, w, hh, S.offset);
    const peek = CS.peek; CS.peek = false;
    el._canvas.getContext("2d").putImageData(paintCompare({ view, w, h: hh, gO, gN }), 0, 0);
    CS.peek = peek;
  }
  function markFilm() {
    thumbs.forEach((t, i) => { t.style.borderColor = i === CS.sel ? "#1d1d1f" : "var(--line)"; t.style.borderWidth = i === CS.sel ? "2px" : "1px"; t.style.background = i === CS.sel ? "color-mix(in srgb,var(--accent) 10%,#fff)" : "#fff"; });
    const t = thumbs[CS.sel];
    if (t) t.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }
  const redoThumbs = () => { for (const t of thumbs) t._done = false; io.disconnect(); queue = []; for (const t of thumbs) io.observe(t); };

  function select(i) {
    const gs = groups();
    if (!gs.length) return;
    CS.sel = (i + gs.length) % gs.length;
    drawTop(); markFilm(); fitPlace(viewer, gs[CS.sel]);
  }
  const go = (d) => select(CS.sel + d);

  offs.push(keys({ go, redraw: () => viewer.update(1) }));
  offs.push(bindRedraw(...ctrls));
  let cvTimer = 0;
  offs.push(on((w) => {
    if (w === "cv") { viewer.update(20); clearTimeout(cvTimer); cvTimer = setTimeout(redoThumbs, 400); }
    if (w === "result") { CS.sel = Math.min(CS.sel, Math.max(0, groups().length - 1)); if (!fitted && groups().length) { fitted = true; requestAnimationFrame(() => select(CS.sel)); } drawTop(); buildFilm(); viewer.update(10); }
  }));
  drawTop(); buildFilm();
  let fitted = !!S.result;
  requestAnimationFrame(() => { if (groups().length) select(CS.sel); else fitWhole(viewer); });
  return () => { offs.forEach((f) => f()); io.disconnect(); clearTimeout(timer); root.remove(); };
}
export const NAME = "Stelle für Stelle";
