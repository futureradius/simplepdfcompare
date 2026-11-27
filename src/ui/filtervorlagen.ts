// Vorlagen of the filter in "Vergleich" (ADR 0009, ADR 0003): the checked kinds of change, saved
// under a name. Never the Wann or Wo ranges, which belong to one pair of Plans. "Alle" is built in,
// like the clipper's "Standard". Pure logic, no DOM; storage may be unavailable, so every access
// is guarded.

import { KINDS, type KindOfChange } from "../compare/kinds";
import type { KeyValueStore } from "../zones/remember";
import { kindOn, type PlaceFilter } from "./placefilter";
import { cleanName, type Named, type NameRules } from "./presets";

export interface NamedFilter extends Named {
  /** The checked kinds, in the order of the filter list. */
  kinds: KindOfChange[];
}

/** The built-in entry: every kind checked. */
export const ALL_KINDS = "Alle";
export const FILTER_NAMES: NameRules = { noun: "Filter-Vorlage", reserved: ALL_KINDS };
export const FILTER_FILE_NAME = "simplepdfcompare-Filter-Vorlagen.json";
const FILE_KIND = "simplepdfcompare-filter-vorlagen";

/** The kinds that are checked, in the order of the filter list. */
export const checkedKinds = (f: PlaceFilter): KindOfChange[] => KINDS.filter((k) => kindOn(f, k));

/** The filter with exactly these kinds checked (undefined: the built-in "Alle", every kind); Wann and Wo stay. */
export const withKinds = (f: PlaceFilter, kinds: readonly KindOfChange[] | undefined): PlaceFilter => ({
  ...f,
  off: kinds ? KINDS.filter((k) => !kinds.includes(k)) : [],
});

/** Whether two Vorlagen check the same kinds, in any order (undefined: "Alle"). */
export function sameKinds(a: readonly KindOfChange[], b: readonly KindOfChange[] | undefined): boolean {
  const other = b ?? KINDS;
  return KINDS.every((k) => a.includes(k) === other.includes(k));
}

/** What a Vorlage would hold now, or why there is nothing to save (German). */
export function savable(f: PlaceFilter): { value: KindOfChange[] } | { problem: string } {
  const kinds = checkedKinds(f);
  return kinds.length ? { value: kinds } : { problem: "Bitte mindestens eine Art der Änderung anhaken." };
}

// ---- Validation and the file format ------------------------------------------------

/** A stored or imported list: entries without a name or without a known kind are dropped; unknown kinds too. */
export function readFilterList(raw: unknown): NamedFilter[] {
  if (!Array.isArray(raw)) return [];
  const out: NamedFilter[] = [];
  for (const item of raw) {
    const p = item as { name?: unknown; kinds?: unknown } | null;
    if (!p || typeof p !== "object" || typeof p.name !== "string" || !cleanName(p.name) || !Array.isArray(p.kinds)) continue;
    const given = p.kinds as unknown[];
    const kinds = KINDS.filter((k) => given.includes(k));
    if (kinds.length) out.push({ name: cleanName(p.name), kinds });
  }
  return out;
}

export function filterToJson(presets: readonly NamedFilter[]): string {
  return JSON.stringify({ kind: FILE_KIND, version: 1, presets: presets.map(({ name, kinds }) => ({ name, kinds })) }, null, 2) + "\n";
}

/** Reads a filter Vorlagen file. Throws an Error with a German message if it isn't one. */
export function filterFromJson(text: string): NamedFilter[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Die Datei ist keine Filter-Vorlagen-Datei (kein gültiges JSON).");
  }
  const d = data as { kind?: unknown; presets?: unknown } | null;
  if (!d || typeof d !== "object" || d.kind !== FILE_KIND || !Array.isArray(d.presets)) throw new Error("Die Datei ist keine Filter-Vorlagen-Datei.");
  return readFilterList(d.presets);
}

// ---- Storage -----------------------------------------------------------------------

const LIST_KEY = "simplepdfcompare.filterVorlagen";

/**
 * The list only. The picked one is not remembered: the filter itself starts as "Alle" on every
 * start, and a remembered pick would show as "(geändert)" without any change by hand.
 */
export function loadFilters(store: KeyValueStore = localStorage): NamedFilter[] {
  try {
    const raw = store.getItem(LIST_KEY);
    return raw ? readFilterList(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function storeFilters(presets: readonly NamedFilter[], store: KeyValueStore = localStorage): void {
  try {
    store.setItem(LIST_KEY, JSON.stringify(presets));
  } catch {
    // not remembered; the Vorlagen still work
  }
}
