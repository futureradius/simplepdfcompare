// PROTOTYPE (throwaway) · Variant A "Schritte" (round 2, after the user's feedback):
// aligning is its own guided step before the comparison.
//   1 Time direction → 2 Old Plan → 3 New Plan → 4 Offset → compare
// Steps unlock one by one: done steps and the next one are clickable, later ones grey.
// Steps 2 and 3: one full view of the Plan (zoom and pan freely), no Difference marks.
//   Header, Footer and Ignored areas are zones with a name tag, their size in mm and a
//   separate × bubble. The Header and Footer lines are always there (thick blue), even
//   when the zone is deleted: pull the top line down (or the bottom line up) to bring it
//   back. Drag anywhere to make a free zone; edges and corners have handles like the Clip
//   in simplepdfclipper. "⇕" stretches a zone over the whole length (a sidebar).
//   Step 3 shows the Old Plan's zones as hatched, dashed ghosts, with the New Plan's own
//   zones (copied from the Old Plan) on top in blue.
// Step 4: one overlay view; drag the Plan to slide it (snaps to the suggestions), or pick a
//   suggestion button, nudge, or type.
// Navigation in every view: wheel zooms; middle/right mouse button or Space + drag pans.
import { createViewer, tint, grayToImage } from "./viewer.mjs";
import * as E from "./engine.mjs";
import {
  S, on, emit, h, L, A, fmt, rectTA, tOf, aOf, setAxis, setLine, setOffset, layerCache, lineDrag, hitLine,
  addIgnore, removeIgnore, recalc, bandRect, offsetText, nudgeKeys, COLORS, fillRect, strokeRect, lineAcross, setLive, setPair,
} from "./shared.mjs";

const STEPS = ["Zeitrichtung", "Alter Plan", "Neuer Plan", "Versatz"];
const BLUE = COLORS.line, ZONE_FILL = "rgba(29,95,214,.10)";
// Naming ticket, round 2: optional axis zones, light red. They tell the comparison where the
// dates, the km and the names of the rows are, instead of guessing. They are only read: the
// comparison is the same with or without them. The New Plan gets them from the Old Plan.
export const AXES = { time: ["Zeitachse", "Datum, KW, Monat"], dist: ["Wegachse", "km"], rows: ["Vorgänge", "Namen der Zeilen (Balkenplan)"] };
const AX_RED = "#c8372d", AX_FILL = "rgba(220,42,30,.10)";
const ROLES = [null, "time", "dist", "rows"];
const zoneName = (ig) => (ig.role ? AXES[ig.role][0] : ig.kind === "band" ? "Randstreifen" : "Bereich");

export default function mount(stage) {
  // Per pair: how many steps are confirmed, and whether the New Plan got the Old Plan's zones.
  if (S._aFor !== S.plans) { S._aFor = S.plans; S._aConfirmed = 0; S._aNewInit = false; }
  // This variant keeps zones per Plan; "both" from variants B/C belongs to the Old Plan here.
  for (const ig of S.ignores) if (ig.plan === "both") ig.plan = "old";

  let step = Math.min(S._aConfirmed, 3), done = S._aConfirmed >= 4, guides = [];
  const offs = [];
  const root = h("div", { style: "display:flex;flex-direction:column;height:100%" });
  const nav = h("nav", { style: "display:flex;align-items:center;gap:4px;padding:10px 14px;background:#fff;border-bottom:1px solid var(--line)" });
  const body = h("div", { style: "flex:1;min-height:0;display:grid;grid-template-columns:320px minmax(0,1fr)" });
  root.append(nav, body);
  stage.append(root);

  function drawNav() {
    const c = S._aConfirmed;
    nav.replaceChildren(
      ...STEPS.map((name, i) => h("button", {
        class: i === step && !done ? "on" : "",
        style: "border-radius:99px" + (i > c ? ";opacity:.4;cursor:not-allowed" : ""),
        disabled: i > c ? "" : null,
        title: i > c ? "Erst die Schritte davor bestätigen" : "",
        onclick: () => { if (i <= c) { done = false; show(i); } },
      }, `${i < c ? "✓" : i + 1} ${name}`)),
      h("span", { style: "flex:1" }),
      h("span", { class: "muted", style: "margin-right:8px" }, S.live ? S.busy || "" : ""),
      // Comparison-view prototype, round 3: while comparing, this button exports the list of changes.
      done && S.exportChanges
        ? h("button", { class: "primary", title: "Die Liste der Änderungen (wie gefiltert, ohne ausgeblendete) als Tabelle speichern", onclick: () => S.exportChanges() }, "Änderungen exportieren ⤓")
        : h("button", { class: "primary", disabled: c >= 3 ? null : "", title: c >= 3 ? "" : "Erst alle Schritte durchgehen", onclick: () => { S._aConfirmed = 4; done = true; show(step); } }, "Vergleichen →"),
    );
    for (const b of nav.querySelectorAll("button[disabled]")) b.disabled = true;
  }
  const confirm = (i) => { S._aConfirmed = Math.max(S._aConfirmed, i + 1); };

  function clear() { while (offs.length) offs.pop()(); body.replaceChildren(); }
  function show(i) {
    step = i; clear();
    // The Offset search and the comparison only run from the Offset step on.
    setLive(done || i === 3);
    drawNav();
    if (done) return result();
    [stepDirection, () => stepPlan("old"), () => stepPlan("new"), stepOffset][i]();
  }
  const offBusy = on((w) => (w === "busy" || w === "result") && drawNav());

  const side = (...kids) => h("aside", { style: "padding:16px;background:#fff;border-right:1px solid var(--line);overflow:auto;display:flex;flex-direction:column;gap:12px" }, ...kids);
  const nextBack = (back, next, label = "Weiter") => h("div", { style: "display:flex;gap:8px;margin-top:auto;padding-top:12px" },
    back !== null ? h("button", { onclick: () => show(back) }, "← Zurück") : null, h("span", { style: "flex:1" }), h("button", { class: "primary", onclick: next }, label + " →"));
  const navHint = () => h("p", { class: "hint", style: "margin:0" }, h("kbd", {}, "Mausrad"), " zoomen · ", "rechte oder mittlere Maustaste + Ziehen: verschieben");
  const mainView = () => { const v = h("div", { class: "view", style: "position:absolute;inset:10px;border:1px solid var(--line);border-radius:8px" }); body.append(h("div", { style: "position:relative;min-height:0" }, v)); return v; };
  const fitWhole = (viewer, which, shift = 0) => viewer.fit(rectTA(shift, shift + L(which), 0, A(which)), 24);
  const jump = (viewer, t, at) => {
    const V = viewer.V, a = A("old"), s = S.axis === "y" ? (V.w - 40) / a : (V.h - 40) / a;
    if (S.axis === "y") viewer.setView(-20 / s, t - at * V.h / s, s); else viewer.setView(t - at * V.w / s, -20 / s, s);
  };

  // ---------- 1 Time direction ----------
  // One view. Top left: a switch Old / New to look at either Plan, and a bubble that swaps
  // them in case they were picked the wrong way round.
  function stepDirection() {
    let which = "old";
    const seg = h("div", { class: "seg" },
      h("button", { class: S.axis === "y" ? "on" : "", style: "padding:14px 18px;font-size:15px", onclick: () => { setAxis("y"); resetPairSteps(); show(0); } }, "↓ nach unten"),
      h("button", { class: S.axis === "x" ? "on" : "", style: "padding:14px 18px;font-size:15px", onclick: () => { setAxis("x"); resetPairSteps(); show(0); } }, "→ nach rechts"));
    const tall = S.plans.old.pageMm[1] > S.plans.old.pageMm[0];
    body.append(side(
      h("h3", { style: "margin:0" }, "In welche Richtung läuft die Zeit?"),
      seg,
      h("p", { class: "hint", style: "margin:0" }, `Vorgeschlagen: ${tall ? "nach unten, weil der Plan hochkant ist" : "nach rechts, weil der Plan quer ist"}. In diese Richtung verschiebt sich der Plan zwischen zwei Ständen.`),
      h("p", { class: "hint", style: "margin:0" }, "Oben links im Plan zwischen altem und neuem Plan umschalten. Falsch herum gewählt? ", h("b", {}, "⇄"), " tauscht die beiden."),
      S.bodyFrom === "remembered" ? h("p", { style: "margin:0;padding:8px 10px;border-radius:8px;background:color-mix(in srgb,var(--accent) 10%,#fff)" }, "Kopf, Fuß und ignorierte Bereiche sind vom letzten Vergleich übernommen. Bitte in den nächsten Schritten prüfen.") : null,
      nextBack(null, () => { confirm(0); show(1); }),
    ));
    const v = mainView(), cache = layerCache();
    const vw = createViewer(v, { paint: (view, w, hh) => grayToImage(cache(which, view, w, hh, 0), w, hh) });
    // The switch and the swap bubble, as page elements over the view.
    // The words are the switch: a coloured pill slides behind the word that is shown.
    const knob = h("span", { style: "position:absolute;top:3px;bottom:3px;left:3px;width:calc(50% - 3px);border-radius:99px;transition:transform .18s ease, background .18s;box-shadow:0 1px 3px rgba(0,0,0,.25)" });
    const word = (t) => h("span", { style: "position:relative;z-index:1;width:56px;text-align:center;font-weight:650;transition:color .18s" }, t);
    const lOld = word("Alt"), lNew = word("Neu");
    const fname = h("div", { class: "hint", style: "margin-top:6px;max-width:440px;overflow-wrap:anywhere;padding:3px 8px;border-radius:6px;background:rgba(255,255,255,.95)" });
    const sw = h("button", { title: "Zwischen altem und neuem Plan umschalten", "aria-label": "Alten oder neuen Plan zeigen", style: "position:relative;display:inline-flex;align-items:center;border-radius:99px;padding:7px 3px;box-shadow:0 2px 8px rgba(0,0,0,.12)", onclick: () => { which = which === "old" ? "new" : "old"; drawSwitch(); vw.update(10); requestAnimationFrame(() => fitWhole(vw, which)); } }, knob, lOld, lNew);
    const swap = h("button", { title: "Reihenfolge tauschen: der alte Plan wird zum neuen und umgekehrt", style: "border-radius:50%;width:36px;height:36px;padding:0;font-size:17px;box-shadow:0 2px 8px rgba(0,0,0,.12)", onclick: swapPlans }, "⇄");
    const drawSwitch = () => {
      const n = which === "new";
      knob.style.transform = n ? "translateX(100%)" : "none";
      knob.style.background = n ? COLORS.new : COLORS.old;
      lOld.style.color = n ? "var(--muted)" : "#fff"; lNew.style.color = n ? "#fff" : "var(--muted)";
      const names = S.names || {};
      fname.textContent = `${n ? "Neuer" : "Alter"} Plan: ${names[which] || "–"} · ${S.plans[which].pageMm.map((x) => fmt(x, 0)).join(" × ")} mm`;
    };
    drawSwitch();
    v.parentElement.append(h("div", { style: "position:absolute;top:20px;left:20px;z-index:3" }, h("div", { style: "display:flex;gap:8px;align-items:center" }, sw, swap), fname));
    requestAnimationFrame(() => fitWhole(vw, which));
  }
  function swapPlans() {
    const p = S.plans, n = S.names || {};
    S.names = { old: n.new, new: n.old };
    setPair({ old: p.new, new: p.old }, S.pairName);
    S._aFor = S.plans; resetPairSteps();
    show(0);
  }
  function resetPairSteps() { S._aConfirmed = 0; S._aNewInit = false; }

  // ---------- 2 / 3 one Plan, zones ----------
  function stepPlan(which) {
    if (which === "new" && !S._aNewInit) { copyFromOld(); S._aNewInit = true; }
    const name = which === "old" ? "alten" : "neuen";
    const fields = [0, 1].map((idx) => { const inp = h("input", { type: "number", step: "0.5" }); inp.onchange = () => setLine(which, idx, idx ? L(which) - +inp.value : +inp.value); return inp; });
    const sync = () => fields.forEach((f, i) => { if (document.activeElement !== f) f.value = (i ? L(which) - S.body[which][1] : S.body[which][0]).toFixed(1); });
    let viewer;
    body.append(side(
      h("h3", { style: "margin:0" }, `${which === "old" ? "2" : "3"} · Bereiche im ${name} Plan`),
      which === "old"
        ? h("p", { style: "margin:0" }, "Alles, was ", h("b", {}, "blau"), " hinterlegt ist, wird nicht verglichen: der ", h("b", {}, "Kopf"), " oben, der ", h("b", {}, "Fuß"), " unten und Bereiche, die nicht zählen, z. B. eine Randspalte.")
        : h("p", { style: "margin:0" }, "Die Bereiche sind vom alten Plan übernommen (", h("b", {}, "blau"), "). Wo sie im alten Plan lagen, zeigt die ", h("b", {}, "graue Schraffur"), ". Bitte prüfen und anpassen."),
      h("ul", { class: "hint", style: "margin:0;padding-left:18px" },
        h("li", {}, "Im Plan ziehen: neuen Bereich anlegen"),
        h("li", {}, "Kanten und Ecken ziehen: Bereich anpassen; innen ziehen: verschieben. Kanten rasten an Linien im Plan ein (", h("kbd", {}, "Alt"), ": frei)"),
        h("li", {}, h("b", {}, "⇕"), " am Bereich: über die ganze Länge (Randspalte)"),
        h("li", {}, "Blaue Linie oben oder unten ziehen: Kopf bzw. Fuß; rastet an durchgehenden Linien ein (", h("kbd", {}, "Alt"), ": frei)"),
        h("li", {}, h("b", {}, "×"), " am Bereich: löschen")),
      axisPicker(),
      navHint(),
      h("div", { style: "display:flex;gap:6px;flex-wrap:wrap" },
        h("button", { onclick: () => fitWhole(viewer, which) }, "Ganzer Plan"),
        h("button", { onclick: () => jump(viewer, S.body[which][0], 0.3) }, "Kopf"),
        h("button", { onclick: () => jump(viewer, S.body[which][1], 0.7) }, "Fuß")),
      h("details", {}, h("summary", { class: "hint", style: "cursor:pointer" }, "Genau eingeben"),
        h("div", { style: "margin-top:6px" }, h("label", {}, "Kopf ", fields[0], " mm hoch"), h("br"), h("label", {}, "Fuß ", fields[1], " mm hoch"))),
      which === "old"
        ? h("button", { onclick: resetOld, title: "Kopf und Fuß wie erkannt, keine weiteren Bereiche" }, "↺ Zurücksetzen")
        : h("button", { onclick: copyFromOld, title: "Alle Bereiche wieder genau wie im alten Plan" }, "↺ Zurücksetzen: wie im alten Plan"),
      nextBack(which === "old" ? 0 : 1, () => { confirm(which === "old" ? 1 : 2); show(which === "old" ? 2 : 3); }),
    ));
    sync();
    const cache = layerCache();
    let hits = [], temp = null;
    guides = [];
    const boxes = () => S.ignores.filter((ig) => ig.plan === which);

    viewer = createViewer(mainView(), {
      paint: (view, w, hh) => grayToImage(cache(which, view, w, hh, 0), w, hh),
      overlay: (ctx, V) => {
        hits = [];
        const tags = [];
        // Ghosts of the Old Plan's zones (step 3 only).
        if (which === "new") for (const z of oldZonesOnNew()) {
          ctx.fillStyle = stripes(ctx, V); fillRect(ctx, z.rect, ctx.fillStyle);
          strokeRect(ctx, V, z.rect, "#6b6b70", 1.3, [6, 4]);
          tags.push({ rect: z.rect, parts: [{ text: "alter Plan · " + z.label, bg: "#7a7a80" }] });
        }
        // This Plan's zones.
        const [hd, ft] = S.body[which];
        if (hd > 0.5) {
          const r = rectTA(0, hd, 0, A(which));
          fillRect(ctx, r, ZONE_FILL);
          tags.push({ rect: r, parts: [{ text: `Kopf · ${fmt(hd)} mm`, bg: BLUE }, { text: "×", bg: "#fff", fg: BLUE, title: "Kopf löschen", fn: () => setLine(which, 0, 0) }] });
        }
        if (L(which) - ft > 0.5) {
          const r = rectTA(ft, L(which), 0, A(which));
          fillRect(ctx, r, ZONE_FILL);
          tags.push({ rect: r, parts: [{ text: `Fuß · ${fmt(L(which) - ft)} mm`, bg: BLUE }, { text: "×", bg: "#fff", fg: BLUE, title: "Fuß löschen", fn: () => setLine(which, 1, L(which)) }] });
        }
        for (const ig of boxes()) {
          const r = zoneRect(ig, which), [a0, a1] = acrossOf(r), [t0, t1] = alongOf(r);
          const col = ig.role ? AX_RED : BLUE;
          fillRect(ctx, r, ig.role ? AX_FILL : ZONE_FILL);
          strokeRect(ctx, V, r, col, 1.5);
          handles(ctx, V, r, ig.kind === "band");
          const band = ig.kind === "band";
          tags.push({ rect: r, parts: [
            { text: band ? `${zoneName(ig)} · ${fmt(a1 - a0, 0)} mm breit` : `${zoneName(ig)} · ${fmt(a1 - a0, 0)} × ${fmt(t1 - t0, 0)} mm`, bg: col },
            { text: ig.role ? "Art ⟳" : "als Achse ⟳", bg: "#fff", fg: col, title: "Art wechseln: Bereich → Zeitachse → Wegachse → Vorgänge → Bereich", fn: () => cycleRole(ig) },
            { text: band ? "⇕ ganze Länge ✓" : "⇕", bg: "#fff", fg: col, title: band ? "Wieder nur ein Ausschnitt" : "Über die ganze Länge (Randspalte)", fn: () => toggleBand(ig, V) },
            { text: "×", bg: "#fff", fg: col, title: ig.role ? "Achse löschen" : "Bereich löschen", fn: () => removeIgnore(ig.id) },
          ] });
        }
        if (temp) { const c = arm ? AX_RED : BLUE; fillRect(ctx, temp, arm ? "rgba(220,42,30,.18)" : "rgba(29,95,214,.18)"); strokeRect(ctx, V, temp, c, 1.5, [5, 4]); }
        for (const g of guides) { // snap guides, amber like in simplepdfclipper
          ctx.save(); ctx.strokeStyle = COLORS.snap; ctx.lineWidth = 2 / V.s; ctx.beginPath();
          if (g.dir === "x") { ctx.moveTo(g.pos, g.lo); ctx.lineTo(g.pos, g.hi); } else { ctx.moveTo(g.lo, g.pos); ctx.lineTo(g.hi, g.pos); }
          ctx.stroke(); ctx.restore();
        }
        // Header and Footer lines: always there, thick, even when their zone is deleted.
        for (const i of [0, 1]) {
          const t = S.body[which][i], snapped = S.snapHint && S.snapHint.plan === which && S.snapHint.idx === i;
          lineAcross(ctx, V, t, -0.01 * A(which), 1.01 * A(which), { color: snapped ? COLORS.snap : BLUE, px: 4 });
        }
        // Tags last, in screen px, with clickable bubbles.
        screen(ctx, () => {
          placed = [];
          for (const tg of tags) zoneTag(ctx, V, tg.rect, tg.parts, hits);
          for (const i of [0, 1]) {
            const t = S.body[which][i], empty = i ? L(which) - t < 0.5 : t < 0.5;
            if (!empty) continue;
            const txt = S.axis === "y" ? (i ? "↑ Fuß aufziehen" : "↓ Kopf aufziehen") : (i ? "← Fuß aufziehen" : "→ Kopf aufziehen");
            const mid = (A(which) / 2 - (S.axis === "y" ? V.x0 : V.y0)) * V.s, at = (t - (S.axis === "y" ? V.y0 : V.x0)) * V.s;
            const w = textW(ctx, txt) + 16;
            const x = S.axis === "y" ? clamp(mid - w / 2, 4, V.w - w - 4) : at + (i ? -w - 2 : 2), y = S.axis === "y" ? at + (i ? -24 : 2) : clamp(mid - 11, 4, V.h - 26);
            pill(ctx, x, y, txt, { bg: BLUE });
            hits.push({ x, y, w, h: 22, drag: () => lineDrag(which, i, 0) });
          }
        });
      },
      hover: (pt, e, V) => {
        if (hits.some((b) => inBox(b, pt))) return "pointer";
        if (arm) return "crosshair";
        if (hitLine(which, pt, V, 0) >= 0) return S.axis === "y" ? "ns-resize" : "ew-resize";
        for (const ig of [...boxes()].reverse()) { const c = hitBox(ig, zoneRect(ig, which), pt, 7 / V.s); if (c) return CURSOR[c]; }
        return "crosshair";
      },
      down: (pt, e, V) => {
        const b = [...hits].reverse().find((x) => inBox(x, pt));
        if (b) { if (b.drag) return b.drag(); b.fn(); return {}; }
        const li = hitLine(which, pt, V, 0);
        if (li >= 0) return lineDrag(which, li, 0);
        if (!arm) for (const ig of [...boxes()].reverse()) { const c = hitBox(ig, zoneRect(ig, which), pt, 7 / V.s); if (c) return reshape(ig, c, pt); }
        // A new free zone (or the armed axis); all four edges snap.
        const p0 = pt;
        temp = rectFrom(p0, p0);
        return {
          move: (p, ev, VV) => { temp = snapRect(rectFrom(p0, p), ["x0", "x1", "y0", "y1"], which, VV, ev.altKey); },
          up: (p, ev, VV) => {
            const r = temp; temp = null; guides = [];
            const role = arm; arm = null; drawArm();
            if ((r.x1 - r.x0) * VV.s > 4 && (r.y1 - r.y0) * VV.s > 4) addIgnore(role ? { plan: which, kind: "box", rect: r, role } : { plan: which, kind: "box", rect: r });
            else viewer.redrawOverlay();
          },
        };
      },
    });
    requestAnimationFrame(() => fitWhole(viewer, which));
    offs.push(on((w) => { sync(); viewer.redrawOverlay(); if (w === "ignores") drawArm(); }));
  }

  /**
   * Snap the moving edges of a zone to drawn lines alongside them (Alt: off). `edges` null
   * means the whole zone moves: it shifts by the nearest snap of either edge, per direction.
   */
  function snapRect(r, edges, which, V, alt, band = false) {
    guides = [];
    if (alt) return r;
    const plan = S.plans[which], tol = 8 / V.s, out = { ...r };
    const span = (dir) => (band ? [-1e5, 1e5] : dir === "x" ? [r.y0, r.y1] : [r.x0, r.x1]);
    const keys = (dir) => (dir === "x" ? ["x0", "x1"] : ["y0", "y1"]);
    const guide = (dir, s, lo, hi) => guides.push({ dir, pos: s.pos, lo: Math.max(-10, Math.min(s.seg[1], lo)), hi: Math.min(L(which) + 10, Math.max(s.seg[2], hi)) });
    for (const dir of ["x", "y"]) {
      if (band && dir !== (S.axis === "y" ? "x" : "y")) continue; // a band only snaps across
      const [lo, hi] = span(dir);
      const ks = edges ? keys(dir).filter((k) => edges.includes(k)) : keys(dir);
      let best = null;
      for (const k of ks) {
        const s = E.snapEdge(plan, dir, r[k], lo, hi, tol);
        if (!s) continue;
        if (edges) { out[k] = s.pos; guide(dir, s, lo, hi); }
        else if (!best || Math.abs(s.pos - r[k]) < Math.abs(best.s.pos - r[best.k])) best = { k, s };
      }
      if (!edges && best) {
        const d = best.s.pos - r[best.k];
        for (const k of keys(dir)) out[k] += d;
        guide(dir, best.s, lo, hi);
      }
    }
    return out;
  }

  function resetOld() {
    S.body.old = E.guessBody(S.plans.old, S.axis);
    S.ignores = S.ignores.filter((ig) => ig.plan !== "old");
    emit("ignores"); emit("body"); recalc(true);
  }
  function copyFromOld() {
    S.body.new = [S.body.old[0], L("new") - (L("old") - S.body.old[1])];
    S.ignores = S.ignores.filter((ig) => ig.plan !== "new").concat(S.ignores.filter((ig) => ig.plan === "old").map((ig) => ({ ...ig, id: Math.random(), plan: "new", rect: { ...ig.rect }, from: ig.id })));
    emit("ignores"); emit("body"); recalc(true);
  }
  /** The Old Plan's zones placed on the New Plan: Header from the start, Footer from the end, the rest where they were. */
  function oldZonesOnNew() {
    const out = [], [hd, ft] = S.body.old, tail = L("old") - ft;
    if (hd > 0.5) out.push({ rect: rectTA(0, hd, 0, A("new")), label: "Kopf" });
    if (tail > 0.5) out.push({ rect: rectTA(L("new") - tail, L("new"), 0, A("new")), label: "Fuß" });
    for (const ig of S.ignores.filter((x) => x.plan === "old")) out.push({ rect: zoneRect(ig, "new"), label: zoneName(ig) });
    return out;
  }
  // ---------- axis zones (naming ticket, round 2) ----------
  let arm = null, armEl = null;
  /** Sidebar: three buttons; pick one, then drag it on the Plan. */
  function axisPicker() {
    armEl = h("div", { style: "display:flex;gap:6px;flex-wrap:wrap" });
    drawArm();
    return h("div", { style: "display:flex;flex-direction:column;gap:6px;padding:10px;border-radius:10px;background:rgba(220,42,30,.05);border:1px solid rgba(220,42,30,.25)" },
      h("b", {}, "Achsen ", h("span", { class: "hint", style: "font-weight:400" }, "(freiwillig)")),
      h("p", { class: "hint", style: "margin:0" }, "Wo stehen Datum, km und die Namen der Vorgänge? Einen Knopf wählen, dann im Plan aufziehen. Dann wird dort gelesen statt geraten. Am Vergleich ändern sie nichts."),
      armEl);
  }
  function drawArm() {
    if (!armEl) return;
    armEl.replaceChildren(...Object.entries(AXES).map(([k, [label, what]]) => {
      const have = S.ignores.filter((ig) => ig.role === k && ig.plan === "old").length;
      return h("button", {
        title: `${label}: ${what}. Klicken, dann im Plan aufziehen${arm === k ? " (Esc: abbrechen)" : ""}`,
        style: `padding:4px 10px;border-radius:99px;${arm === k ? `background:${AX_RED};color:#fff;border-color:${AX_RED}` : `color:${AX_RED};border-color:rgba(220,42,30,.45)`}`,
        onclick: () => { arm = arm === k ? null : k; drawArm(); },
      }, label, have ? " ✓" : "");
    }));
  }
  addEventListener("keydown", (e) => { if (e.key === "Escape" && arm) { arm = null; drawArm(); } });
  function cycleRole(ig) {
    const next = ROLES[(ROLES.indexOf(ig.role || null) + 1) % ROLES.length];
    if (next) ig.role = next; else delete ig.role;
    drawArm(); emit("ignores"); recalc(true);
  }
  function toggleBand(ig, V) {
    const [a0, a1] = acrossOf(ig.rect);
    if (ig.kind === "box") { ig.kind = "band"; ig.rect = bandRect(a0, a1); }
    else { // back to a box: the part that is on screen now
      const t0 = Math.max(0, S.axis === "y" ? V.y0 : V.x0), t1 = Math.min(L(ig.plan), (S.axis === "y" ? V.y0 + V.h / V.s : V.x0 + V.w / V.s));
      ig.kind = "box"; ig.rect = rectTA(t0 + 0.1 * (t1 - t0), t1 - 0.1 * (t1 - t0), a0, a1);
    }
    emit("ignores"); recalc(true);
  }
  function reshape(ig, code, p0) {
    const start = { ...ig.rect }, band = ig.kind === "band";
    const edges = code === "move" ? null : [code.includes("w") && "x0", code.includes("e") && "x1", code.includes("n") && "y0", code.includes("s") && "y1"].filter(Boolean);
    return {
      move(p, e, V) {
        const dx = p.x - p0.x, dy = p.y - p0.y, r = { ...start };
        if (code === "move") {
          if (!band || S.axis === "y") { r.x0 += dx; r.x1 += dx; }
          if (!band || S.axis === "x") { r.y0 += dy; r.y1 += dy; }
        } else {
          if (code.includes("w")) r.x0 += dx;
          if (code.includes("e")) r.x1 += dx;
          if (code.includes("n")) r.y0 += dy;
          if (code.includes("s")) r.y1 += dy;
        }
        ig.rect = snapRect(r, edges, ig.plan, V, e.altKey, band);
        emit("drag");
      },
      up() {
        guides = [];
        const r = ig.rect;
        ig.rect = { x0: Math.min(r.x0, r.x1), x1: Math.max(r.x0, r.x1), y0: Math.min(r.y0, r.y1), y1: Math.max(r.y0, r.y1) };
        emit("ignores"); recalc(true);
      },
    };
  }
  /** Which handle of a zone is under p ("n", "se", …, "move") or null. Bands only resize across. */
  function hitBox(ig, r, p, tol) {
    if (p.x < r.x0 - tol || p.x > r.x1 + tol || p.y < r.y0 - tol || p.y > r.y1 + tol) return null;
    let v = Math.abs(p.y - r.y0) <= tol ? "n" : Math.abs(p.y - r.y1) <= tol ? "s" : "";
    let hz = Math.abs(p.x - r.x0) <= tol ? "w" : Math.abs(p.x - r.x1) <= tol ? "e" : "";
    if (ig.kind === "band") { if (S.axis === "y") v = ""; else hz = ""; }
    return v + hz || "move";
  }

  // ---------- 4 Offset ----------
  function stepOffset() {
    const big = h("div", { style: "font-size:26px;font-weight:650" });
    const from = h("div", { class: "hint" });
    const cands = h("div", { style: "display:flex;flex-direction:column;gap:6px" });
    const inp = h("input", { type: "number", step: "0.1" });
    inp.onchange = () => setOffset(+inp.value, "hand");
    const nudges = h("div", { style: "display:flex;gap:4px;flex-wrap:wrap" }, ...[-10, -1, -0.1, 0.1, 1, 10].map((d) => h("button", { style: "padding:3px 8px", onclick: () => setOffset(S.offset + d, "hand") }, (d > 0 ? "+" : "−") + fmt(Math.abs(d), Math.abs(d) < 1 ? 1 : 0))));
    let viewer, snapped = false;
    const drawSide = () => {
      big.textContent = fmt(S.offset, 2) + " mm";
      from.textContent = { auto: "automatisch erkannt", picked: "aus den Vorschlägen gewählt", hand: "von Hand eingestellt" }[S.offsetFrom];
      if (document.activeElement !== inp) inp.value = S.offset.toFixed(2);
      const max = Math.max(1, ...S.cands.map((c) => c.votes));
      cands.replaceChildren(...S.cands.map((c, i) => h("button", {
        class: Math.abs(c.offset - S.offset) < 0.01 ? "on" : "",
        style: "display:grid;grid-template-columns:1fr auto;gap:4px 8px;align-items:center;text-align:left;padding:7px 10px",
        onclick: () => setOffset(c.offset, i === 0 ? "auto" : "picked"),
      }, h("b", {}, fmt(c.offset, 2) + " mm"), h("span", { class: "muted", style: "font-size:12px" }, `${c.votes.toLocaleString("de-DE")} Treffer`),
        h("div", { class: "bar", style: `grid-column:1/-1;width:${(100 * c.votes) / max}%` }))));
    };
    body.append(side(
      h("h3", { style: "margin:0" }, "4 · Liegen die Pläne aufeinander?"),
      h("div", {}, big, from),
      h("p", { class: "hint", style: "margin:0" }, "So weit ist der neue Plan entlang der Zeit verschoben. Gefunden über gleiche Objekte in beiden Plänen; je mehr Treffer, desto sicherer."),
      h("h4", { style: "margin:0" }, "Vorschläge"), cands,
      h("h4", { style: "margin:6px 0 0" }, "Von Hand"),
      h("p", { class: "hint", style: "margin:0" }, "Den Plan mit der Maus ziehen: er rastet an den Vorschlägen ein (", h("kbd", {}, "Alt"), ": frei). Oder:"),
      h("label", {}, inp, " mm"), nudges,
      h("p", { class: "hint", style: "margin:0" }, h("kbd", {}, S.axis === "y" ? "↑" : "←"), " ", h("kbd", {}, S.axis === "y" ? "↓" : "→"), " 0,1 mm · mit ", h("kbd", {}, "Shift"), " 1 mm · mit ", h("kbd", {}, "Strg"), " 10 mm"),
      navHint(),
      h("div", { style: "display:flex;gap:6px;flex-wrap:wrap" },
        h("button", { onclick: () => jump(viewer, win()[0], 0.15) }, "Anfang"),
        h("button", { onclick: () => jump(viewer, win()[1], 0.85) }, "Ende"),
        h("button", { onclick: () => viewer.fit(rectTA(Math.min(0, S.offset), Math.max(L("old"), L("new") + S.offset), 0, A("old")), 24) }, "Ganzer Plan")),
      h("div", { class: "hint", style: "display:flex;flex-direction:column;gap:2px;margin-top:4px" },
        h("span", {}, h("b", { style: "color:#111" }, "■"), " schwarz/grau: liegt in beiden Plänen gleich"),
        h("span", {}, h("b", { style: `color:${COLORS.old}` }, "■"), " blau: nur im alten Plan"),
        h("span", {}, h("b", { style: `color:${COLORS.new}` }, "■"), " rot: nur im neuen Plan"),
        h("span", {}, "Liegt der Versatz daneben, erscheint alles doppelt.")),
      nextBack(2, () => { S._aConfirmed = 4; done = true; show(3); }, "Vergleichen"),
    ));
    drawSide();
    const cache = layerCache();
    const win = () => [Math.max(S.body.old[0], S.body.new[0] + S.offset), Math.min(S.body.old[1], S.body.new[1] + S.offset)];
    viewer = createViewer(mainView(), {
      paint: (view, w, hh) => tint(cache("old", view, w, hh, 0), cache("new", view, w, hh, S.offset), w, hh),
      overlay: (ctx, V) => {
        const [w0, w1] = win();
        fillRect(ctx, rectTA(-1e5, w0, -1e4, 1e4), "rgba(255,255,255,.55)");
        fillRect(ctx, rectTA(w1, 1e5, -1e4, 1e4), "rgba(255,255,255,.55)");
        if (snapped) screen(ctx, () => pill(ctx, V.w / 2 - 80, 12, `eingerastet: ${fmt(S.offset, 2)} mm`, { bg: COLORS.snap }));
      },
      hover: () => (S.axis === "y" ? "ns-resize" : "ew-resize"),
      down: (pt) => {
        const t0 = tOf(pt), o0 = S.offset;
        return {
          move(p, e, V) {
            let v = o0 + tOf(p) - t0, from = "hand";
            snapped = false;
            if (!e.altKey) S.cands.forEach((c, i) => { if (!snapped && Math.abs(c.offset - v) * V.s < 10) { v = c.offset; from = i ? "picked" : "auto"; snapped = true; } });
            if (Math.abs(v - S.offset) > 1e-6) setOffset(v, from);
          },
          up() { snapped = false; viewer.redrawOverlay(); },
        };
      },
    });
    requestAnimationFrame(() => jump(viewer, win()[0], 0.15));
    const key = (e) => nudgeKeys(e);
    addEventListener("keydown", key);
    offs.push(() => removeEventListener("keydown", key));
    offs.push(on((w) => { if (w === "offset") { drawSide(); viewer.update(40); } if (w === "cands") drawSide(); }));
  }

  // ---------- after "Vergleichen" ----------
  function result() {
    // The comparison-view prototype (../comparison) plugs its variants in here.
    if (S.compareView) {
      const host = h("div", { style: "grid-column:1/-1;min-height:0;position:relative" });
      body.append(host);
      offs.push(S.compareView(host, { back: () => { done = false; show(3); } }));
      drawNav(); // the view may offer "Änderungen exportieren"
      return;
    }
    const box = h("div", { style: "grid-column:1/-1;display:grid;place-items:center" });
    const draw = () => {
      const r = S.result;
      box.replaceChildren(h("div", { style: "max-width:520px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:24px" },
        h("h2", { style: "margin:0 0 6px" }, r ? `${r.groups.length} Stellen mit Unterschieden` : "Vergleiche…"),
        h("p", { class: "muted" }, "Hier begänne die Vergleichsansicht (eigenes Ticket). Zurück zum Ausrichten über die Schritte oben."),
        h("p", { class: "hint" }, `Versatz ${offsetText()} · Kopf/Fuß alt ${fmt(S.body.old[0])} / ${fmt(S.body.old[1])} mm · neu ${fmt(S.body.new[0])} / ${fmt(S.body.new[1])} mm · ${S.ignores.length} ignorierte Bereiche`),
        h("button", { onclick: () => { done = false; show(3); } }, "← Ausrichten ändern")));
    };
    draw();
    body.append(box);
    offs.push(on((w) => w === "result" && draw()));
  }

  show(step);
  return () => { clear(); offBusy(); root.remove(); setLive(true); };
}

// ---------- geometry and drawing helpers ----------

const CURSOR = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize", move: "move" };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const acrossOf = (r) => (S.axis === "y" ? [r.x0, r.x1] : [r.y0, r.y1]);
const alongOf = (r) => (S.axis === "y" ? [r.y0, r.y1] : [r.x0, r.x1]);
const rectFrom = (a, b) => ({ x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) });
/** A zone's rect on `which`, a band cut to that Plan's length. */
function zoneRect(ig, which) {
  if (ig.kind !== "band") return ig.rect;
  return S.axis === "y" ? { ...ig.rect, y0: 0, y1: L(which) } : { ...ig.rect, x0: 0, x1: L(which) };
}
const inBox = (b, pt) => pt.px >= b.x && pt.px <= b.x + b.w && pt.py >= b.y && pt.py <= b.y + b.h;

/** Run `f` with the context in plain css px. */
function screen(ctx, f) { ctx.save(); const d = devicePixelRatio; ctx.setTransform(d, 0, 0, d, 0, 0); f(); ctx.restore(); }
function textW(ctx, t, size = 12) { ctx.font = `600 ${size}px system-ui, "Segoe UI", sans-serif`; return ctx.measureText(t).width; }
function pill(ctx, x, y, text, { bg = COLORS.line, fg = "#fff", size = 12 } = {}) {
  const w = textW(ctx, text, size) + 16, hh = size + 10;
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x, y, w, hh, hh / 2); ctx.fill();
  if (bg === "#fff") { ctx.strokeStyle = fg; ctx.lineWidth = 1.2; ctx.stroke(); }
  ctx.fillStyle = fg; ctx.textBaseline = "middle"; ctx.fillText(text, x + 8, y + hh / 2 + 0.5);
  return w;
}
/** Name tag and bubbles at the top-left of the part of a zone that is on screen. */
/** Tags placed on screen so far in this frame, so a tag at the same corner stacks below. */
let placed = [];
function zoneTag(ctx, V, r, parts, hits) {
  const x0 = Math.max(r.x0, V.x0), y0 = Math.max(r.y0, V.y0), x1 = Math.min(r.x1, V.x0 + V.w / V.s), y1 = Math.min(r.y1, V.y0 + V.h / V.s);
  if (x1 <= x0 || y1 <= y0) return;
  let x = (x0 - V.x0) * V.s + 6;
  let y = clamp((y0 - V.y0) * V.s + 6, 4, V.h - 26);
  const total = parts.reduce((a, p) => a + textW(ctx, p.text) + 20, 0);
  const hitsAny = () => placed.some((q) => x < q.x + q.w && x + total > q.x && y < q.y + 24 && y + 24 > q.y);
  for (let k = 0; k < 20 && hitsAny(); k++) y += 26;
  placed.push({ x, y, w: total });
  for (const p of parts) {
    const w = pill(ctx, x, y, p.text, { bg: p.bg, fg: p.fg || "#fff" });
    if (p.fn) hits.push({ x, y, w, h: 22, fn: p.fn, title: p.title });
    x += w + 4;
  }
}
/** Square handles at the corners and edge middles (bands: only the two long edges). */
function handles(ctx, V, r, band) {
  const vis = { x0: Math.max(r.x0, V.x0), y0: Math.max(r.y0, V.y0), x1: Math.min(r.x1, V.x0 + V.w / V.s), y1: Math.min(r.y1, V.y0 + V.h / V.s) };
  if (vis.x1 < vis.x0 || vis.y1 < vis.y0) return;
  const pts = band
    ? (S.axis === "y" ? [[r.x0, (vis.y0 + vis.y1) / 2], [r.x1, (vis.y0 + vis.y1) / 2]] : [[(vis.x0 + vis.x1) / 2, r.y0], [(vis.x0 + vis.x1) / 2, r.y1]])
    : [[r.x0, r.y0], [(r.x0 + r.x1) / 2, r.y0], [r.x1, r.y0], [r.x1, (r.y0 + r.y1) / 2], [r.x1, r.y1], [(r.x0 + r.x1) / 2, r.y1], [r.x0, r.y1], [r.x0, (r.y0 + r.y1) / 2]];
  screen(ctx, () => {
    ctx.fillStyle = "#fff"; ctx.strokeStyle = COLORS.line; ctx.lineWidth = 1.5;
    for (const [x, y] of pts) { const sx = (x - V.x0) * V.s, sy = (y - V.y0) * V.s; ctx.fillRect(sx - 5, sy - 5, 10, 10); ctx.strokeRect(sx - 5, sy - 5, 10, 10); }
  });
}
let stripeTile = null;
/** Diagonal hatching that stays the same size on screen at any zoom. */
function stripes(ctx, V) {
  if (!stripeTile) {
    stripeTile = new OffscreenCanvas(10, 10);
    const c = stripeTile.getContext("2d");
    c.strokeStyle = "rgba(80,80,90,.55)"; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(-2, 12); c.lineTo(12, -2); c.moveTo(-2, 2); c.lineTo(2, -2); c.moveTo(8, 12); c.lineTo(12, 8); c.stroke();
  }
  const p = ctx.createPattern(stripeTile, "repeat");
  p.setTransform(new DOMMatrix().scale(1 / V.s));
  return p;
}
void aOf;
