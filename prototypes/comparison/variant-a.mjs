// PROTOTYPE (throwaway) · Comparison view, variant A "Plan + Liste" (round 2, the chosen one).
// One map view of the whole Plan with all marks and a sidebar:
//   - the count, a filter by kind of change (like Excel's) and filter presets ("Vorlage"),
//   - the list of places, each with a small picture (drawn when it scrolls into sight),
//   - "Darstellung" folded away (settings are kept per browser).
// The sidebar's right edge can be dragged wider or narrower. Under the view, ◀ ▶ with the
// current place's number and kind of change between them. A strip along the view's edge
// shows every place along the time axis; click it to jump.
import { S, on, h, CV, CS, setCV, groups, allPlaces, describe, placeLabel, where, dot, totals, compareViewer, fitPlace, fitWhole, keys,
  baseSwitch, outlineSlider, fadeSlider, removedSwitch, xSizeSlider, check, legend, bindRedraw, placeBox, tLo, tHi, kindOf, drawThumb,
  CATS, catOn, BUILTIN, userPresets, savePresets, fullFilter, sameFilter, setFilter, RED, YELLOW, YELLOW_INK } from "./common.mjs";

const SIDE_KEY = "compareview.side";
const sideWidth = () => { try { return +localStorage.getItem(SIDE_KEY) || 330; } catch { return 330; } };

export default function mount(host, { back }) {
  const offs = [];
  let W = Math.min(700, Math.max(240, sideWidth()));

  // ---------- sidebar ----------
  const count = h("div", { style: "font-size:20px;font-weight:650;line-height:1.2" });
  const sums = h("div", { class: "hint" });
  const pos = h("span", { style: "flex:1;text-align:center;font-variant-numeric:tabular-nums" });
  const list = h("ol", { style: "list-style:none;margin:0;padding:0;overflow:auto;flex:1;min-height:120px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)" });

  // Filter by kind of change: a button that opens a checkbox list, like Excel's filter.
  const fbtn = h("button", { style: "flex:1;display:flex;justify-content:space-between;gap:6px;text-align:left", title: "Nach Art der Änderung filtern" });
  const fpanel = h("div", { hidden: "", style: "position:absolute;left:14px;right:14px;z-index:8;background:#fff;border:1px solid var(--line);border-radius:10px;padding:8px;box-shadow:0 8px 30px rgba(0,0,0,.15);max-height:60vh;overflow:auto" });
  fbtn.onclick = () => { fpanel.hidden = !fpanel.hidden; if (!fpanel.hidden) { fpanel.style.top = fbtn.offsetTop + fbtn.offsetHeight + 4 + "px"; drawFilter(); } };
  const closeFilter = (e) => { if (!fpanel.hidden && !fpanel.contains(e.target) && !fbtn.contains(e.target)) fpanel.hidden = true; };
  addEventListener("pointerdown", closeFilter);
  offs.push(() => removeEventListener("pointerdown", closeFilter));

  // Presets ("Vorlage"), as in simplepdfclipper: built-in ones plus the user's own.
  const psel = h("select", { style: "flex:1;min-width:0;padding:4px 6px;border-radius:7px;border:1px solid var(--line);background:#fff", title: "Vorlage: eine gespeicherte Filterauswahl" });
  psel.onchange = () => { const p = [...BUILTIN, ...userPresets()].find((x) => x.name === psel.value); if (p) setFilter(p.filter); };
  const psave = h("button", { title: "Aktuelle Auswahl als Vorlage speichern…", style: "padding:4px 9px", onclick: () => {
    const name = (prompt("Name der Vorlage:", "") || "").trim();
    if (!name) return;
    if (BUILTIN.some((b) => b.name === name)) { alert("Diesen Namen hat schon eine mitgelieferte Vorlage."); return; }
    savePresets([...userPresets().filter((p) => p.name !== name), { name, filter: fullFilter() }]);
  } }, "+");
  const pdel = h("button", { title: "Diese Vorlage löschen", style: "padding:4px 8px", onclick: () => {
    const name = psel.value;
    if (confirm(`Vorlage „${name}“ löschen?`)) savePresets(userPresets().filter((p) => p.name !== name));
  } }, "×");

  const ctrls = [baseSwitch(), check("Markierungen zeigen", "marks", "M"), outlineSlider(), removedSwitch(), xSizeSlider(), fadeSlider(), check("Kleine Stellen mit Ring zeigen", "rings")];
  const aside = h("aside", { style: "position:relative;padding:14px;background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;gap:10px;min-height:0;overflow:hidden" },
    h("div", {}, count, sums),
    h("div", { style: "display:flex;align-items:center;gap:6px" }, h("span", { class: "hint" }, "Vorlage"), psel, psave, pdel),
    h("div", { style: "display:flex;align-items:center;gap:6px" }, fbtn),
    fpanel,
    h("div", { style: "display:flex;align-items:center;gap:6px" },
      h("button", { onclick: () => go(-1), title: "Vorige Stelle (←)" }, "◀ vorige"), pos, h("button", { onclick: () => go(1), title: "Nächste Stelle (→)" }, "nächste ▶")),
    list,
    h("details", {}, h("summary", { style: "cursor:pointer;font-weight:600" }, "Darstellung ", h("span", { class: "hint", style: "font-weight:400" }, "(bleibt in diesem Browser gespeichert)")),
      h("div", { style: "display:flex;flex-direction:column;gap:8px;margin-top:8px" },
        h("div", { style: "display:flex;align-items:center;gap:8px" }, h("span", {}, "Unter den Markierungen"), ctrls[0]),
        ctrls[1], ctrls[2], h("div", { style: "display:flex;align-items:center;gap:8px" }, h("span", {}, "Weggefallenes"), ctrls[3]), ctrls[4], ctrls[5], ctrls[6],
        h("p", { class: "hint", style: "margin:0" }, h("kbd", {}, "Leertaste"), " halten: nur neuer Plan · ", h("kbd", {}, "Shift"), " + ", h("kbd", {}, "Leertaste"), ": nur alter Plan · ", h("kbd", {}, "M"), " Markierungen aus/an"),
        legend())),
    h("div", { style: "display:flex;gap:6px" }, h("button", { onclick: back }, "← Ausrichten"), h("button", { onclick: () => fitWhole(viewer) }, "Ganzer Plan")));
  // Drag the sidebar's right edge to make it wider or narrower.
  const grip = h("div", { title: "Ziehen: Seitenleiste breiter oder schmaler", style: "position:absolute;top:0;bottom:0;right:0;width:7px;cursor:col-resize;z-index:9" });
  aside.append(grip);

  // ---------- main view ----------
  const vwrap = h("div", { class: "view", style: "position:absolute;inset:10px 40px 10px 10px;border:1px solid var(--line);border-radius:8px" });
  const strip = h("canvas", { title: "Übersicht: alle Stellen entlang der Zeit. Klicken springt dorthin.", style: "position:absolute;top:10px;height:calc(100% - 20px);right:8px;width:24px;cursor:pointer;border-radius:6px;background:#fff;border:1px solid var(--line)" });
  // ◀ current place ▶, where the prototype switcher used to be.
  const navText = h("button", { title: "Zur aktuellen Stelle", style: "background:transparent;color:#fff;border:0;display:flex;align-items:center;gap:8px;max-width:520px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis", onclick: () => select(CS.sel) });
  const navBtn = (t, d, tip) => h("button", { title: tip, style: "background:transparent;color:#fff;border:0;border-radius:99px;padding:4px 12px;font-size:15px", onclick: () => go(d) }, t);
  const nav = h("div", { style: "position:absolute;left:50%;bottom:22px;transform:translateX(-50%);z-index:6;display:flex;align-items:center;gap:2px;padding:5px;border-radius:99px;background:#1d1d1f;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.3);font-size:13px;max-width:calc(100% - 80px)" },
    navBtn("◀", -1, "Vorige Stelle (←)"), navText, navBtn("▶", 1, "Nächste Stelle (→)"));
  const main = h("div", { style: "position:relative;min-height:0;min-width:0" }, vwrap, strip, nav);
  const root = h("div", { style: `height:100%;display:grid;grid-template-columns:${W}px minmax(0,1fr)` }, aside, main);
  host.append(root);
  if (S.axis === "x") { vwrap.style.inset = "10px 10px 40px 10px"; Object.assign(strip.style, { top: "auto", left: "10px", right: "auto", bottom: "8px", width: "calc(100% - 20px)", height: "24px" }); nav.style.bottom = "48px"; }

  const viewer = compareViewer(vwrap, { onChange: () => drawStrip() });

  grip.onpointerdown = (e) => {
    grip.setPointerCapture(e.pointerId);
    const x0 = root.getBoundingClientRect().left;
    grip.onpointermove = (ev) => { W = Math.round(Math.min(700, Math.max(240, ev.clientX - x0))); root.style.gridTemplateColumns = `${W}px minmax(0,1fr)`; };
    grip.onpointerup = () => { grip.onpointermove = null; try { localStorage.setItem(SIDE_KEY, String(W)); } catch {} drawList(); };
  };

  // ---------- drawing the sidebar ----------
  function drawSide() {
    const gs = groups(), all = allPlaces(), c = totals();
    drawPresets(); drawFilterButton();
    if (!S.result) { count.textContent = "Vergleiche…"; sums.textContent = ""; list.replaceChildren(); pos.textContent = ""; drawNav(); return; }
    count.textContent = !all.length ? "Keine Unterschiede" : gs.length === all.length ? `${all.length} Stellen mit Unterschieden` : `${gs.length} von ${all.length} Stellen`;
    sums.replaceChildren(
      h("span", { style: `color:${RED};font-weight:600` }, `${c.new} nur dazu`), " · ",
      h("span", { style: `color:${YELLOW_INK};font-weight:600` }, `${c.old} nur weg`), " · ",
      h("span", { style: "font-weight:600" }, `${c.both} beides`));
    pos.textContent = gs.length ? `${CS.sel + 1} von ${gs.length}` : "–";
    drawList(); drawNav();
  }

  // List items with a small picture each; pictures are drawn when they scroll into sight.
  const thumbs = new Map(); // place -> { key, canvas }
  let queue = [], qtimer = 0;
  const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { queue.push(e.target); pump(); } }, { root: list, rootMargin: "200px 0px" });
  offs.push(() => io.disconnect());
  const thumbKey = (tw) => JSON.stringify([CV.base, CV.marks, CV.outline, CV.removed, CV.xsize, CV.fade, tw, S.result && S.result.offset]);
  function pump() {
    clearTimeout(qtimer);
    qtimer = setTimeout(() => {
      const li = queue.shift();
      if (!li) return;
      if (li.isConnected && li._g) {
        const t = thumbs.get(li._g), key = thumbKey(li._tw);
        if (!t || t.key !== key) { const c = t ? t.canvas : h("canvas", { style: "display:block;width:100%;height:100%" }); drawThumb(c, li._g, li._tw, li._th); thumbs.set(li._g, { key, canvas: c }); }
        li._box.replaceChildren(thumbs.get(li._g).canvas);
      }
      if (queue.length) pump();
    }, 10);
  }
  function drawList() {
    const gs = groups(), tw = Math.round(Math.min(220, Math.max(84, W * 0.34))), th = Math.round(tw * 0.68);
    io.disconnect(); queue = [];
    list.replaceChildren(...gs.map((g, i) => {
      const box = h("div", { style: `flex:none;width:${tw}px;height:${th}px;border-radius:6px;overflow:hidden;background:#f2f1ee;border:1px solid var(--line)` });
      const t = thumbs.get(g);
      if (t && t.key === thumbKey(tw)) box.append(t.canvas);
      const li = h("li", {
        style: `display:flex;gap:9px;align-items:flex-start;padding:7px 8px;cursor:pointer;border-radius:6px;${i === CS.sel ? "background:color-mix(in srgb,var(--accent) 12%,#fff)" : ""}`,
        onclick: () => select(i),
      }, box, h("div", { style: "min-width:0" },
        h("div", { style: "display:flex;align-items:center;gap:6px" }, h("b", { style: "font-variant-numeric:tabular-nums" }, String(i + 1)), dot(g), h("b", {}, placeLabel(g))),
        g.detail ? h("div", { style: "font-size:13px" }, g.detail) : null,
        h("div", { class: "muted", style: "font-size:13px" }, where(g)),
        h("div", { class: "hint" }, describe(g))));
      Object.assign(li, { _g: g, _tw: tw, _th: th, _box: box });
      io.observe(li);
      return li;
    }));
    const cur = list.children[CS.sel];
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }

  function drawFilterButton() {
    const on = CATS.filter(([k]) => catOn(k)).length;
    fbtn.replaceChildren(h("span", {}, "Art der Änderung"), h("span", { class: on === CATS.length ? "muted" : "", style: on === CATS.length ? "" : "color:var(--accent);font-weight:600" }, `${on === CATS.length ? "alle" : `${on} von ${CATS.length}`} ▾`));
  }
  function drawFilter() {
    const counts = {};
    for (const p of allPlaces()) counts[p.cat] = (counts[p.cat] || 0) + 1;
    const allOn = CATS.every(([k]) => catOn(k)), noneOn = CATS.every(([k]) => !catOn(k));
    const row = (checked, label, n, hint, onchange, bold = false) => {
      const inp = h("input", { type: "checkbox" });
      inp.checked = checked; inp.onchange = () => onchange(inp.checked);
      return h("label", { style: `display:grid;grid-template-columns:auto 1fr auto;gap:2px 8px;align-items:center;padding:4px 6px;border-radius:6px;cursor:pointer;${n === 0 ? "opacity:.5" : ""}` },
        inp, h("span", { style: bold ? "font-weight:600" : "" }, label), h("span", { class: "muted", style: "font-variant-numeric:tabular-nums" }, n === null ? "" : String(n)),
        hint ? h("span", { class: "hint", style: "grid-column:2/4" }, hint) : null);
    };
    const all = row(allOn, "(Alle auswählen)", allPlaces().length, null, (v) => setFilter(Object.fromEntries(CATS.map(([k]) => [k, v]))), true);
    if (!allOn && !noneOn) all.querySelector("input").indeterminate = true;
    fpanel.replaceChildren(all, h("hr", { style: "border:0;border-top:1px solid var(--line);margin:4px 0" }),
      ...CATS.map(([k, label, hint]) => row(catOn(k), label, counts[k] || 0, hint, (v) => setFilter({ ...fullFilter(), [k]: v }))),
      h("div", { style: "display:flex;justify-content:flex-end;margin-top:6px" }, h("button", { onclick: () => (fpanel.hidden = true) }, "OK")));
  }
  function drawPresets() {
    const users = userPresets();
    const match = [...BUILTIN, ...users].find((p) => sameFilter(p.filter));
    const opt = (p) => h("option", { value: p.name }, p.name);
    psel.replaceChildren(
      h("optgroup", { label: "Mitgeliefert" }, ...BUILTIN.map(opt)),
      users.length ? h("optgroup", { label: "Eigene" }, ...users.map(opt)) : null,
      match ? null : h("option", { value: "", disabled: "" }, "(eigene Auswahl, nicht gespeichert)"));
    psel.value = match ? match.name : "";
    pdel.disabled = !match || !!match.builtin;
  }

  function drawNav() {
    const gs = groups(), g = gs[CS.sel];
    nav.style.display = S.result ? "flex" : "none";
    if (!g) { navText.replaceChildren(gs.length || !allPlaces().length ? "Keine Unterschiede" : "Keine Stelle passt zum Filter"); return; }
    navText.replaceChildren(dot(g, 10), h("b", { style: "font-variant-numeric:tabular-nums" }, `${CS.sel + 1} / ${gs.length}`), h("span", {}, "·"), h("b", {}, placeLabel(g)),
      g.detail ? h("span", { style: "opacity:.8" }, g.detail) : null, h("span", { style: "opacity:.6" }, "· " + where(g)));
  }

  function drawStrip() {
    const r = strip.getBoundingClientRect(), d = devicePixelRatio;
    if (!r.width || !S.result) return;
    strip.width = r.width * d; strip.height = r.height * d;
    const ctx = strip.getContext("2d"), vert = S.axis === "y", len = vert ? r.height : r.width, thick = vert ? r.width : r.height;
    ctx.scale(d, d);
    const [w0, w1] = S.result.win, at = (t) => 4 + ((t - w0) / (w1 - w0)) * (len - 8);
    const rect = (a, b, c0, c1, col) => { ctx.fillStyle = col; if (vert) ctx.fillRect(c0, a, c1 - c0, Math.max(2, b - a)); else ctx.fillRect(a, c0, Math.max(2, b - a), c1 - c0); };
    const V = viewer.V, v0 = vert ? V.y0 : V.x0, v1 = v0 + (vert ? V.h : V.w) / V.s;
    rect(at(Math.max(v0, w0)), at(Math.min(v1, w1)), 1, thick - 1, "rgba(29,95,214,.14)");
    groups().forEach((g, i) => {
      const b = placeBox(g), k = kindOf(g), sel = i === CS.sel;
      if (k === "both") { rect(at(tLo(b)), at(tHi(b)), sel ? 1 : 5, thick / 2, YELLOW); rect(at(tLo(b)), at(tHi(b)), thick / 2, sel ? thick - 1 : thick - 5, RED); }
      else rect(at(tLo(b)), at(tHi(b)), sel ? 1 : 5, sel ? thick - 1 : thick - 5, k === "old" ? YELLOW : RED);
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
    if (!gs.length) { drawSide(); return; }
    CS.sel = (i + gs.length) % gs.length;
    drawSide(); fitPlace(viewer, gs[CS.sel]); drawStrip();
  }
  const go = (d) => select(CS.sel + d);

  offs.push(keys({ go, redraw: () => viewer.update(1) }));
  offs.push(bindRedraw(...ctrls));
  let lastFilter = JSON.stringify(fullFilter()), cvTimer = 0;
  offs.push(on((w) => {
    if (w === "cv") {
      const f = JSON.stringify(fullFilter());
      if (f !== lastFilter) {
        // Keep the same place selected if it is still shown.
        const was = allPlaces().find((p) => p === lastShown[CS.sel]);
        lastFilter = f;
        const i = groups().indexOf(was);
        CS.sel = i >= 0 ? i : 0;
        lastShown = groups();
        drawSide(); if (!fpanel.hidden) drawFilter();
      }
      viewer.update(20); drawStrip();
      clearTimeout(cvTimer); cvTimer = setTimeout(drawList, 300); // pictures follow the settings
    }
    if (w === "presets") drawPresets();
    if (w === "result") {
      lastShown = groups();
      CS.sel = Math.min(CS.sel, Math.max(0, groups().length - 1));
      if (!fitted && groups().length) { fitted = true; requestAnimationFrame(() => select(CS.sel)); }
      drawSide(); viewer.update(10); drawStrip();
    }
  }));
  let lastShown = groups();
  let fitted = !!S.result;
  drawSide();
  requestAnimationFrame(() => { if (S.result && groups().length) select(CS.sel); else fitWhole(viewer); drawStrip(); });
  new ResizeObserver(() => drawStrip()).observe(strip);
  return () => { offs.forEach((f) => f()); clearTimeout(qtimer); root.remove(); };
}
export const NAME = "Plan + Liste";
void setCV;
