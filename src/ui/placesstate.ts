// What the "Vergleich" sidebar and the Plan share about the Places (ADR 0003): the filter, the
// sort, the columns, the hidden Places, the selection and where ◀ ▶ go on from. No DOM: the
// list, the filter panel, the Plan and the ◀ ▶ bar read it and tell it what the user did.
//
// Two things other slices read: `table()` gives the rows as shown (the export, ADR 0007), and
// `filter` / `setFilter` is a plain serialisable `PlaceFilter` (the filter Vorlagen).

import type { Place } from "../compare/places";
import type { Shown } from "./compareframe";
import { HiddenPlaces } from "./hiddenplaces";
import { markShown, placeShown, defaultFilter, type PlaceFilter } from "./placefilter";
import { columnOrder, listRows, moveColumn as moveColumnIn, sortBy as sortByIn, sortPlaces, type ColumnId, type ListRow, type SortKey } from "./placetable";
import { Selection } from "./selection";
import { cursorAfterHide, step, type Cursor } from "./stepping";

export type StateChange = "result" | "filter" | "sort" | "columns" | "hidden" | "selection";

export interface Modifiers {
  ctrl?: boolean;
  shift?: boolean;
}

/** A row of the list: a Place, and whether it is hidden (shown greyed, when hidden ones are listed). */
export interface Row {
  place: Place;
  hidden: boolean;
}

export class PlacesState {
  readonly selection = new Selection();
  private readonly hidden = new HiddenPlaces();
  private all: readonly Place[] = [];
  private token: unknown;
  private filterNow: PlaceFilter = defaultFilter();
  private sortNow: SortKey[] = [];
  private columnsNow: ColumnId[] = columnOrder(undefined);
  private cursor: Cursor = null;
  private showHiddenNow = false;
  /** Mark index to its Place and its place in the Place's marks. */
  private markOf = new Map<number, { place: Place; part: number }>();
  private cache: { listed: Place[]; nos: Set<number> } | undefined;
  private rowsCache: Row[] | undefined;

  onChange: ((what: StateChange) => void) | undefined;
  /** Called when the list asks to move the Plan to a Place (a click in the list, ◀ ▶). */
  reveal: ((p: Place) => void) | undefined;
  /** Called when the sort or the column order changed, so that they can be remembered. */
  onPersist: (() => void) | undefined;

  constructor() {
    this.selection.onChange = () => this.emit("selection");
  }

  private emit(what: StateChange): void {
    this.onChange?.(what);
  }

  private invalidate(): void {
    this.cache = undefined;
    this.rowsCache = undefined;
  }

  // ---- The result --------------------------------------------------------------

  /**
   * A new comparison. `pair` says which pair of Plans it is for: the hidden Places are kept for
   * the same pair (they are found again by kind and position) and forgotten for another.
   */
  setResult(places: readonly Place[], pair: unknown): void {
    if (pair !== this.token) this.hidden.clear();
    this.token = pair;
    this.all = places;
    this.markOf = new Map(places.flatMap((p) => p.marks.map((m, part) => [m, { place: p, part }] as const)));
    this.invalidate();
    this.cursor = null;
    this.selection.clear();
    this.emit("result");
  }

  get places(): readonly Place[] {
    return this.all;
  }

  // ---- The list ----------------------------------------------------------------

  private compute() {
    if (!this.cache) {
      const listed = sortPlaces(
        this.all.filter((p) => placeShown(this.filterNow, p) && !this.hidden.has(p)),
        this.sortNow,
      );
      this.cache = { listed, nos: new Set(listed.map((p) => p.no)) };
    }
    return this.cache;
  }

  /** The Places that are listed: let through by the filter, not hidden, in the sort order. */
  get listed(): readonly Place[] {
    return this.compute().listed;
  }

  get listedNos(): number[] {
    return this.compute().listed.map((p) => p.no);
  }

  isListed(no: number): boolean {
    return this.compute().nos.has(no);
  }

  /** The rows of the list: the listed Places, and with `showHidden` the hidden ones that pass the filter too. */
  rows(): Row[] {
    if (!this.rowsCache) {
      this.rowsCache = this.showHidden
        ? sortPlaces(
            this.all.filter((p) => placeShown(this.filterNow, p)),
            this.sortNow,
          ).map((place) => ({ place, hidden: this.hidden.has(place) }))
        : this.listed.map((place) => ({ place, hidden: false }));
    }
    return this.rowsCache;
  }

  /** The list as a table, as shown: for the export (ADR 0007). */
  table(opts: { withHidden?: boolean } = {}): { columns: ColumnId[]; rows: ListRow[] } {
    return listRows(this.all, { filter: this.filterNow, sort: this.sortNow, isHidden: (p) => this.hidden.has(p), columns: this.columnsNow }, opts);
  }

  /** Which Places and marks the Plan and the minimap show. */
  shown(): Shown {
    const nos = this.compute().nos,
      filter = this.filterNow;
    return {
      place: (no) => nos.has(no),
      mark: (i) => {
        const m = this.markOf.get(i);
        return !m || markShown(filter, m.place, m.part);
      },
    };
  }

  // ---- Filter, sort, columns -------------------------------------------------------

  get filter(): PlaceFilter {
    return this.filterNow;
  }

  setFilter(f: PlaceFilter): void {
    this.filterNow = f;
    this.invalidate();
    this.selection.prune((no) => this.isListed(no));
    this.emit("filter");
  }

  get sort(): readonly SortKey[] {
    return this.sortNow;
  }

  sortBy(col: ColumnId): void {
    this.sortNow = sortByIn(this.sortNow, col);
    this.invalidate();
    this.emit("sort");
    this.onPersist?.();
  }

  clearSort(): void {
    this.sortNow = [];
    this.invalidate();
    this.emit("sort");
    this.onPersist?.();
  }

  setSort(keys: readonly SortKey[]): void {
    this.sortNow = [...keys];
    this.invalidate();
    this.emit("sort");
  }

  get columns(): readonly ColumnId[] {
    return this.columnsNow;
  }

  setColumns(order: unknown): void {
    this.columnsNow = columnOrder(order);
    this.emit("columns");
  }

  moveColumn(from: ColumnId, to: ColumnId, side: "before" | "after"): void {
    this.columnsNow = moveColumnIn(this.columnsNow, from, to, side);
    this.emit("columns");
    this.onPersist?.();
  }

  // ---- Selection ---------------------------------------------------------------

  private byNo(no: number): Place | undefined {
    return this.all.find((p) => p.no === no);
  }

  /**
   * A click on a Place of the list or the Plan. Ctrl toggles it, Shift selects a range in the
   * list's order (Ctrl + Shift adds it); a plain click selects it alone, and `reveal` moves the
   * Plan there (the list does, the Plan does not).
   */
  select(no: number, mods: Modifiers, opts: { reveal: boolean }): void {
    if (!this.isListed(no)) return;
    if (mods.shift) this.selection.range(this.listedNos, no, !!mods.ctrl);
    else if (mods.ctrl) this.selection.toggle(no);
    else this.selection.only(no);
    this.cursor = { no };
    const p = this.byNo(no);
    if (opts.reveal && p && !mods.ctrl && !mods.shift) this.reveal?.(p);
  }

  /** A selection box on the Plan: replaces, adds to or removes from the selection. */
  selectMany(nos: readonly number[], mode: "replace" | "add" | "remove"): void {
    const there = nos.filter((n) => this.isListed(n));
    if (mode === "replace") this.selection.replace(there);
    else if (mode === "add") this.selection.add(there);
    else this.selection.remove(there);
    const first = this.listedNos.find((n) => this.selection.has(n));
    if (first !== undefined) this.cursor = { no: first };
  }

  clearSelection(): void {
    this.selection.clear();
  }

  // ---- Hiding ------------------------------------------------------------------

  get hiddenCount(): number {
    return this.hidden.count(this.all);
  }

  get showHidden(): boolean {
    return this.showHiddenNow && this.hiddenCount > 0;
  }

  set showHidden(v: boolean) {
    this.showHiddenNow = v;
    this.rowsCache = undefined;
    this.emit("hidden");
  }

  /** Hides these Places (the selection, when none is given). The Plan stays; nothing stays selected. */
  hide(nos: readonly number[] = this.selection.nos()): void {
    const targets = new Set(nos.filter((n) => this.isListed(n)));
    if (!targets.size) return;
    this.cursor = cursorAfterHide(this.listedNos, targets);
    this.selection.remove(targets);
    this.hidden.hide(this.all.filter((p) => targets.has(p.no)));
    this.invalidate();
    this.emit("hidden");
  }

  hideSelection(): void {
    this.hide();
  }

  unhide(nos: readonly number[]): void {
    const set = new Set(nos);
    this.hidden.show(this.all.filter((p) => set.has(p.no)));
    if (this.hiddenCount === 0) this.showHiddenNow = false;
    this.invalidate();
    this.emit("hidden");
  }

  isHidden(p: Place): boolean {
    return this.hidden.has(p);
  }

  // ---- Stepping ------------------------------------------------------------------

  /** ◀ ▶: selects the next or previous Place of the list and moves the Plan to it. */
  step(dir: 1 | -1): Place | null {
    const no = step(this.listedNos, this.cursor, dir);
    if (no === null) return null;
    this.select(no, {}, { reveal: true });
    return this.byNo(no) ?? null;
  }
}
