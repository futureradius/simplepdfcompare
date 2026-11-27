// The filter of the list of Places (ADR 0003, ADR 0008): the kinds of change that are checked,
// and the Wann and Wo ranges. Plain data (`PlaceFilter`) so that a filter Vorlage can save and
// load it, plus the pure rules that decide which Places and marks show.
//
// Ported from the comparison-view prototype (prototypes/comparison/common.mjs: kindPass,
// inRange, fullFilter, parseKm, parseDay), variant A of the "several kinds" ticket.

import { KINDS, type KindOfChange } from "../compare/kinds";
import type { Place } from "../compare/places";

/** A range, both ends included: km for Wo, days since 1970-01-01 (UTC, fractions for hours) for Wann. */
export type Range = [number, number];

/** What the filter holds, as plain data. A kind not listed in `off` is checked. */
export interface PlaceFilter {
  /** The kinds that are unchecked. */
  off: KindOfChange[];
  when: Range | null;
  where: Range | null;
}

export const defaultFilter = (): PlaceFilter => ({ off: [], when: null, where: null });

export const kindOn = (f: PlaceFilter, k: KindOfChange): boolean => !f.off.includes(k);

export function setKind(f: PlaceFilter, k: KindOfChange, on: boolean): PlaceFilter {
  const off = f.off.filter((x) => x !== k);
  if (!on) off.push(k);
  return { ...f, off: KINDS.filter((x) => off.includes(x)) };
}

export const setAllKinds = (f: PlaceFilter, on: boolean): PlaceFilter => ({ ...f, off: on ? [] : [...KINDS] });

export const setRange = (f: PlaceFilter, which: "when" | "where", r: Range | null): PlaceFilter => ({ ...f, [which]: r });

export const filterIsDefault = (f: PlaceFilter): boolean => sameFilter(f, defaultFilter());

const sameRange = (a: Range | null, b: Range | null) => (a === null || b === null ? a === b : a[0] === b[0] && a[1] === b[1]);
export const sameFilter = (a: PlaceFilter, b: PlaceFilter): boolean =>
  a.off.length === b.off.length && KINDS.every((k) => kindOn(a, k) === kindOn(b, k)) && sameRange(a.when, b.when) && sameRange(a.where, b.where);

const asRange = (v: unknown): Range | null =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number" && Number.isFinite(v[0]) && Number.isFinite(v[1]) ? [v[0], v[1]] : null;

/** A filter read from saved data (a Vorlage, a file): what is usable of it, the rest default. */
export function parseFilter(raw: unknown): PlaceFilter {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const off = Array.isArray(o.off) ? KINDS.filter((k) => (o.off as unknown[]).includes(k)) : [];
  return { off, when: asRange(o.when), where: asRange(o.where) };
}

const overlaps = (from: number, to: number, r: Range) => to >= r[0] && from <= r[1];

/** A Place shows when any of its kinds is checked and it lies in the ranges (none without a value, as in Excel). */
export function placeShown(f: PlaceFilter, p: Place): boolean {
  if (!p.kinds.some((k) => kindOn(f, k))) return false;
  if (f.when && !(p.when && overlaps(p.when.from, p.when.to, f.when))) return false;
  if (f.where && !(p.where && overlaps(p.where.from, p.where.to, f.where))) return false;
  return true;
}

/** Each mark follows its own kind: `part` is its index in `place.marks`. */
export const markShown = (f: PlaceFilter, p: Place, part: number): boolean => kindOn(f, p.partKinds[part] ?? p.kind);

/** Per kind, the Places that have it anywhere. They can add up to more than the Places. */
export function kindCounts(places: readonly Place[]): Record<KindOfChange, number> {
  const c = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<KindOfChange, number>;
  for (const p of places) for (const k of new Set(p.kinds)) c[k]++;
  return c;
}

/** "12,4" · "12.4" · "km 12,4 + 70" (km plus metres) as km. */
export function parseKm(text: string): number | null {
  const m = /^\s*(?:km\s*)?(\d+)(?:[.,](\d+))?(?:\s*\+\s*(\d{1,3}))?\s*$/i.exec(text);
  if (!m) return null;
  return Number(m[1]) + (m[2] ? Number("0." + m[2]) : 0) + (m[3] ? Number(m[3]) / 1000 : 0);
}

/**
 * "25.09.26" · "25.09.2026" · "25.09." (the Plan's year, `year`), optionally with "14:00", as
 * days since 1970. A closing day without a time means its end (`end`).
 */
export function parseDay(text: string, end: boolean, year: number): number | null {
  const m = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})?\s*(?:,?\s*(\d{1,2}):(\d{2}))?\s*$/.exec(text);
  if (!m) return null;
  let y = m[3] ? Number(m[3]) : year;
  if (y < 100) y += 2000;
  const day = Date.UTC(y, Number(m[2]) - 1, Number(m[1])) / 86400000;
  return m[4] !== undefined ? day + (Number(m[4]) * 60 + Number(m[5])) / 1440 : day + (end ? 1 : 0);
}
