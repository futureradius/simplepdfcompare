// The "Vergleich" sidebar's list of Places (ADR 0003): the count, the table with a small picture
// per row (movable columns, sorting, the other kinds as tags), the selection and hiding rows.
// It draws what PlacesState holds and tells it what the user did.
//
// Many hundreds of Places must scroll smoothly: only the rows in the page and a few beside them
// are built (virtuallist.ts), and a row's picture is drawn only once the row is in view, one at
// a time, after the scrolling has stopped.
//
// Ported from the comparison-view prototype (variant-a.mjs: drawSide, drawList, sortHead,
// TCOLS, hidePlaces), with the rows built by hand in a fixed height instead of all at once.

import type { Mark } from "../compare/compare";
import { kindText, umText, wannText, woText } from "../compare/wording";
import type { Place } from "../compare/places";
import { EYE_OFF, h } from "./dom";
import type { FilterPanel } from "./filterpanel";
import { kindOn } from "./placefilter";
import type { PlacesState, Row, StateChange } from "./placesstate";
import { COLUMN_IDS, COLUMN_LABEL, COLUMN_TITLE, isDataColumn, type ColumnId } from "./placetable";
import { rowWindow, scrollToShow } from "./virtuallist";

/** A row is this tall, px; its picture is THUMB_W by THUMB_H. */
export const ROW_H = 60;
export const THUMB_W = 76;
export const THUMB_H = 52;
const OVERSCAN = 5;
/** Pictures drawn are kept for this many Places. */
const THUMB_CACHE = 300;
/** The list waits this long after the last scroll before drawing pictures, ms. */
const THUMB_DELAY_MS = 90;

/** The width each column asks for (px) and its share of what is left; the picture and the hide button have fixed widths. */
const COLUMN_WIDTH: Record<ColumnId, { min: number; fr: number }> = {
  thumb: { min: THUMB_W, fr: 0 },
  no: { min: 36, fr: 0 },
  name: { min: 110, fr: 1.4 },
  kind: { min: 116, fr: 1 },
  amount: { min: 72, fr: 0.9 },
  when: { min: 100, fr: 1 },
  where: { min: 84, fr: 0.8 },
};
const ACTION_W = 34;

const dash = () => h("span", { class: "muted" }, "–");

/** Which marks a Place has: red only, yellow only, or both. */
type Dot = "added" | "removed" | "both";
const dotOf = (p: Place, marks: readonly Mark[]): Dot => {
  const kinds = new Set(p.marks.map((i) => marks[i]?.kind));
  return kinds.has("Added") && kinds.has("Removed") ? "both" : kinds.has("Removed") ? "removed" : "added";
};
const dotEl = (d: Dot) =>
  h("span", { class: `dot ${d}`, title: d === "added" ? "nur im neuen Plan" : d === "removed" ? "nur im alten Plan" : "in beiden Plänen" });

export class PlacesPanel {
  readonly el: HTMLElement;
  private readonly count = h("div", { class: "pl-count", data: { part: "count" } });
  private readonly sums = h("div", { class: "note pl-sums" });
  private readonly hiddenRow = h("div", { class: "pl-note", data: { part: "hidden" } });
  private readonly selectionRow = h("div", { class: "pl-note pl-selection", data: { part: "selection" } });
  private readonly head = h("div", { class: "pl-head", role: "row" });
  private readonly spacer = h("div", { class: "pl-rows", role: "rowgroup" });
  private readonly scroller = h("div", { class: "pl-scroll", role: "table", aria: { label: "Stellen" } }, this.head, this.spacer);
  private dots = new Map<number, Dot>();
  private rowsNow: Row[] = [];
  private readonly boxes = new Map<number, HTMLElement>();
  private readonly thumbs = new Map<number, { key: string; canvas: HTMLCanvasElement }>();
  private settingsKey = "";
  private shownVersion = 0;
  private thumbsReady = false;
  private thumbTimer: ReturnType<typeof setTimeout> | undefined;
  private thumbRun = 0;
  private frame = 0;
  private dragColumn: ColumnId | undefined;

  constructor(
    private readonly state: PlacesState,
    private readonly filter: FilterPanel,
    private readonly drawThumb: (canvas: HTMLCanvasElement, no: number, w: number, h: number) => Promise<boolean>,
  ) {
    this.el = h("div", { class: "pl" }, h("div", {}, this.count, this.sums), this.filter.el, this.hiddenRow, this.selectionRow, this.scroller);
    this.scroller.addEventListener("scroll", () => {
      this.scheduleRender();
      this.scheduleThumbs();
    });
    new ResizeObserver(() => {
      this.scheduleRender();
      this.scheduleThumbs();
    }).observe(this.scroller);
  }

  /**
   * Pictures are drawn only once the comparison is shown (the busy window is gone), and only
   * while the list is on screen: nothing heavy runs before its result is shown.
   */
  setThumbsReady(ready: boolean): void {
    this.thumbsReady = ready;
    if (ready) this.scheduleThumbs();
  }

  /** A new result: its marks give the dots; the pictures start again. */
  setMarks(places: readonly Place[], marks: readonly Mark[]): void {
    this.dots = new Map(places.map((p) => [p.no, dotOf(p, marks)] as const));
    this.thumbs.clear();
  }

  /** Something in the state changed: draw what depends on it. */
  update(what: StateChange): void {
    // What a picture shows depends on which marks are shown.
    if (what === "result" || what === "filter" || what === "hidden") this.shownVersion++;
    if (what !== "selection") this.drawHead();
    this.drawSummary();
    this.drawNotes();
    this.renderRows();
    if (what !== "selection") this.scheduleThumbs();
  }

  /** The display settings changed: the pictures follow, once things have settled. */
  settingsChanged(key: string): void {
    this.settingsKey = key;
    this.scheduleThumbs();
  }

  /** What an up to date picture was drawn for. */
  private get thumbKey(): string {
    return `${this.settingsKey}#${this.shownVersion}`;
  }

  /** Scrolls the list as little as needed to show a Place's row (nothing when it is in view or not listed). */
  scrollToPlace(no: number): void {
    const index = this.rowsNow.findIndex((r) => r.place.no === no);
    if (index < 0) return;
    const to = scrollToShow({ scrollTop: this.scroller.scrollTop, viewH: this.bodyHeight(), rowH: ROW_H, index });
    if (to !== null) this.scroller.scrollTop = to;
  }

  // ---- Summary and notes ---------------------------------------------------------

  private drawSummary(): void {
    const all = this.state.places,
      listed = this.state.listed;
    this.count.textContent = !all.length ? "Keine Unterschiede" : listed.length === all.length ? `${all.length.toLocaleString("de-DE")} Stellen mit Unterschieden` : `${listed.length.toLocaleString("de-DE")} von ${all.length.toLocaleString("de-DE")} Stellen`;
    let added = 0,
      removed = 0,
      both = 0;
    for (const p of listed) {
      const d = this.dots.get(p.no);
      if (d === "both") both++;
      else if (d === "removed") removed++;
      else added++;
    }
    this.sums.replaceChildren(
      h("span", { class: "added-ink" }, `${added.toLocaleString("de-DE")} nur dazu`),
      " · ",
      h("span", { class: "removed-ink" }, `${removed.toLocaleString("de-DE")} nur weg`),
      " · ",
      h("span", { class: "strong" }, `${both.toLocaleString("de-DE")} beides`),
    );
  }

  private drawNotes(): void {
    const hidden = this.state.hiddenCount;
    this.hiddenRow.hidden = !hidden;
    if (hidden)
      this.hiddenRow.replaceChildren(
        EYE_OFF(),
        `${hidden.toLocaleString("de-DE")} ausgeblendet`,
        h("span", { class: "grow" }),
        h("button", { class: "btn small", type: "button", data: { action: "toggle-hidden" }, on: { click: () => (this.state.showHidden = !this.state.showHidden) } }, this.state.showHidden ? "verbergen" : "zeigen"),
      );
    const sel = this.state.selection;
    this.selectionRow.hidden = !sel.size;
    if (sel.size)
      this.selectionRow.replaceChildren(
        h("b", {}, `${sel.size.toLocaleString("de-DE")} ausgewählt`),
        h("span", { class: "grow" }),
        h("button", { class: "btn small", type: "button", title: "Die Auswahl in der Liste zeigen", data: { action: "show-selected" }, on: { click: () => this.showSelected() } }, "in Liste zeigen"),
        h("button", { class: "btn small", type: "button", title: "Ausgewählte Stellen ausblenden (H)", data: { action: "hide" }, on: { click: () => this.state.hideSelection() } }, EYE_OFF(), "ausblenden"),
        h("button", { class: "btn small", type: "button", title: "Auswahl aufheben (Esc)", data: { action: "clear" }, on: { click: () => this.state.clearSelection() } }, "aufheben"),
      );
  }

  private showSelected(): void {
    const first = this.rowsNow.find((r) => this.state.selection.has(r.place.no));
    if (first) this.scrollToPlace(first.place.no);
  }

  // ---- The table's head ------------------------------------------------------------

  private template(): string {
    const cols = this.state.columns.map((c) => (COLUMN_WIDTH[c].fr ? `minmax(${COLUMN_WIDTH[c].min}px, ${COLUMN_WIDTH[c].fr}fr)` : `${COLUMN_WIDTH[c].min}px`));
    return [...cols, `${ACTION_W}px`].join(" ");
  }

  private minWidth(): number {
    return ACTION_W + this.state.columns.reduce((s, c) => s + COLUMN_WIDTH[c].min, 0) + 8 * (this.state.columns.length + 1) + 12;
  }

  private drawHead(): void {
    const sort = this.state.sort;
    const column = (id: ColumnId) => {
      const i = sort.findIndex((k) => k.key === id);
      // The picture's column has a name to grab it by, but does not sort.
      const title = !isDataColumn(id)
        ? h("span", { class: "col-title col-thumb" }, COLUMN_LABEL[id])
        : h(
            "button",
            { class: `col-title${i === 0 ? " main" : ""}`, type: "button", title: COLUMN_TITLE[id], data: { column: id }, on: { click: () => this.state.sortBy(id) } },
            COLUMN_LABEL[id],
            i === 0 ? h("span", { class: "arrow" }, sort[0]!.dir > 0 ? " ▲" : " ▼") : null,
          );
      const cell = h("span", { class: "col-cell", draggable: true, title: "Ziehen, um die Spalte zu verschieben", data: { column: id } }, title, id === "when" || id === "where" ? this.filter.rangeButton(id) : null);
      cell.addEventListener("dragstart", (e) => {
        this.dragColumn = id;
        e.dataTransfer!.effectAllowed = "move";
        e.dataTransfer!.setData("text/plain", id);
        cell.classList.add("dragging");
      });
      cell.addEventListener("dragend", () => {
        cell.classList.remove("dragging");
        for (const c of this.head.querySelectorAll(".col-cell")) c.classList.remove("drop-before", "drop-after");
      });
      cell.addEventListener("dragover", (e) => {
        e.preventDefault();
        const r = cell.getBoundingClientRect(),
          side = e.clientX < r.left + r.width / 2 ? "before" : "after";
        for (const c of this.head.querySelectorAll(".col-cell")) c.classList.remove("drop-before", "drop-after");
        cell.classList.add(`drop-${side}`);
        cell.dataset.side = side;
      });
      cell.addEventListener("dragleave", () => cell.classList.remove("drop-before", "drop-after"));
      cell.addEventListener("drop", (e) => {
        e.preventDefault();
        const from = this.dragColumn ?? (e.dataTransfer?.getData("text/plain") as ColumnId);
        if (!from || from === id) return;
        this.state.moveColumn(from, id, cell.dataset.side === "after" ? "after" : "before");
      });
      return cell;
    };
    const original = this.state.columns.every((c, i) => c === COLUMN_IDS[i]);
    this.head.style.gridTemplateColumns = this.template();
    this.head.style.minWidth = `${this.minWidth()}px`;
    this.head.replaceChildren(
      ...this.state.columns.map(column),
      h(
        "span",
        { class: "col-reset" },
        original ? null : h("button", { class: "icon-btn", type: "button", title: "Spalten wieder in der ursprünglichen Reihenfolge", on: { click: () => this.state.setColumns(undefined) } }, "↺"),
        sort.length ? h("button", { class: "icon-btn", type: "button", title: "Sortierung aufheben: wieder nach Nummer", data: { action: "clear-sort" }, on: { click: () => this.state.clearSort() } }, "×") : null,
      ),
    );
  }

  // ---- The rows --------------------------------------------------------------------

  private bodyHeight(): number {
    return Math.max(ROW_H, this.scroller.clientHeight - this.head.offsetHeight);
  }

  private scheduleRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderRows();
    });
  }

  /** Builds the rows in the page. The scroll position is never touched here. */
  private renderRows(): void {
    this.rowsNow = this.state.rows();
    const w = rowWindow({ scrollTop: this.scroller.scrollTop, viewH: this.bodyHeight(), rowH: ROW_H, count: this.rowsNow.length, overscan: OVERSCAN });
    this.spacer.style.height = `${w.total}px`;
    this.spacer.style.minWidth = `${this.minWidth()}px`;
    this.boxes.clear();
    this.spacer.replaceChildren(...this.rowsNow.slice(w.first, w.end).map((row, i) => this.makeRow(row, w.first + i)));
  }

  private makeRow(row: Row, index: number): HTMLElement {
    const p = row.place,
      selected = this.state.selection.has(p.no);
    const box = h("div", { class: "thumb-box" });
    this.boxes.set(p.no, box);
    const cached = this.thumbs.get(p.no);
    if (cached && !row.hidden) box.append(cached.canvas);
    const many = selected && this.state.selection.size > 1;
    const action = row.hidden
      ? h("button", { class: "btn small", type: "button", title: "Wieder einblenden", data: { action: "unhide" }, on: { click: (e) => (e.stopPropagation(), this.state.unhide([p.no])) } }, "einblenden")
      : h(
          "button",
          {
            class: "icon-btn",
            type: "button",
            title: many ? `Alle ${this.state.selection.size} ausgewählten Stellen ausblenden (H)` : "Ausblenden: keine echte Änderung (H)",
            data: { action: "hide-row" },
            on: { click: (e) => (e.stopPropagation(), this.state.hide(selected ? this.state.selection.nos() : [p.no])) },
          },
          EYE_OFF(),
        );
    const el = h(
      "div",
      {
        class: `pl-row${selected ? " selected" : ""}${row.hidden ? " is-hidden" : ""}`,
        role: "row",
        title: row.hidden ? "" : "Klicken: auswählen und hinspringen · Strg + Klick: dazu oder weg · Umschalt + Klick: alles bis hierher",
        data: { no: String(p.no) },
        aria: { selected: String(selected) },
        style: `top:${index * ROW_H}px;height:${ROW_H}px;grid-template-columns:${this.template()};min-width:${this.minWidth()}px`,
        on: {
          // No text selection on Shift + click.
          mousedown: (e) => {
            if (e.shiftKey) e.preventDefault();
          },
          click: (e) => {
            if (row.hidden) return;
            this.state.select(p.no, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }, { reveal: true });
          },
        },
      },
      ...this.state.columns.map((c) => (c === "thumb" ? box : this.cell(p, c))),
      action,
    );
    return el;
  }

  private cell(p: Place, col: Exclude<ColumnId, "thumb">): HTMLElement {
    switch (col) {
      case "no":
        return h("span", { class: "c-no" }, String(p.no));
      case "name": {
        const text = this.nameText(p);
        return h("span", { class: "c-name", title: p.name ?? "Kein Name gefunden: die Form" }, dotEl(this.dots.get(p.no) ?? "added"), h("span", { class: p.name ? "strong" : "strong muted" }, text));
      }
      case "kind": {
        const f = this.state.filter;
        return h(
          "span",
          { class: "c-kind" },
          h("span", {}, kindText(p.kind)),
          // The other kinds as tags; one that is filtered out stays, struck through (ADR 0008).
          ...p.kinds.slice(1).map((k) => h("span", { class: `tag${kindOn(f, k) ? "" : " off"}`, title: kindOn(f, k) ? "auch" : "auch, aber im Filter aus" }, `+ ${kindText(k)}`)),
        );
      }
      case "amount": {
        const um = umText(p.amount);
        const before = p.kind === "textChanged" && p.oldName ? `vorher »${p.oldName.length > 28 ? `${p.oldName.slice(0, 27).trimEnd()}…` : p.oldName}«` : null;
        return h("span", { class: "c-amount" }, um ?? (before ? null : dash()), before ? h("span", { class: "note", style: "display:block" }, before) : null);
      }
      case "when":
        return h("span", { class: "c-when" }, wannText(p.when) ?? dash());
      case "where":
        return h("span", { class: "c-where" }, woText(p.where) ?? dash());
    }
  }

  private nameText = (p: Place): string => (p.name ? (p.name.length > 40 ? `${p.name.slice(0, 39).trimEnd()}…` : p.name) : [p.shape].filter(Boolean).join(" "));

  // ---- The pictures ------------------------------------------------------------------

  private scheduleThumbs(): void {
    clearTimeout(this.thumbTimer);
    this.thumbTimer = setTimeout(() => void this.drawThumbs(), THUMB_DELAY_MS);
  }

  /** The rows in view (and one beside), the ones without an up to date picture, one after the other. */
  private async drawThumbs(): Promise<void> {
    const run = ++this.thumbRun;
    if (!this.thumbsReady || !this.scroller.clientHeight) return;
    const top = this.scroller.scrollTop,
      bottom = top + this.bodyHeight();
    const first = Math.max(0, Math.floor(top / ROW_H) - 1),
      last = Math.min(this.rowsNow.length, Math.ceil(bottom / ROW_H) + 1);
    const want = this.rowsNow.slice(first, last).filter((r) => !r.hidden && this.thumbs.get(r.place.no)?.key !== this.thumbKey);
    for (const row of want) {
      if (run !== this.thumbRun || !this.scroller.clientHeight) return; // scrolled again, or left the tab: the next run starts over
      const no = row.place.no;
      const entry = this.thumbs.get(no) ?? { key: "", canvas: h("canvas", { class: "thumb-canvas" }) };
      let ok = false;
      try {
        ok = await this.drawThumb(entry.canvas, no, THUMB_W, THUMB_H);
      } catch (e) {
        console.warn("thumbnail failed", e);
      }
      if (run !== this.thumbRun && !ok) return;
      if (!ok) continue;
      entry.key = this.thumbKey;
      this.thumbs.delete(no);
      this.thumbs.set(no, entry);
      while (this.thumbs.size > THUMB_CACHE) this.thumbs.delete(this.thumbs.keys().next().value!);
      const box = this.boxes.get(no);
      if (box && !box.contains(entry.canvas)) box.replaceChildren(entry.canvas);
      await new Promise((r) => setTimeout(r, 12));
    }
  }
}
