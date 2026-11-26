// The "Vergleich" tab: it listens for the ComparisonResult that "Vergleichen" hands over
// (src/ui/handoff.ts) and shows it in the comparison view (src/ui/compareview.ts). The
// sidebar keeps the temporary facts and the readout of the Places until the list of Places
// replaces them.

import type { Place } from "../compare/places";
import { kindText, umText, wannText, wasText, woText } from "../compare/wording";
import type { ComparisonResult } from "../compare/result";
import type { BusyWindow } from "./busy";
import { LEGEND_COLOURS, type CompareView } from "./compareview";
import type { ComparisonHandoff } from "./handoff";

export interface FirstComparisonDeps {
  busy: BusyWindow;
  handoff: ComparisonHandoff;
  /** The view that draws the comparison. */
  view: CompareView;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const mm = (v: number) => v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const seconds = (ms: number) => `${(ms / 1000).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
const count = (n: number) => n.toLocaleString("de-DE");

function showFacts(rows: [string, string][], note: string): void {
  const body = $("body-compare");
  body.replaceChildren();
  const h = document.createElement("h2");
  h.textContent = "Vergleich (erster Durchgang)";
  const p = document.createElement("p");
  p.className = "placeholder";
  p.textContent = note;
  const dl = document.createElement("dl");
  dl.className = "marks-facts";
  for (const [k, v] of rows) {
    const dt = document.createElement("dt"),
      dd = document.createElement("dd");
    dt.textContent = k;
    dd.textContent = v;
    dl.append(dt, dd);
  }
  const legend = document.createElement("ul");
  legend.className = "marks-legend";
  for (const [colour, text] of [
    [LEGEND_COLOURS.added, "Hinzugefügt: nur im neuen Plan"],
    [LEGEND_COLOURS.removed, "Entfernt: nur im alten Plan"],
    [LEGEND_COLOURS.unchanged, "Unverändert: Teil, den beide Pläne zeichnen"],
  ] as const) {
    const li = document.createElement("li"),
      sw = document.createElement("span");
    sw.className = "sw";
    sw.style.background = colour;
    li.append(sw, text);
    legend.append(li);
  }
  const keys = document.createElement("p");
  keys.className = "placeholder";
  keys.textContent = "Leertaste: neuer Plan ohne Markierungen, Strg + Leertaste: alter Plan. 1 ganzer Plan, 2 Planbreite, 3 1:1.";
  body.append(h, p, dl, legend, keys);
}

/**
 * A temporary readout of the Places (until the list of Places replaces it): one row each,
 * with its number, name (Was), main kind and other kinds (Art), amount (Um), Wann and Wo.
 */
function showPlaces(places: readonly Place[]): void {
  const h = document.createElement("h3");
  h.textContent = `Stellen (${count(places.length)})`;
  const ol = document.createElement("ol");
  ol.className = "places-readout";
  for (const p of places) {
    const li = document.createElement("li"),
      was = document.createElement("b");
    was.textContent = wasText(p);
    if (p.name && p.name !== was.textContent) was.title = p.name;
    const um = umText(p.amount);
    const art = [kindText(p.kind), ...p.kinds.slice(1).map((k) => `+ ${kindText(k)}`), um ? `um ${um}` : ""].filter(Boolean).join(" ");
    const where = [wannText(p.when), woText(p.where)].filter(Boolean).join(" · ");
    li.append(was, document.createElement("br"), `${art}${where ? ` · ${where}` : ""}`);
    ol.append(li);
  }
  $("body-compare").append(h, ol);
}

export function setUpFirstComparison(deps: FirstComparisonDeps) {
  const viewEl = $("compare-view"),
    plansView = $("plans");
  let shown = false;
  /** The result the view and the sidebar show now. */
  let drawn: ComparisonResult | undefined;
  let drawing = false;

  async function show(r: ComparisonResult): Promise<void> {
    if (drawing) return;
    drawing = true;
    viewEl.dataset.state = "running";
    await deps.busy.start("Vergleich wird angezeigt…");
    try {
      const started = performance.now();
      // The view makes both Plans ready (bands and overview) only now, as it is shown.
      await deps.view.show(r);
      if (shown) deps.view.enter();
      const { counts } = r.comparison;
      Object.assign(viewEl.dataset, {
        state: "drawn",
        added: String(counts.added),
        removed: String(counts.removed),
        offset: r.setup.offset.toFixed(3),
        timeDirection: r.timeDirection,
        places: String(r.places.length),
      });
      showFacts(
        [
          ["Zeitrichtung", r.timeDirection === "down" ? "senkrecht" : "waagerecht"],
          ["Versatz", `${mm(r.setup.offset)} mm`],
          ["Kopf und Fuß alt", `${mm(r.setup.old.body[0])} / ${mm(r.setup.old.body[1])} mm`],
          ["Kopf und Fuß neu", `${mm(r.setup.new.body[0])} / ${mm(r.setup.new.body[1])} mm`],
          ["Ausgenommen", `${count(r.setup.old.ignored.length)} alt / ${count(r.setup.new.ignored.length)} neu`],
          ["Kandidaten", r.offsetCandidates.map((c) => `${mm(c.offset)} mm (${count(c.votes)})`).join(", ") || "–"],
          ["Hinzugefügt", count(counts.added)],
          ["Entfernt", count(counts.removed)],
          ["Gleiche Objekte", `${count(counts.unchanged)} von ${count(counts.old)} / ${count(counts.new)}`],
          ["Abgleich", seconds(r.ms.compare)],
          ["Stellen bilden", seconds(r.ms.places)],
          ["Übertragen", seconds(r.ms.transfer)],
          ["Ansicht vorbereiten", seconds(performance.now() - started)],
        ],
        "Vorläufige Seitenleiste: Sie zeigt das Ergebnis des Vergleichs mit Ihren Einstellungen.",
      );
      showPlaces(r.places);
      drawn = r;
    } catch (e) {
      viewEl.dataset.state = "error";
      showFacts([], `Der Vergleich konnte nicht gezeigt werden: ${String(e)}`);
    } finally {
      drawing = false;
      await deps.busy.end();
      // Done once the busy window is gone: the keys work from here.
      if (viewEl.dataset.state === "drawn") viewEl.dataset.state = "done";
    }
  }

  return {
    /** The "Vergleich" tab is shown: draws the latest result (once). */
    enter(): void {
      shown = true;
      viewEl.hidden = false;
      plansView.hidden = true;
      deps.view.enter();
      const r = deps.handoff.latest();
      if (r && r !== drawn) void show(r);
    },
    /** Another tab is shown. */
    leave(): void {
      shown = false;
      viewEl.hidden = true;
      plansView.hidden = false;
      deps.view.leave();
    },
    /** Hears a new result while the tab is already shown (it is drawn at once). */
    listen(): () => void {
      return deps.handoff.subscribe((r) => {
        if (shown && r !== drawn) void show(r);
      });
    },
  };
}
