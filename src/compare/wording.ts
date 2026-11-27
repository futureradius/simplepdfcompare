// German wording of a Place for the list (ADR 0006): Wann, Wo and the amount (Um).
// Ported from the comparison-view prototype (prototypes/comparison/naming.mjs: dateText,
// kmText, durText, daysText, kmLenText).

import type { KindOfChange } from "./kinds";
import type { Amount, Place, When, Where } from "./places";

const KIND_TEXT: Record<KindOfChange, string> = {
  later: "Später",
  earlier: "Früher",
  longer: "Verlängert",
  shorter: "Verkürzt",
  movedAcross: "Quer verschoben",
  textChanged: "Text geändert",
  new: "Neu",
  gone: "Entfallen",
  recoloured: "Umgefärbt",
  lineWidth: "Strichstärke",
  labelMoved: "Beschriftung verschoben",
  other: "Sonstiges",
};
/** A kind of change as the list says it (GLOSSARY: Kind of change). */
export const kindText = (k: KindOfChange) => KIND_TEXT[k];

/** A name is cut at this many characters, with "…" (ADR 0006). */
const NAME_MAX = 40;

/** What a Place is called (Was): its name, cut at 40 characters; else its shape and where it lies. */
export function wasText(p: Pick<Place, "name" | "shape" | "when" | "where">): string {
  if (p.name) return p.name.length > NAME_MAX ? `${p.name.slice(0, NAME_MAX - 1).trimEnd()}…` : p.name;
  return fullWasText(p);
}

/** Was in full, not cut (the export, ADR 0007). */
export function fullWasText(p: Pick<Place, "name" | "shape" | "when" | "where">): string {
  if (p.name) return p.name;
  return [p.shape, [woText(p.where), wannText(p.when)].filter(Boolean).join(", ")].filter(Boolean).join(" ");
}

const DAY_MS = 86400000;
/** A start or end this near a day boundary is on it (line widths, outlines), mm. */
const ON_DAY = 0.6;

const de = (v: number, d: number) => v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const dd = (n: number) => String(n).padStart(2, "0");
const dateParts = (day: number): [number, number, number] => {
  const x = new Date(Math.round(day) * DAY_MS);
  return [x.getUTCDate(), x.getUTCMonth() + 1, x.getUTCFullYear()];
};
/** "03.06.27". */
export const dateText = (day: number) => {
  const [d, m, y] = dateParts(day);
  return `${dd(d)}.${dd(m)}.${String(y).slice(2)}`;
};
const dayMonth = (day: number) => dateText(day).slice(0, 6);
const hm = (hours: number) => `${dd(hours % 24)}:00`;

/**
 * A time range as the list reads it: the first and the last day covered (a milestone: its one
 * day), or, when a start or end is not on a day boundary, both moments to the hour. In days
 * since 1970-01-01 (UTC); `time` says the hour counts. The export writes these (ADR 0007).
 */
export function whenSpan(when: When | null): { from: number; to: number; time: boolean } | null {
  if (!when) return null;
  const d0 = Math.min(when.from, when.to),
    d1 = Math.max(when.from, when.to);
  const onDay = (d: number) => Math.abs(d - Math.round(d)) * when.mmPerDay < ON_DAY;
  if (when.point) {
    const m = (d0 + d1) / 2,
      day = onDay(m) ? Math.round(m) : Math.floor(m);
    return { from: day, to: day, time: false };
  }
  if (!onDay(d0) || !onDay(d1)) {
    const h0 = onDay(d0) ? Math.round(d0) * 24 : Math.round(d0 * 24),
      h1 = onDay(d1) ? Math.round(d1) * 24 : Math.round(d1 * 24);
    return { from: h0 / 24, to: Math.max(h0, h1) / 24, time: true };
  }
  const a = Math.round(d0);
  return { from: a, to: Math.max(a, Math.round(d1) - 1), time: false };
}

/**
 * "03.06.–12.07.27" (the end is the last day covered); with the times when a start or end is
 * not on a day boundary ("03.06. 22:00 – 04.06.27 05:00"); "am 17.05.27" for one day or a
 * milestone.
 */
export function wannText(when: When | null): string | null {
  const span = whenSpan(when);
  if (!span) return null;
  if (span.time) {
    const h0 = Math.round(span.from * 24),
      h1 = Math.round(span.to * 24);
    if (h1 <= h0) return `am ${dateText(Math.floor(h0 / 24))}, ${hm(h0)}`;
    const day0 = Math.floor(h0 / 24),
      day1 = Math.floor((h1 - 1) / 24),
      end = h1 % 24 === 0 ? "24:00" : hm(h1);
    if (day0 === day1) return `${dateText(day0)}, ${hm(h0)}–${end}`;
    return `${dayMonth(day0)} ${hm(h0)} – ${dateText(day1)} ${end}`;
  }
  const { from: a, to: b } = span;
  if (a === b) return `am ${dateText(a)}`;
  return dateParts(a)[2] === dateParts(b)[2] ? `${dayMonth(a)}–${dateText(b)}` : `${dateText(a)}–${dateText(b)}`;
}

/** "km 12,4–15,6", or "km 26,0" when shorter than 50 m. */
export function woText(where: Where | null): string | null {
  if (!where) return null;
  const k0 = Math.min(where.from, where.to),
    k1 = Math.max(where.from, where.to);
  return k1 - k0 < 0.05 ? `km ${de((k0 + k1) / 2, 1)}` : `km ${de(k0, 1)}–${de(k1, 1)}`;
}

/** "8 Std.", "1 Tag 8 Std." (not "1,3 Tage"), "3 Tage", "40 Min.". */
export function durationText(days: number): string {
  const mins = Math.round(Math.abs(days) * 1440);
  if (mins < 60) return `${mins} Min.`;
  const hrs = Math.round(mins / 60),
    d = Math.floor(hrs / 24),
    r = hrs % 24;
  if (!d) return `${r} Std.`;
  const ds = `${d} ${d === 1 ? "Tag" : "Tage"}`;
  return r ? `${ds} ${r} Std.` : ds;
}

/** The amount: in days and hours along time, in km or m across, else in mm. */
export function umText(amount: Amount | null): string | null {
  if (!amount) return null;
  if (amount.along && amount.days !== null) return durationText(amount.days);
  if (!amount.along && amount.km !== null) {
    const v = Math.abs(amount.km);
    return v >= 1 ? `${de(v, 1)} km` : `${de(v * 1000, 0)} m`;
  }
  const v = Math.abs(amount.mm);
  return `${de(v, v < 10 ? 1 : 0)} mm`;
}
