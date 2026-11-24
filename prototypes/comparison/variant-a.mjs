// PROTOTYPE (throwaway) · Comparison view, variant A "Plan + Liste" (the chosen one; round 5).
// One map view of the whole Plan with all marks and a sidebar:
//   - the count, a filter by kind of change (like Excel's) and filter presets ("Vorlage"),
//   - the list of places, each with a small picture (drawn when it scrolls into sight),
//   - "Darstellung" folded away (settings are kept per browser).
// The sidebar's right edge can be dragged wider or narrower. Under the view, ◀ ▶ with the
// current place between them. A strip along the view's edge shows every place along time.
// Round 5: a selection of places, shared by list and plan, which may be empty:
//   - click a place (list or plan) to select it, click empty plan or Esc to clear;
//   - drag a box on the plan, as in CAD: left to right selects what lies fully inside (solid
//     blue), right to left what the box touches (dashed green); Shift adds, Ctrl removes (red);
//   - H or "ausblenden" hides the selection; the plan does not move, nothing stays selected.
import { S, on, h, CV, CS, setCV, groups, allPlaces, describe, placeLabel, where, dot, totals, compareViewer, fitPlace, fitWhole, keys,
  baseSwitch, outlineSlider, fadeSlider, removedSwitch, xSizeSlider, check, legend, bindRedraw, placeBox, tLo, tHi, kindOf, drawThumb,
  CATS, catOn, BUILTIN, userPresets, savePresets, fullFilter, sameFilter, setFilter, RED, YELLOW, YELLOW_INK,
  hiddenCount, setHidden, isHidden, fmt, screen, catLabel, nameOf, shapeName, lage, SRC } from "./common.mjs";

const SIDE_KEY = "compareview.side";
const MIN_SIDE = 280; // round 7: the width at which the list shows its smallest pictures
const sideWidth = () => { try { return +localStorage.getItem(SIDE_KEY) || 330; } catch { return 330; } };

export default function mount(host, { back }) {
  const offs = [];
  let W = Math.min(700, Math.max(MIN_SIDE, sideWidth()));
  // Naming ticket: three ways to show what changed (?name=1|2|3, the black bar bottom right).
  const NV = NAMINGS.some(([k]) => k === new URLSearchParams(location.search).get("name")) ? new URLSearchParams(location.search).get("name") : "1";
  if (NV === "3") W = Math.max(W, 600);

  // ---------- sidebar ----------
  const count = h("div", { style: "font-size:20px;font-weight:650;line-height:1.2" });
  const sums = h("div", { class: "hint" });
  const list = h("ol", { style: "list-style:none;margin:0;padding:0;overflow:auto;flex:1;min-height:120px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)" });

  // Filter by kind of change: a button that opens a checkbox list, like Excel's filter.
  const fbtn = h("button", { style: "flex:1;display:flex;align-items:center;gap:8px;text-align:left", title: "Nach Art der Änderung filtern" });
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

  // ---------- selection (round 5) ----------
  const sel = new Set();
  CS.selSet = sel;
  offs.push(() => { delete CS.selSet; });
  // Where ◀ ▶ go on from: an index into the shown places, or i - 0.5 ("between", after hiding).
  let anchor = CS.sel, pendingAnchor = null;
  const selRow = h("div", { style: "display:none;align-items:center;gap:6px;font-size:13px" });
  function drawSelRow() {
    if (!sel.size) { selRow.style.display = "none"; return; }
    selRow.style.display = "flex";
    selRow.replaceChildren(h("b", { style: "white-space:nowrap" }, `${sel.size} ausgewählt`), h("span", { style: "flex:1" }),
      h("button", { style: "padding:2px 8px;font-size:12px;display:flex;gap:5px;align-items:center", title: "Ausgewählte Stellen ausblenden (H)", onclick: () => hidePlaces([...sel]) }, EYE_OFF(), "ausblenden"),
      h("button", { style: "padding:2px 8px;font-size:12px", title: "Auswahl aufheben (Esc)", onclick: clearSel }, "aufheben"));
  }
  function refreshSel() { drawSelRow(); drawList(); drawNav(); drawStrip(); viewer.redrawOverlay(); }
  function clearSel() { if (!sel.size) return; sel.clear(); refreshSel(); }
  const setAnchor = (g) => { const i = groups().indexOf(g); if (i >= 0) { anchor = i; CS.sel = i; } };
  /** Select only place i of the shown ones; fit: also move the plan to it (list, ◀ ▶, strip). */
  function selectOnly(i, fit = true) {
    const gs = groups();
    if (!gs.length) return;
    anchor = ((i % gs.length) + gs.length) % gs.length; CS.sel = anchor;
    sel.clear(); sel.add(gs[anchor]); scrollToSel = true; rangeFrom = gs[anchor];
    drawSelRow(); drawList(); drawNav();
    if (fit) fitPlace(viewer, gs[anchor]);
    drawStrip(); viewer.redrawOverlay();
  }
  const go = (d) => { if (groups().length) selectOnly(d > 0 ? Math.floor(anchor) + 1 : Math.ceil(anchor) - 1); };
  function toggleSel(g, mode) {
    if (mode === "remove" || (mode === "toggle" && sel.has(g))) sel.delete(g); else { sel.add(g); setAnchor(g); }
    rangeFrom = g;
    refreshSel();
  }
  // Round 6, list selection as in Windows Explorer: Shift + click selects everything from the
  // last clicked place to this one (Ctrl + Shift adds that range to the selection).
  let rangeFrom = null;
  function selectRange(g, add) {
    const gs = groups(), b = gs.indexOf(g);
    let a = gs.indexOf(rangeFrom);
    if (a < 0) a = Number.isInteger(anchor) ? anchor : b;
    if (!add) sel.clear();
    for (let k = Math.min(a, b); k <= Math.max(a, b); k++) sel.add(gs[k]);
    setAnchor(g); // ◀ ▶ go on from the place clicked last; the range keeps its start
    refreshSel();
  }

  // Round 3/4: places that are no real change can be hidden (list, plan, ◀ ▶, export).
  let showHidden = false;
  const hiddenRow = h("div", { class: "hint", style: "display:flex;align-items:center;gap:8px;min-height:20px" });
  function drawHiddenRow() {
    const n = hiddenCount();
    if (!n) { hiddenRow.replaceChildren(); hiddenRow.style.display = "none"; showHidden = false; return; }
    hiddenRow.style.display = "flex";
    hiddenRow.replaceChildren(EYE_OFF(), `${n} ausgeblendet`, h("button", { style: "padding:1px 8px;font-size:12px", onclick: toggleShowHidden }, showHidden ? "verbergen" : "zeigen"));
  }
  // The list stays where it is when places are hidden or shown again. A hidden item folds
  // away and the items below slide up into its place; items that come back unfold.
  const SLIDE = { duration: 220, easing: "cubic-bezier(.4,0,.2,1)" };
  const folding = new Set(), unfolding = new Set();
  const liOf = (g) => [...list.children].find((li) => li._g === g);
  const fold = (li) => {
    li.style.overflow = "hidden";
    return li.animate([{ height: li.offsetHeight + "px", opacity: 1 }, { height: "0px", opacity: 0, paddingTop: "0px", paddingBottom: "0px" }], { ...SLIDE, fill: "forwards" }).finished;
  };
  /** Deselect, then hide: the plan stays where it is and nothing is selected afterwards. */
  function hidePlaces(targets) {
    targets = targets.filter((g) => !folding.has(g) && !isHidden(g));
    if (!targets.length) return;
    const gs = groups(), idx = targets.map((g) => gs.indexOf(g)).filter((i) => i >= 0);
    if (idx.length) pendingAnchor = Math.min(...idx) - 0.5; // ◀ ▶ go on from where the first one was
    for (const g of targets) sel.delete(g);
    drawSelRow(); drawNav(); viewer.redrawOverlay();
    const lis = showHidden ? [] : targets.map(liOf).filter(Boolean);
    for (const li of lis) li.style.background = "transparent";
    targets.forEach((g) => folding.add(g));
    Promise.all(lis.map(fold)).then(() => { targets.forEach((g) => folding.delete(g)); setHidden(targets, true); });
  }
  function showPlace(g) {
    setHidden(g, false);
    const li = liOf(g);
    if (li) li.animate([{ background: "color-mix(in srgb,var(--accent) 22%,#fff)" }, { background: "transparent" }], { duration: 700, easing: "ease-out" });
  }
  function toggleShowHidden() {
    if (showHidden) {
      const rows = [...list.children].filter((li) => li._off);
      Promise.all(rows.map(fold)).then(() => { showHidden = false; drawSide(); });
    } else {
      showHidden = true;
      for (const p of allPlaces()) if (catOn(p.cat) && !groups().includes(p)) unfolding.add(p);
      drawSide();
    }
  }

  const ctrls = [baseSwitch(), check("Markierungen zeigen", "marks", "M"), outlineSlider(), removedSwitch(), xSizeSlider(), fadeSlider(), check("Kleine Stellen mit Ring zeigen", "rings")];
  const aside = h("aside", { style: "position:relative;padding:14px;background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;gap:10px;min-height:0;overflow:hidden" },
    h("div", {}, count, sums),
    h("div", { style: "display:flex;align-items:center;gap:6px" }, h("span", { class: "hint" }, "Vorlage"), psel, psave, pdel),
    h("div", { style: "display:flex;align-items:center;gap:6px" }, fbtn),
    fpanel,
    hiddenRow,
    selRow,
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
  // ◀ current place ▶ (fixed width, so ◀ and ▶ stay under the pointer while stepping through).
  const navText = h("button", { title: "Zur ausgewählten Stelle", style: "flex:1;min-width:0;background:transparent;color:#fff;border:0;display:flex;align-items:center;justify-content:center;gap:8px;overflow:hidden;white-space:nowrap", onclick: () => { if (sel.size === 1) fitPlace(viewer, [...sel][0]); } });
  const navBtn = (t, d, tip) => h("button", { title: tip, style: "flex:none;background:transparent;color:#fff;border:0;border-radius:99px;padding:4px 12px;font-size:15px", onclick: () => go(d) }, t);
  const nav = h("div", { style: "position:absolute;left:50%;bottom:22px;transform:translateX(-50%);z-index:6;display:flex;align-items:center;gap:2px;padding:5px;border-radius:99px;background:#1d1d1f;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.3);font-size:13px;width:min(640px, calc(100% - 80px))" },
    navBtn("◀", -1, "Vorige Stelle (←)"), navText, navBtn("▶", 1, "Nächste Stelle (→)"));
  const main = h("div", { style: "position:relative;min-height:0;min-width:0" }, vwrap, strip, nav);
  const root = h("div", { style: `height:100%;display:grid;grid-template-columns:${W}px minmax(0,1fr)` }, aside, main);
  host.append(root);
  if (S.axis === "x") { vwrap.style.inset = "10px 10px 40px 10px"; Object.assign(strip.style, { top: "auto", left: "10px", right: "auto", bottom: "8px", width: "calc(100% - 20px)", height: "24px" }); nav.style.bottom = "48px"; }

  // ---------- picking on the plan (round 5) ----------
  let box = null; // the selection box while dragging: { a, b, mode } with a / b pointer points
  /** The smallest shown place under the pointer (its lines, areas, words, or its ring). */
  function placeAt(pt, V) {
    const tol = (Math.max(CV.outline, 3) + 3) / V.s;
    let best = null, bestA = Infinity;
    for (const g of groups()) {
      const b = placeBox(g);
      let hit = false;
      if (CV.rings && CV.marks && Math.max(b.x1 - b.x0, b.y1 - b.y0) * V.s < 18) hit = Math.hypot(pt.x - (b.x0 + b.x1) / 2, pt.y - (b.y0 + b.y1) / 2) * V.s <= 14;
      if (!hit) hit = g.items.some((it) => itemNear(it, pt, tol));
      const a = (b.x1 - b.x0) * (b.y1 - b.y0);
      if (hit && a < bestA) { bestA = a; best = g; }
    }
    return best;
  }
  function pickDown(pt, e) {
    const mode = e.ctrlKey || e.metaKey ? "remove" : e.shiftKey ? "add" : "replace", a = pt;
    box = null;
    return {
      move(p) { if (box || Math.hypot(p.px - a.px, p.py - a.py) > 4) box = { a, b: p, mode }; },
      up(p, ev, V) {
        if (!box) { clickAt(a, V, mode); return; }
        const r = { x0: Math.min(a.x, p.x), x1: Math.max(a.x, p.x), y0: Math.min(a.y, p.y), y1: Math.max(a.y, p.y) };
        const crossing = p.px < a.px; // right to left: what the box touches; left to right: what lies fully inside
        const hits = groups().filter((g) => (crossing ? touches(g, r) : encloses(g, r)));
        box = null;
        if (mode === "replace") sel.clear();
        for (const g of hits) if (mode === "remove") sel.delete(g); else sel.add(g);
        if (sel.size) { setAnchor([...sel].sort((x, y) => groups().indexOf(x) - groups().indexOf(y))[0]); scrollToSel = mode !== "remove"; }
        refreshSel();
      },
    };
  }
  function clickAt(pt, V, mode) {
    const g = placeAt(pt, V);
    if (!g) { if (mode === "replace") clearSel(); return; } // click on empty plan: nothing selected
    if (mode === "remove") return toggleSel(g, "remove");
    if (mode === "add") return toggleSel(g, "toggle");
    sel.clear(); sel.add(g); setAnchor(g); rangeFrom = g; scrollToSel = true; refreshSel(); // the plan stays where it is
  }
  const drawBox = (ctx, V) => {
    if (!box) return;
    screen(ctx, () => {
      const ax = (box.a.x - V.x0) * V.s, ay = (box.a.y - V.y0) * V.s, bx = (box.b.x - V.x0) * V.s, by = (box.b.y - V.y0) * V.s;
      const crossing = box.b.px < box.a.px;
      const col = box.mode === "remove" ? "#d0215f" : crossing ? "#16a34a" : "#1d5fd6";
      ctx.fillStyle = col + "1f"; ctx.strokeStyle = col; ctx.lineWidth = 1.3;
      ctx.setLineDash(crossing ? [6, 4] : []);
      ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      ctx.setLineDash([]);
    });
  };
  const viewer = compareViewer(vwrap, {
    onChange: () => drawStrip(),
    down: pickDown,
    hover: (pt, e, V) => (placeAt(pt, V) ? "pointer" : "crosshair"),
    overlayExtra: drawBox,
  });

  window.__cv = { viewer, sel }; // prototype: lets the headless test check that the plan does not move
  offs.push(() => { delete window.__cv; });

  grip.onpointerdown = (e) => {
    grip.setPointerCapture(e.pointerId);
    const x0 = root.getBoundingClientRect().left;
    // Round 6: the pictures follow the edge while dragging (just stretched); they are drawn
    // anew, sharp, only after letting go.
    grip.onpointermove = (ev) => {
      W = Math.round(Math.min(700, Math.max(MIN_SIDE, ev.clientX - x0)));
      root.style.gridTemplateColumns = `${W}px minmax(0,1fr)`;
      const ts = thumbSize();
      for (const li of list.children) {
        const b = li._box;
        if (!b) continue;
        if (!ts) { b.style.display = "none"; continue; }
        b.style.display = ""; b.style.width = ts.tw + "px"; b.style.height = ts.th + "px";
      }
    };
    grip.onpointerup = () => { grip.onpointermove = null; try { localStorage.setItem(SIDE_KEY, String(W)); } catch {} drawList(); };
  };
  /** Size of the small pictures for the sidebar's width; none when it is narrow. */
  // Round 7: the sidebar is never narrower than the smallest pictures need (MIN_SIDE).
  const thumbSize = () => NV === "3" ? null : ({ tw: Math.round(Math.min(220, W * 0.34)), th: Math.round(Math.min(220, W * 0.34) * 0.68) });

  // ---------- drawing the sidebar ----------
  function drawSide() {
    const gs = groups(), all = allPlaces(), c = totals();
    drawPresets(); drawFilterButton();
    drawHiddenRow(); drawSelRow();
    if (!S.result) { count.textContent = "Vergleiche…"; sums.textContent = ""; list.replaceChildren(); drawNav(); return; }
    count.textContent = !all.length ? "Keine Unterschiede" : gs.length === all.length ? `${all.length} Stellen mit Unterschieden` : `${gs.length} von ${all.length} Stellen`;
    sums.replaceChildren(
      h("span", { style: `color:${RED};font-weight:600` }, `${c.new} nur dazu`), " · ",
      h("span", { style: `color:${YELLOW_INK};font-weight:600` }, `${c.old} nur weg`), " · ",
      h("span", { style: "font-weight:600" }, `${c.both} beides`));
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
  let scrollToSel = true;
  function drawList() {
    const gs = groups(), ts = thumbSize(), tw = ts ? ts.tw : 0, th = ts ? ts.th : 0;
    // With "zeigen", hidden places are listed too (greyed, with "einblenden"); they stay off the plan.
    const rows = showHidden ? allPlaces().filter((p) => catOn(p.cat)) : gs;
    io.disconnect(); queue = [];
    const scroll = list.scrollTop; // rebuilding must not move the list
    const head = NV === "3" ? [h("li", { style: `position:sticky;top:0;z-index:1;background:#faf9f7;display:grid;grid-template-columns:${COLS};gap:0 8px;padding:6px;font-size:12px;font-weight:600;color:var(--muted);border-bottom:1px solid var(--line)` },
      h("span", {}, "Nr"), h("span", {}), h("span", {}, "Was"), h("span", {}, "Änderung"), h("span", {}, "Wo · wann"), h("span", {}))] : [];
    list.replaceChildren(...head, ...rows.map((g) => {
      const i = gs.indexOf(g), off = i < 0;
      const box = h("div", { style: `flex:none;width:${tw}px;height:${th}px;border-radius:6px;overflow:hidden;background:#f2f1ee;border:1px solid var(--line);${ts ? "" : "display:none"}` });
      // An older picture (other size or settings) stands in, stretched, until the new one is drawn.
      const t = thumbs.get(g);
      if (t && ts) box.append(t.canvas);
      // On a selected place, the button hides the whole selection (round 6).
      const many = !off && sel.has(g) && sel.size > 1;
      const tog = h("button", {
        title: off ? "Wieder einblenden" : many ? `Alle ${sel.size} ausgewählten Stellen ausblenden (H)` : "Ausblenden: keine echte Änderung (H)",
        style: "flex:none;margin-left:auto;padding:2px 6px;border-color:transparent;background:transparent;color:var(--muted)",
        onclick: (e) => { e.stopPropagation(); if (off) showPlace(g); else hidePlaces(sel.has(g) ? [...sel] : [g]); },
      }, off ? h("span", { style: "font-size:12px" }, "einblenden") : EYE_OFF());
      const li = h("li", {
        title: off ? "" : "Klicken: auswählen und hinspringen · Strg+Klick: dazu oder weg · Shift+Klick: alles bis hierher",
        style: `display:flex;gap:9px;align-items:flex-start;padding:7px 8px;cursor:${off ? "default" : "pointer"};border-radius:6px;${off ? "opacity:.45;" : ""}${sel.has(g) ? "background:color-mix(in srgb,var(--accent) 12%,#fff)" : ""}`,
        onmousedown: (e) => { if (e.shiftKey) e.preventDefault(); }, // no text selection on Shift + click
        onclick: (e) => {
          if (off) return;
          const ctrl = e.ctrlKey || e.metaKey;
          if (e.shiftKey) selectRange(g, ctrl);
          else if (ctrl) toggleSel(g, "toggle");
          else selectOnly(i);
        },
      }, box, ...rowBody(g, off ? "–" : String(i + 1), tog));
      if (NV === "3") { li.style.display = "grid"; li.style.gridTemplateColumns = COLS; li.style.alignItems = "baseline"; li.style.padding = "5px 6px"; li.style.gap = "0 8px"; li.style.borderBottom = "1px solid #f0efec"; li.style.borderRadius = "0"; }
      Object.assign(li, { _g: g, _tw: tw, _th: th, _box: box, _off: off });
      if (ts) io.observe(li);
      return li;
    }));
    list.scrollTop = scroll;
    for (const li of list.children) {
      if (!unfolding.has(li._g)) continue;
      li.style.overflow = "hidden";
      li.animate([{ height: "0px", opacity: 0, paddingTop: "0px", paddingBottom: "0px" }, { height: li.offsetHeight + "px", opacity: li._off ? 0.45 : 1 }], SLIDE);
    }
    unfolding.clear();
    // Scroll only when the user picked a place (◀ ▶, list, plan, strip), not on hide / show.
    if (scrollToSel) {
      scrollToSel = false;
      const cur = [...list.children].find((li) => sel.has(li._g));
      if (cur) cur.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function drawFilterButton() {
    const on = CATS.filter(([k]) => catOn(k)).length;
    fbtn.replaceChildren(FUNNEL(), h("span", { style: "flex:1" }, "Filter"), h("span", { class: on === CATS.length ? "muted" : "", style: on === CATS.length ? "" : "color:var(--accent);font-weight:600" }, `${on === CATS.length ? "alle" : `${on} von ${CATS.length}`} ▾`));
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
    const gs = groups();
    nav.style.display = S.result ? "flex" : "none";
    if (!gs.length) { navText.replaceChildren(allPlaces().length ? "Keine Stelle passt zum Filter" : "Keine Unterschiede"); return; }
    if (sel.size > 1) { navText.replaceChildren(h("b", {}, `${sel.size} ausgewählt`), h("span", { style: "opacity:.7" }, "· H blendet sie aus · Esc hebt auf")); return; }
    const g = sel.size ? [...sel][0] : null;
    if (!g) { navText.replaceChildren(h("span", { style: "opacity:.75" }, `Keine Auswahl · ${gs.length} Stellen`)); return; }
    navText.replaceChildren(dot(g, 10), h("b", { style: "font-variant-numeric:tabular-nums" }, String(gs.indexOf(g) + 1)), h("span", {}, "·"), ...navBody(g));
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
    groups().forEach((g) => {
      const b = placeBox(g), k = kindOf(g), on = sel.has(g);
      if (k === "both") { rect(at(tLo(b)), at(tHi(b)), on ? 1 : 5, thick / 2, YELLOW); rect(at(tLo(b)), at(tHi(b)), thick / 2, on ? thick - 1 : thick - 5, RED); }
      else rect(at(tLo(b)), at(tHi(b)), on ? 1 : 5, on ? thick - 1 : thick - 5, k === "old" ? YELLOW : RED);
      if (on) { ctx.strokeStyle = "#1d1d1f"; ctx.lineWidth = 1.5; const a = at(tLo(b)) - 2, z = Math.max(at(tHi(b)) + 2, a + 5); if (vert) ctx.strokeRect(0.75, a, thick - 1.5, z - a); else ctx.strokeRect(a, 0.75, z - a, thick - 1.5); }
    });
  }
  strip.onclick = (e) => {
    const r = strip.getBoundingClientRect(), [w0, w1] = S.result.win, vert = S.axis === "y";
    const t = w0 + ((vert ? e.clientY - r.top : e.clientX - r.left) - 4) / ((vert ? r.height : r.width) - 8) * (w1 - w0);
    let best = -1, bd = Infinity;
    groups().forEach((g, i) => { const b = placeBox(g), c = (tLo(b) + tHi(b)) / 2, dd = Math.abs(c - t); if (dd < bd) { bd = dd; best = i; } });
    const px = bd / (w1 - w0) * (vert ? r.height : r.width);
    if (best >= 0 && px < 12) selectOnly(best);
    else { const V = viewer.V; if (vert) viewer.setView(V.x0, t - V.h / 2 / V.s); else viewer.setView(t - V.w / 2 / V.s, V.y0); }
  };

  offs.push(keys({ go, redraw: () => viewer.update(1), hide: () => hidePlaces([...sel]), esc: clearSel }));
  offs.push(bindRedraw(...ctrls));

  // "Änderungen exportieren" (top right): the list as shown (filter applied, hidden ones left out),
  // as a CSV that Excel opens (semicolons, UTF-8 with BOM).
  S.exportChanges = () => {
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Nr", "Name", "Name gefunden über", "Art", "Detail", "Lage", "Lage (m Plan)", "Neu / weg", "Objekte", "Alter Plan", "Neuer Plan", "Versatz (mm)"];
    const n = S.names || {}, kindWord = { new: "dazugekommen", old: "weggefallen", both: "beides" };
    const rows = groups().map((g, i) => [i + 1, nameOf(g) || shapeName(g), g.nm && g.nm.src ? SRC[g.nm.src] : "Form", placeLabel(g), g.detail || "", lage(g), fmt(tLo(placeBox(g)) / 1000, 2), kindWord[kindOf(g)], describe(g), n.old || "", n.new || "", fmt(S.offset, 2)]);
    const csv = "﻿" + [head, ...rows].map((r) => r.map(q).join(";")).join("\r\n");
    const a = h("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: `Aenderungen ${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); a.remove();
  };
  offs.push(() => { delete S.exportChanges; });

  /** After the shown places changed: drop what is no longer shown from the selection. */
  function pruneSel() {
    const gs = new Set(groups());
    for (const g of [...sel]) if (!gs.has(g)) sel.delete(g);
    if (sel.size === 1) setAnchor([...sel][0]);
    else anchor = Math.min(anchor, Math.max(0, gs.size - 1));
  }
  let lastFilter = JSON.stringify(fullFilter()), cvTimer = 0;
  offs.push(on((w) => {
    if (w === "cv") {
      const f = JSON.stringify(fullFilter());
      if (f !== lastFilter) { lastFilter = f; pruneSel(); drawSide(); if (!fpanel.hidden) drawFilter(); }
      viewer.update(20); drawStrip();
      clearTimeout(cvTimer); cvTimer = setTimeout(drawList, 300); // pictures follow the settings
    }
    if (w === "presets") drawPresets();
    if (w === "hidden") {
      // Nothing moves: the plan stays, the list stays, nothing new gets selected.
      pruneSel();
      if (pendingAnchor !== null) { anchor = pendingAnchor; pendingAnchor = null; }
      drawSide(); drawStrip(); viewer.update(10);
    }
    if (w === "result") {
      sel.clear(); // new places: the old selection does not apply
      if (!fitted && groups().length) { fitted = true; requestAnimationFrame(() => selectOnly(Math.min(CS.sel, groups().length - 1))); }
      drawSide(); viewer.update(10); drawStrip();
    }
  }));
  let fitted = !!S.result;
  drawSide();
  requestAnimationFrame(() => { if (S.result && groups().length) selectOnly(Math.min(CS.sel, groups().length - 1)); else fitWhole(viewer); drawStrip(); });
  new ResizeObserver(() => drawStrip()).observe(strip);
  return () => { offs.forEach((f) => f()); clearTimeout(qtimer); root.remove(); };
}
export const NAME = "Plan + Liste";
void setCV;

// ---------- geometry for picking ----------

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const u = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - ax - u * dx, py - ay - u * dy);
}
/** Is the pointer on this changed item: near one of its line segments, or inside its box. */
function itemNear(it, p, tol) {
  const b = it.box;
  if (p.x < b.x0 - tol || p.x > b.x1 + tol || p.y < b.y0 - tol || p.y > b.y1 + tol) return false;
  if (!it.segs) return true;
  const k = it.segs, hw = it.o && it.o.nums ? it.o.nums[0] / 2 : 0;
  for (let q = 0; q + 3 < k.length; q += 4) if (distSeg(p.x, p.y, k[q], k[q + 1], k[q + 2], k[q + 3]) <= tol + hw) return true;
  return false;
}
const inRect = (b, r) => b.x0 >= r.x0 && b.x1 <= r.x1 && b.y0 >= r.y0 && b.y1 <= r.y1;
const overlaps = (b, r) => b.x0 <= r.x1 && b.x1 >= r.x0 && b.y0 <= r.y1 && b.y1 >= r.y0;
/** Liang–Barsky: does the segment touch the rectangle? */
function segTouches(x0, y0, x1, y1, r) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  for (const [p, q] of [[-dx, x0 - r.x0], [dx, r.x1 - x0], [-dy, y0 - r.y0], [dy, r.y1 - y0]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}
/** Crossing box: the place counts when any of its lines, areas or words touches the box. */
const touches = (g, r) => g.items.some((it) => {
  if (!overlaps(it.box, r)) return false;
  if (!it.segs) return true;
  const k = it.segs;
  for (let q = 0; q + 3 < k.length; q += 4) if (segTouches(k[q], k[q + 1], k[q + 2], k[q + 3], r)) return true;
  return false;
});
/** Window box: the place counts only when all of it lies inside the box. */
const encloses = (g, r) => g.items.every((it) => inRect(it.box, r));

// Small grey icons (drawn here, simple shapes).
const icon = (inner, title = "") => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("width", "15"); s.setAttribute("height", "15"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "#8a8a90"); s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.style.flex = "none"; s.innerHTML = inner; if (title) s.setAttribute("aria-label", title); return s; };
const FUNNEL = () => icon('<path d="M3 4h18l-7 8.5V19l-4 2v-8.5z"/>', "Filter");
const EYE_OFF = () => icon('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/>', "ausblenden");

// ---------- naming ticket: three ways to show what changed ----------

/** [key, name]; ?name=… picks one, the black bar bottom right switches. */
export const NAMINGS = [["1", "Name zuerst"], ["2", "Ein Satz"], ["3", "Tabelle"]];
const COLS = "26px 10px minmax(0,1.25fr) minmax(0,1fr) minmax(0,1.15fr) 26px";
const nv = () => { const v = new URLSearchParams(location.search).get("name"); return NAMINGS.some(([k]) => k === v) ? v : "1"; };

/** The name, or the shape in grey when none was found. */
function nameEl(g, style = "") {
  const n = nameOf(g);
  return n ? h("b", { style }, n) : h("span", { style: `color:var(--muted);font-weight:600;${style}`, title: "Kein Name gefunden: die Form" }, shapeName(g));
}
/** How the name was found, plus notes (a bar's own text, an ambiguous leader). */
function srcNote(g) {
  const nm = g.nm || {};
  const bits = [nm.src ? SRC[nm.src] : "kein Name gefunden: Form und Lage"];
  if (nm.ambiguous) bits.push("mehrdeutig: die Linie erreicht mehrere Texte");
  if (nm.label && g.cat !== "text") bits.push(`am Balken: »${nm.label}«`);
  if (g.joined) bits.push("Beschriftung mit dabei");
  return bits.join(" · ");
}
/** "Später · um 3 Tage", for a changed label with old and new text. */
function changeText(g) {
  const nm = g.nm || {};
  if (g.cat === "text") {
    if (nm.label && nm.old) return `${catLabel(g.cat)}: »${nm.old}« → »${nm.label}«`;
    if (nm.old) return `${catLabel(g.cat)} · vorher »${nm.old}«`;
    return catLabel(g.cat);
  }
  return [catLabel(g.cat), g.detail].filter(Boolean).join(" · ");
}
/** One sentence: "Gleis 1 erneuern 3 Tage später". */
function sentence(g) {
  const nm = g.nm || {}, d = g.detail || "", amt = d.replace(/^um /, "");
  const what = {
    later: `${amt} später`, earlier: `${amt} früher`, longer: `länger: ${d}`, shorter: `kürzer: ${d}`, across: `quer verschoben ${d}`,
    text: nm.label && nm.old ? `Text am Balken geändert: »${nm.old}« → »${nm.label}«` : nm.old ? `umbenannt, vorher »${nm.old}«` : "Beschriftung geändert",
    added: "neu", removed: "entfallen", recolour: "umgefärbt", other: d ? `geändert (${d})` : "geändert",
  }[g.cat] || catLabel(g.cat);
  return nameOf(g) ? [h("b", {}, nameOf(g)), " ", what] : [h("span", { style: "color:var(--muted);font-weight:600" }, shapeName(g)), " ", lage(g), " ", what];
}

function rowBody(g, num, tog) {
  const NV = nv(), numEl = h("b", { style: "font-variant-numeric:tabular-nums" }, num);
  if (NV === "2") return [h("div", { style: "min-width:0;flex:1" },
    h("div", { style: "display:flex;align-items:flex-start;gap:6px" }, numEl, h("span", { style: "margin-top:4px" }, dot(g)), h("span", { style: "flex:1;min-width:0" }, ...sentence(g)), tog),
    nameOf(g) ? h("div", { class: "muted", style: "font-size:13px" }, lage(g)) : null,
    h("div", { class: "hint" }, srcNote(g)))];
  if (NV === "3") {
    const nm = g.nm || {};
    return [numEl, dot(g), h("span", { title: srcNote(g), style: "min-width:0;overflow-wrap:anywhere" }, nameEl(g)),
      h("span", { style: "font-size:13px;min-width:0" }, changeText(g)),
      h("span", { class: "muted", style: "font-size:12px;min-width:0;display:flex;flex-direction:column" }, nm.km || nm.dates ? [nm.km && h("span", {}, nm.km), nm.dates && h("span", {}, nm.dates), nm.row && nm.src !== "Zeile" && h("span", {}, `in »${nm.row}«`)].filter(Boolean) : lage(g)),
      tog];
  }
  return [h("div", { style: "min-width:0;flex:1" },
    h("div", { style: "display:flex;align-items:center;gap:6px" }, numEl, dot(g), nameEl(g, "min-width:0;flex:1"), tog),
    h("div", { style: "font-size:13px" }, changeText(g)),
    h("div", { class: "muted", style: "font-size:13px" }, lage(g)),
    h("div", { class: "hint" }, srcNote(g)))];
}
function navBody(g) {
  if (nv() === "2") return [h("span", { style: "overflow:hidden;text-overflow:ellipsis" }, ...sentence(g))];
  return [nameEl(g, "color:inherit;overflow:hidden;text-overflow:ellipsis"), h("span", { style: "opacity:.8" }, "· " + changeText(g)), h("span", { style: "opacity:.6;overflow:hidden;text-overflow:ellipsis" }, "· " + lage(g))];
}
