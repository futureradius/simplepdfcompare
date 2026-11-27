// What the exported list holds (ADR 0007): one row per Place, for every Place whatever the
// list's filter, in the order of Nr, hidden ones marked. Pure logic; xlsx.ts writes it.
//
// Not the list as shown (src/ui/placetable.ts `listRows`): the export has its own columns,
// and its numbers and dates are numbers and dates, not the list's German text.

import type { ComparisonSetup } from "../compare/compare";
import type { KindOfChange } from "../compare/kinds";
import type { TimeDirection } from "../compare/objects";
import type { Place } from "../compare/places";
import { fullWasText, kindText, whenSpan } from "../compare/wording";
import { DIRECTION_LABEL } from "../ui/direction";
import type { Cell, NumFormat, Sheet } from "./xlsx";

/** A moment on the time axis: days since 1970-01-01 (UTC), with fractions; `time` when it is not on a day boundary. */
export interface Moment {
  day: number;
  time: boolean;
}

export interface ChangeRow {
  no: number;
  /** The full name, not cut. */
  was: string;
  /** A changed Label's old text; empty otherwise. */
  vorher: string;
  /** Every kind, the main one first. */
  art: string;
  /** Days with a sign (+ Später and Verlängert, − Früher and Verkürzt); null for the other kinds and without a time axis. */
  um: number | null;
  /** The first and the last day covered (or moment, to the hour); null without a time axis. */
  von: Moment | null;
  bis: Moment | null;
  /** km, the smaller first; null without a location axis. */
  kmVon: number | null;
  kmBis: number | null;
  /** The top-left corner of its box, mm from the top-left corner of the New Plan's page, one decimal. */
  x: number;
  y: number;
  /** A Hidden Place. */
  hidden: boolean;
}

export interface ChangeRowsInput {
  isHidden(p: Place): boolean;
  /** The setup the comparison used: its Offset and Time axis move a Place into the New Plan's frame. */
  setup: Pick<ComparisonSetup, "axis" | "offset">;
}

/** The sign of Um for the kinds that change the timing, so that a slip adds up over the rounds. */
const UM_SIGN: Partial<Record<KindOfChange, 1 | -1>> = { later: 1, longer: 1, earlier: -1, shorter: -1 };

function umDays(p: Place): number | null {
  const sign = UM_SIGN[p.kind];
  const days = p.amount?.along ? p.amount.days : null;
  // to the minute, as the list reads it (durationText)
  return sign && days !== null && days !== undefined ? (sign * Math.round(Math.abs(days) * 1440)) / 1440 : null;
}

const oneDecimal = (v: number) => Math.round(v * 10) / 10;

export function changeRows(places: readonly Place[], input: ChangeRowsInput): ChangeRow[] {
  const { axis, offset } = input.setup;
  // A Place's box is in the Old frame: oldPos = newPos + offset along the Time direction.
  const dx = axis === "x" ? offset : 0,
    dy = axis === "y" ? offset : 0;
  return [...places]
    .sort((a, b) => a.no - b.no)
    .map((p) => {
      const span = whenSpan(p.when);
      return {
        no: p.no,
        was: fullWasText(p),
        vorher: p.kinds.includes("textChanged") && p.oldName && p.oldName !== p.name ? p.oldName : "",
        art: p.kinds.map(kindText).join(", "),
        um: umDays(p),
        von: span && { day: span.from, time: span.time },
        bis: span && { day: span.to, time: span.time },
        kmVon: p.where && Math.min(p.where.from, p.where.to),
        kmBis: p.where && Math.max(p.where.from, p.where.to),
        x: oneDecimal(p.box.x0 - dx),
        y: oneDecimal(p.box.y0 - dy),
        hidden: input.isHidden(p),
      };
    });
}

// ---- The workbook ---------------------------------------------------------------------

/** The columns of "Änderungen" (ADR 0007), with their widths in characters. */
const COLUMNS: [string, number][] = [
  ["Nr", 6],
  ["Was", 40],
  ["vorher", 28],
  ["Art", 30],
  ["Um (Tage)", 11],
  ["Von", 17],
  ["Bis", 17],
  ["km von", 10],
  ["km bis", 10],
  ["x (mm)", 9],
  ["y (mm)", 9],
  ["Ausgeblendet", 14],
];

const num = (v: number | null, fmt?: NumFormat): Cell => (v === null ? null : fmt ? { num: v, fmt } : { num: v });
const moment = (m: Moment | null): Cell => m && { date: m.day, time: m.time };
/** km to the metre: what the axis reading is good for. */
const metres = (km: number | null) => (km === null ? null : Math.round(km * 1000) / 1000);

function rowCells(r: ChangeRow): Cell[] {
  return [
    num(r.no),
    r.was,
    r.vorher,
    r.art,
    num(r.um, "+0.00"),
    moment(r.von),
    moment(r.bis),
    num(metres(r.kmVon), "0.0"),
    num(metres(r.kmBis), "0.0"),
    num(r.x, "0.0"),
    num(r.y, "0.0"),
    r.hidden ? "ja" : null,
  ];
}

/** The two sheets: "Änderungen", one row per Place, and "Info". */
export function changesWorkbook(rows: readonly ChangeRow[], info: Cell[][]): Sheet[] {
  return [
    { name: "Änderungen", header: true, rows: [COLUMNS.map(([h]) => h), ...rows.map(rowCells)], widths: COLUMNS.map(([, w]) => w) },
    { name: "Info", rows: info, widths: [22, 50, 16] },
  ];
}

// ---- The file name and the Info sheet ---------------------------------------------

/** Each Plan's file name in the export's name is cut to this many characters (ADR 0007). */
const NAME_CHARS = 20;
const shortName = (fileName: string) => fileName.replace(/\.pdf$/i, "").slice(0, NAME_CHARS).trimEnd();

/** "Änderungen <alter Plan> → <neuer Plan>.xlsx". */
export const exportFileName = (oldFile: string, newFile: string) => `Änderungen ${shortName(oldFile)} → ${shortName(newFile)}.xlsx`;

/** A Plan as the Info sheet names it: its Document's file name and, for several pages, which page. */
export interface InfoPlan {
  fileName: string;
  /** 0-based. */
  page: number;
  pages: number;
}

export interface InfoInput {
  old: InfoPlan;
  new: InfoPlan;
  offset: number;
  timeDirection: TimeDirection;
  places: number;
  hidden: number;
  exported: Date;
}

const DAY_MS = 86400000;
/** A local date and time as the wall clock reads it, in days since 1970-01-01. */
const wallClockDays = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) / DAY_MS;

function planRow(label: string, p: InfoPlan): Cell[] {
  return p.pages > 1 ? [label, p.fileName, `Seite ${p.page + 1} von ${p.pages}`] : [label, p.fileName];
}

/** The Info sheet: which Plans, when, the Offset, the Time direction and the counts. No setup. */
export function infoRows(i: InfoInput): Cell[][] {
  return [
    planRow("Alter Plan", i.old),
    planRow("Neuer Plan", i.new),
    ["Exportiert am", { date: wallClockDays(i.exported), time: true }],
    ["Versatz (mm)", { num: i.offset, fmt: "0.00" }],
    ["Zeitrichtung", DIRECTION_LABEL[i.timeDirection]],
    ["Stellen", { num: i.places }],
    ["Ausgeblendete Stellen", { num: i.hidden }],
  ];
}
