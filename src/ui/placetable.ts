// The table of Places (ADR 0003): its columns, their order, the sort and which Places are in
// it. Pure logic; the sidebar draws it, and the export (ADR 0007) reads the same rows through
// `listRows`, so what is listed and what is exported never differ.
//
// Ported from the comparison-view prototype (prototypes/comparison/variant-a.mjs: TCOLS,
// common.mjs: SORTS, sortBy), without the "Auch" column (variant A shows the other kinds as tags).

import { KINDS } from "../compare/kinds";
import type { Place } from "../compare/places";
import { kindText, umText, wannText, woText, wasText } from "../compare/wording";
import { placeShown, type PlaceFilter } from "./placefilter";

export type ColumnId = "no" | "name" | "kind" | "amount" | "when" | "where";

/** The columns in their original order. */
export const COLUMN_IDS: readonly ColumnId[] = ["no", "name", "kind", "amount", "when", "where"];

export const COLUMN_LABEL: Record<ColumnId, string> = { no: "Nr", name: "Was", kind: "Art", amount: "Um", when: "Wann", where: "Wo" };
export const COLUMN_TITLE: Record<ColumnId, string> = {
  no: "Nach Nummer (Lage entlang der Zeit)",
  name: "Nach Name, A–Z",
  kind: "Nach Art der Änderung",
  amount: "Nach Größe der Änderung, die größte zuerst",
  when: "Nach Beginn",
  where: "Nach km, der kleinste zuerst",
};

/** The direction a column sorts in the first time it is clicked. */
const FIRST_DIR: Record<ColumnId, 1 | -1> = { no: 1, name: 1, kind: 1, amount: -1, when: 1, where: 1 };

export interface SortKey {
  key: ColumnId;
  dir: 1 | -1;
}

/** Sort keys kept: the main one and the three before it. */
const MAX_KEYS = 4;

/**
 * A click on a column: it becomes the main key and the earlier keys stay as tie-breakers inside
 * it, as in Excel; clicking the main key again turns it round.
 */
export function sortBy(keys: readonly SortKey[], key: ColumnId): SortKey[] {
  const first = keys[0];
  if (first && first.key === key) return [{ key, dir: first.dir === 1 ? -1 : 1 }, ...keys.slice(1)];
  return [{ key, dir: FIRST_DIR[key] }, ...keys.filter((k) => k.key !== key)].slice(0, MAX_KEYS);
}

/** What a Place is sorted by in a column; null when it has none (those come last). */
function sortValue(p: Place, key: ColumnId): number | string | null {
  switch (key) {
    case "no":
      return p.no;
    case "name":
      return wasText(p).toLocaleLowerCase("de");
    case "kind":
      return KINDS.indexOf(p.kind);
    case "amount": {
      const a = p.amount;
      if (!a) return null;
      // Along the time in days, across in km (far below any days), else mm.
      return a.along ? Math.abs(a.days ?? a.mm) : Math.abs(a.km ?? a.mm) / 1e6;
    }
    case "when":
      return p.when ? p.when.from : null;
    case "where":
      return p.where ? p.where.from : null;
  }
}

const collator = new Intl.Collator("de", { numeric: true });
const compareValues = (a: number | string, b: number | string): number => (typeof a === "string" ? collator.compare(a, String(b)) : a - Number(b));

/** The Places in the order of the sort keys; empty cells last, ties by number. */
export function sortPlaces(places: readonly Place[], keys: readonly SortKey[]): Place[] {
  if (!keys.length) return [...places];
  // Each Place's values once, not at every comparison.
  const values = new Map(places.map((p) => [p, keys.map((k) => sortValue(p, k.key))] as const));
  return [...places].sort((p, q) => {
    for (const [i, { dir }] of keys.entries()) {
      const a = values.get(p)![i]!,
        b = values.get(q)![i]!;
      if (a === null || b === null) {
        if (a === null && b === null) continue;
        return a === null ? 1 : -1;
      }
      const c = compareValues(a, b);
      if (c) return c * dir;
    }
    return p.no - q.no;
  });
}

/** A saved column order, repaired: unknown and repeated columns dropped, missing ones back in their place. */
export function columnOrder(saved: unknown): ColumnId[] {
  const kept = Array.isArray(saved) ? saved.filter((c): c is ColumnId => COLUMN_IDS.includes(c as ColumnId)) : [];
  return [...new Set([...kept, ...COLUMN_IDS])];
}

/** Moves `from` to just before or after `to`. */
export function moveColumn(order: readonly ColumnId[], from: ColumnId, to: ColumnId, side: "before" | "after"): ColumnId[] {
  if (from === to) return [...order];
  const rest = order.filter((c) => c !== from);
  rest.splice(rest.indexOf(to) + (side === "after" ? 1 : 0), 0, from);
  return rest;
}

/** What a column says about a Place, as text (the list's own cells draw more, such as tags; the export uses this). */
export function cellText(p: Place, col: ColumnId): string {
  switch (col) {
    case "no":
      return String(p.no);
    case "name":
      return wasText(p);
    case "kind":
      return p.kinds.map(kindText).join(", ");
    case "amount":
      return umText(p.amount) ?? "";
    case "when":
      return wannText(p.when) ?? "";
    case "where":
      return woText(p.where) ?? "";
  }
}

/** What decides which Places are listed and in which order. */
export interface ListState {
  filter: PlaceFilter;
  sort: readonly SortKey[];
  isHidden(p: Place): boolean;
  columns?: readonly ColumnId[];
}

/** The Places that are listed: let through by the filter and not hidden, in the sort order. */
export function listPlaces(places: readonly Place[], state: Pick<ListState, "filter" | "sort" | "isHidden">): Place[] {
  return sortPlaces(
    places.filter((p) => placeShown(state.filter, p) && !state.isHidden(p)),
    state.sort,
  );
}

export interface ListRow {
  no: number;
  hidden: boolean;
  /** In the order of `columns`. */
  cells: string[];
}

/**
 * The list as a table: its columns and rows as shown (filter applied, in the sort order, hidden
 * Places left out, or with `withHidden` marked). The export reads this (ADR 0007).
 */
export function listRows(places: readonly Place[], state: ListState, opts: { withHidden?: boolean } = {}): { columns: ColumnId[]; rows: ListRow[] } {
  const columns = state.columns ? [...state.columns] : [...COLUMN_IDS];
  const shown = places.filter((p) => placeShown(state.filter, p) && (opts.withHidden || !state.isHidden(p)));
  const rows = sortPlaces(shown, state.sort).map((p) => ({ no: p.no, hidden: state.isHidden(p), cells: columns.map((c) => cellText(p, c)) }));
  return { columns, rows };
}
