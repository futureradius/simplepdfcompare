// Places (GLOSSARY: Place; ADR 0005, 0006, 0008): the Differences of one Activity looked at
// as one, with its kinds of change, its name, and when and where it lies on the Plan's axes.
// Pure logic on the Plans' objects and the comparison; run once when the comparison is read.

import { findActivities, partOf, type Activities } from "./activities";
import { kmAt, type Axes } from "./axes";
import type { Comparison, ComparisonSetup, Mark } from "./compare";
import { groupMarks, type Group } from "./grouping";
import { kindsOf, type KindOfChange, type RawAmount } from "./kinds";
import { indexText } from "./labels";
import { nameOne, readPlan, spansOfWords, type Naming, type NamingContext } from "./naming";
import { unionBox, type Box, type DrawnObject } from "./objects";

/** Where the user marked the axes on a Plan (step 2), in its own page mm. Optional. */
export interface AxisZones {
  /** Zeitachse: dates and hours. */
  time?: readonly Box[];
  /** Wegachse: km. */
  location?: readonly Box[];
  /** Vorgänge: the row names of a bar chart. */
  rows?: readonly Box[];
}

export interface PlacesInput {
  old: readonly DrawnObject[];
  new: readonly DrawnObject[];
  setup: ComparisonSetup;
  comparison: Comparison;
  axisZones?: { old?: AxisZones; new?: AxisZones };
}

/** How a Place got its name (ADR 0006). */
export type NameSource = "label" | "leader" | "beside" | "text" | "row";

/** A time range on the Plan's time axis: days since 1970-01-01 (UTC), with fractions for hours. */
export interface When {
  from: number;
  to: number;
  /** A milestone: one moment, at its middle. */
  point: boolean;
  /** The scale, to tell a day boundary from a time of day (0.6 mm, ADR 0006). */
  mmPerDay: number;
}

/** A km range on the Plan's location axis. */
export interface Where {
  from: number;
  to: number;
}

/** How much a Place changed: in days along time or in km across, once the axis is read; else mm. */
export interface Amount {
  along: boolean;
  mm: number;
  /** Along: days (snapped to whole days within 0.05 mm). */
  days: number | null;
  /** Across: km. */
  km: number | null;
}

export interface Place {
  /** Its number, in the order of the Places along time. */
  no: number;
  kind: KindOfChange;
  /** The main kind first, then every other kind it has. */
  kinds: KindOfChange[];
  /** Its Differences: numbers into the comparison's marks. */
  marks: number[];
  /** The kind of each of its marks. */
  partKinds: KindOfChange[];
  /** In the Old frame. */
  box: Box;
  name: string | null;
  nameFrom: NameSource | null;
  /** A changed label's old text ("vorher"). */
  oldName: string | null;
  /** On a bar chart named by its row: the text by the bar. */
  note: string | null;
  /** Its shape, to name it by when it has no name ("Schraffur", "Linie" ...). */
  shape: string;
  when: When | null;
  where: Where | null;
  amount: Amount | null;
}

/** Amounts snap to whole days within this many mm (ADR 0006). */
const WHOLE_DAY = 0.05;

export function findPlaces(input: PlacesInput): Place[] {
  const { comparison, setup } = input;
  const { axis } = setup;
  const marks = comparison.marks;
  const activities: { old: Activities; new: Activities } = { old: findActivities(input.old), new: findActivities(input.new) };
  const groups = groupMarks({ marks, links: comparison.links, objects: { old: input.old, new: input.new }, activities });
  const isLabel = (m: Mark) => partOf(activities[m.plan], m.objects[0]!) === "label";
  const ctx: NamingContext = {
    axis,
    offset: setup.offset,
    marks,
    plans: {
      old: readPlan(input.old, indexText(input.old), activities.old, axis, setup.old.body, input.axisZones?.old),
      new: readPlan(input.new, indexText(input.new), activities.new, axis, setup.new.body, input.axisZones?.new),
    },
  };
  // A Place that is only a Label joins the Place whose leader or nearness named it by that Label.
  const owner = new Map<string, Group>();
  for (const g of groups) for (const k of spansOfWords(g.marks, ctx) ?? []) owner.set(k, g);
  const named = new Map<Group, Naming>(),
    eaten = new Set<Group>();
  for (const g of groups) {
    if (eaten.has(g)) continue;
    const nm = nameOne(g.marks, g.activities, ctx);
    named.set(g, nm);
    for (const k of nm.labelSpans) {
      const q = owner.get(k);
      if (!q || q === g || eaten.has(q)) continue;
      eaten.add(q);
      g.marks.push(...q.marks);
    }
  }
  const places: Place[] = groups
    .filter((g) => !eaten.has(g))
    .map((g) => {
      const ms = g.marks.map((i) => marks[i]!);
      const inBoth = g.activities.some((a) => a.startsWith("old:")) && g.activities.some((a) => a.startsWith("new:"));
      const k = kindsOf(ms, axis, isLabel, inBoth);
      const nm = named.get(g)!;
      return {
        no: 0,
        kind: k.kind,
        kinds: k.kinds,
        marks: g.marks,
        partKinds: k.partKinds,
        box: ms.map((m) => m.box).reduce(unionBox),
        name: nm.name,
        nameFrom: nm.nameFrom,
        oldName: nm.oldName,
        note: nm.note,
        shape: nm.shape,
        when: nm.when,
        where: nm.where,
        amount: k.amount ? amountOf(k.amount, ctx.plans[nm.side].axes(), ctx.plans[nm.side === "new" ? "old" : "new"].axes()) : null,
      };
    });
  const t0 = axis === "y" ? "y0" : "x0";
  places.sort((a, b) => a.box[t0] - b.box[t0]);
  places.forEach((p, i) => (p.no = i + 1));
  return places;
}

/** An amount in days along time or km across, read on the Plan's axes (or the other Plan's). */
function amountOf(raw: RawAmount, ax: Axes, other: Axes): Amount {
  const time = ax.time ?? other.time;
  if (raw.along) {
    if (!time) return { along: true, mm: raw.mm, days: null, km: null };
    const mmPerDay = 1 / Math.abs(time.c1),
      v = Math.abs(raw.mm) / mmPerDay;
    return { along: true, mm: raw.mm, days: Math.abs(v - Math.round(v)) * mmPerDay < WHOLE_DAY ? Math.round(v) : v, km: null };
  }
  // across, from where the Old shape lies (across is the same in both Plans)
  const k = ax.km ? ax : other.km ? other : null;
  if (!k) return { along: false, mm: raw.mm, days: null, km: null };
  return { along: false, mm: raw.mm, days: null, km: Math.abs(kmAt(k, raw.at + raw.mm)! - kmAt(k, raw.at)!) };
}
