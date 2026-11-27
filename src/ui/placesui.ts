// The "Vergleich" tab's Places: the sidebar (count, filter, list, selection, hiding, display
// settings), the ◀ ▶ bar under the Plan and the keys, wired to PlacesState and the comparison view.
// firstcompare.ts hands each new result to `setResult`.

import type { Place } from "../compare/places";
import type { ComparisonResult } from "../compare/result";
import { kindText, wannText, wasText, woText } from "../compare/wording";
import type { Shown, ViewSettings } from "./compareframe";
import type { CompareView, PickEvent } from "./compareview";
import { createDisplayPanel, type DisplayPanel } from "./displaypanel";
import { loadSettings, storeSettings } from "./displaysettings";
import { h } from "./dom";
import { FilterPanel } from "./filterpanel";
import { filterVorlagen } from "./filtervorlagemenu";
import { PlacesPanel } from "./placespanel";
import { PlacesState } from "./placesstate";
import { minimapBottom } from "./navlayout";
import { COLUMN_IDS, isDataColumn, type SortKey } from "./placetable";

const SORT_KEY = "simplepdfcompare.listSort";
const COLUMNS_KEY = "simplepdfcompare.listColumns";

const load = (key: string): unknown => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
};
const store = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // not remembered; the list still works
  }
};

export interface PlacesElements {
  /** The sidebar's body for "Vergleich". */
  body: HTMLElement;
  nav: HTMLElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  navText: HTMLButtonElement;
  /** The minimap and its round button: lifted above the bar when they would overlap it. */
  minimaps: HTMLElement[];
}

export interface PlacesDeps {
  view: CompareView;
  /** Which pair of Plans the results are for (hidden Places are kept per pair). */
  pair: () => unknown;
  /** The tab is shown, so the keys work. */
  active: () => boolean;
  el: PlacesElements;
}

export interface PlacesUi {
  state: PlacesState;
  /** A new result: the list and the bar show it. Returns what the Plan is to show (filter and hiding). */
  setResult(r: ComparisonResult): Shown;
  /** The comparison is on screen (the busy window is gone): the small pictures may be drawn now. */
  ready(): void;
  /** Sets the sidebar's own parts that come below the list (the details of the comparison). */
  append(el: HTMLElement): void;
}

/** A remembered sort, checked. */
const parseSort = (raw: unknown): SortKey[] =>
  Array.isArray(raw)
    ? raw.filter((k): k is SortKey => !!k && typeof k === "object" && COLUMN_IDS.includes((k as SortKey).key) && isDataColumn((k as SortKey).key) && ((k as SortKey).dir === 1 || (k as SortKey).dir === -1)).slice(0, 4)
    : [];

export function setUpPlaces(deps: PlacesDeps): PlacesUi {
  const { view, el } = deps;
  const state = new PlacesState();
  state.setSort(parseSort(load(SORT_KEY)));
  state.setColumns(load(COLUMNS_KEY));
  state.onPersist = () => {
    store(SORT_KEY, state.sort);
    store(COLUMNS_KEY, state.columns);
  };

  let settings = loadSettings();
  view.setSettings(settings);
  const filter = new FilterPanel(state);
  const panel = new PlacesPanel(state, filter, (canvas, no, w, hh) => view.drawThumbnail(canvas, no, w, hh));
  const settingsKey = () => JSON.stringify(settings);
  panel.settingsChanged(settingsKey());
  let display: DisplayPanel;
  const change = (patch: Partial<ViewSettings>) => {
    settings = { ...settings, ...patch };
    view.setSettings(patch);
    storeSettings(settings);
    display.set(settings);
    panel.settingsChanged(settingsKey());
  };
  display = createDisplayPanel(settings, change);
  el.body.replaceChildren(panel.el, display.el);
  const vorlagen = filterVorlagen(state);
  filter.el.before(vorlagen.el);

  // ---- The Plan ------------------------------------------------------------------

  state.reveal = (p: Place) => view.flyTo(view.placeBox(p.no) ?? p.box);
  view.onPick = (e: PickEvent) => {
    if (e.type === "box") {
      state.selectMany(e.nos, e.mode);
      return;
    }
    if (e.no === null) {
      if (e.mode === "replace") state.clearSelection(); // a click on empty Plan: nothing selected
    } else if (e.mode === "replace") {
      state.select(e.no, {}, { reveal: false }); // the Plan stays where it is
      panel.scrollToPlace(e.no); // the list scrolls just enough to show the row
    } else {
      const remove = e.mode === "remove" || state.selection.has(e.no);
      state.selectMany([e.no], remove ? "remove" : "add");
      if (!remove) panel.scrollToPlace(e.no);
    }
  };

  // ---- The minimap moves up when it would cover the bar ----------------------------

  function placeMinimaps(): void {
    const viewW = el.nav.parentElement?.clientWidth ?? 0;
    if (!viewW) return;
    const bar = { w: el.nav.offsetWidth, h: el.nav.offsetHeight, bottom: parseFloat(getComputedStyle(el.nav).bottom) || 0 };
    for (const m of el.minimaps) if (m.offsetWidth) m.style.bottom = `${minimapBottom({ viewW, mapW: m.offsetWidth, bar })}px`;
  }
  const lift = new ResizeObserver(placeMinimaps);
  for (const m of [el.nav, ...(el.nav.parentElement ? [el.nav.parentElement] : []), ...el.minimaps]) lift.observe(m);

  // ---- The ◀ ▶ bar ------------------------------------------------------------------

  function drawNav(): void {
    const all = state.places.length;
    const t = el.navText;
    const listed = state.listed;
    if (!listed.length) {
      t.replaceChildren(all ? (state.hiddenCount === all ? "Alle Stellen sind ausgeblendet" : "Keine Stelle passt zum Filter") : "Keine Unterschiede");
      return;
    }
    const sel = state.selection;
    if (sel.size > 1) {
      t.replaceChildren(h("b", {}, `${sel.size.toLocaleString("de-DE")} ausgewählt`), h("span", { class: "dim" }, "· H blendet sie aus · Esc hebt auf"));
      return;
    }
    const p = sel.size ? listed.find((q) => sel.has(q.no)) : undefined;
    if (!p) {
      t.replaceChildren(h("span", { class: "dim" }, `Keine Auswahl · ${listed.length.toLocaleString("de-DE")} Stellen`));
      return;
    }
    const where = [wannText(p.when), woText(p.where)].filter(Boolean).join(" · ");
    t.replaceChildren(
      h("b", { class: "num" }, String(p.no)),
      h("span", {}, "·"),
      h("b", { class: "nav-name" }, wasText(p)),
      h("span", { class: "dim" }, `· ${p.kinds.map(kindText).join(", ")}`),
      h("span", { class: "dim nav-where" }, where ? `· ${where}` : ""),
    );
  }

  function step(dir: 1 | -1): void {
    const p = state.step(dir);
    if (p) panel.scrollToPlace(p.no);
  }
  el.prev.addEventListener("click", () => step(-1));
  el.next.addEventListener("click", () => step(1));
  el.navText.addEventListener("click", () => {
    const only = state.selection.size === 1 ? state.selection.nos()[0]! : null;
    const b = only === null ? null : view.placeBox(only);
    if (b) view.flyTo(b);
  });

  // ---- Keys --------------------------------------------------------------------------

  document.addEventListener("keydown", (e) => {
    if (!deps.active() || !state.places.length) return;
    const t = e.target;
    if (t instanceof HTMLElement && t.closest("input, textarea, select, dialog[open]")) return;
    if (document.querySelector("dialog[open]")) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case "ArrowRight":
      case "j":
      case "J":
        step(1);
        break;
      case "ArrowLeft":
      case "k":
      case "K":
        step(-1);
        break;
      case "h":
      case "H":
        state.hideSelection();
        break;
      case "m":
      case "M":
        change({ marks: !settings.marks });
        break;
      case "Escape":
        state.clearSelection();
        break;
      default:
        return;
    }
    e.preventDefault();
  });

  // ---- The state tells everyone ----------------------------------------------------------

  state.onChange = (what) => {
    panel.update(what);
    if (what === "filter" || what === "result") filter.draw();
    if (what === "filter") vorlagen.render();
    drawNav();
    if (what === "result") return; // the view takes the result's `shown` with `show`
    if (what === "filter" || what === "hidden") view.setShown(state.shown());
    if (what === "selection" || what === "hidden" || what === "filter") view.setSelection(state.selection.nos());
  };

  drawNav();
  return {
    state,
    setResult(r) {
      panel.setThumbsReady(false);
      panel.setMarks(r.places, r.comparison.marks);
      state.setResult(r.places, deps.pair());
      view.setSelection([]);
      return state.shown();
    },
    ready() {
      panel.setThumbsReady(true);
    },
    append(node) {
      el.body.append(node);
    },
  };
}
