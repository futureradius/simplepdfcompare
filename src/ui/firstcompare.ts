// The "Vergleich" tab: it listens for the ComparisonResult that "Vergleichen" hands over
// (src/ui/handoff.ts) and shows it in the comparison view (src/ui/compareview.ts) and in
// the list of Places (src/ui/placesui.ts). The facts of the comparison are folded away below
// the list.

import type { ComparisonResult } from "../compare/result";
import type { BusyWindow } from "./busy";
import type { CompareView } from "./compareview";
import type { ComparisonHandoff } from "./handoff";
import type { PlacesUi } from "./placesui";

export interface FirstComparisonDeps {
  busy: BusyWindow;
  handoff: ComparisonHandoff;
  /** The view that draws the comparison. */
  view: CompareView;
  /** The list of Places in the sidebar, the filter, the selection and the ◀ ▶ bar. */
  places: PlacesUi;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const mm = (v: number) => v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const seconds = (ms: number) => `${(ms / 1000).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
const count = (n: number) => n.toLocaleString("de-DE");

function showFacts(into: HTMLElement, rows: [string, string][], note: string): void {
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
  const summary = document.createElement("summary");
  summary.textContent = "Einzelheiten des Vergleichs";
  into.replaceChildren(summary, p, dl);
}

export function setUpFirstComparison(deps: FirstComparisonDeps) {
  const viewEl = $("compare-view"),
    plansView = $("plans");
  let shown = false;
  /** The result the view and the sidebar show now. */
  let drawn: ComparisonResult | undefined;
  let drawing = false;
  // The facts of the comparison, folded away below the list.
  const facts = document.createElement("details");
  facts.className = "facts";
  deps.places.append(facts);

  async function show(r: ComparisonResult): Promise<void> {
    if (drawing) return;
    drawing = true;
    viewEl.dataset.state = "running";
    await deps.busy.start("Vergleich wird angezeigt…");
    try {
      const started = performance.now();
      // The view makes both Plans ready (bands and overview) only now, as it is shown.
      const passing = deps.places.setResult(r);
      await deps.view.show(r, passing);
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
        facts,
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
        "Die Zahlen dieses Vergleichs mit Ihren Einstellungen.",
      );
      drawn = r;
    } catch (e) {
      viewEl.dataset.state = "error";
      showFacts(facts, [], `Der Vergleich konnte nicht gezeigt werden: ${String(e)}`);
    } finally {
      drawing = false;
      await deps.busy.end();
      // Done once the busy window is gone: the keys work from here.
      if (viewEl.dataset.state === "drawn") {
        viewEl.dataset.state = "done";
        deps.places.ready(); // only now: nothing heavy runs before the result is shown
      }
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
