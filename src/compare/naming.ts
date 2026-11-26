// A Place's name, and when and where it lies on the Plan's axes (ADR 0006). Tried in order:
//   1. the Activity's own Label, read whole, from whichever Plan has one (the New Plan first);
//   2. for an Activity without a Label and for Differences outside any Activity: the text at
//      the free end of a leader line in the same colour, else a text beside it (3 mm);
//   3. a Label that changed on its own: its own text (the New one; the Old one as "vorher"),
//      placed where its leader leads back to;
//   4. on a bar chart (time runs right, or with a Vorgänge zone): the row in the Header
//      across from it, the text by the bar then being only a note;
//   5. otherwise none: it is named by its shape and where it lies.
//
// Ported from the comparison-view prototype (prototypes/comparison/common.mjs: nameAll,
// nameOne).

import type { Activities } from "./activities";
import { dayAt, kmAt, readAxes, type Axes } from "./axes";
import type { Mark } from "./compare";
import { besideText, boxOfObjects, followBack, followLine, labelOf, shapeOf, spanAt, spanOfLetter, splitSeeds, wholeBlock, type TextIndex } from "./labels";
import type { Axis, Box, DrawnObject } from "./objects";
import type { AxisZones, NameSource, When, Where } from "./places";

type Side = "old" | "new";

export interface PlanReading {
  objs: readonly DrawnObject[];
  text: TextIndex;
  activities: Activities;
  /** Read on first use. */
  axes: () => Axes;
  zones: AxisZones;
  body: readonly [number, number];
}

export interface Naming {
  name: string | null;
  nameFrom: NameSource | null;
  oldName: string | null;
  note: string | null;
  shape: string;
  when: When | null;
  where: Where | null;
  /** The side whose axes placed it. */
  side: Side;
  /** Text lines its name was read from ("old|12"), to join a Place that is only that Label. */
  labelSpans: string[];
}

export interface NamingContext {
  axis: Axis;
  /** oldPos = newPos + offset, along time. */
  offset: number;
  plans: Record<Side, PlanReading>;
  marks: readonly Mark[];
}

/** A box in the Old frame, in a Plan's own page mm. */
const toRaw = (b: Box, side: Side, ctx: NamingContext): Box => {
  const d = side === "new" ? ctx.offset : 0;
  return ctx.axis === "y" ? { ...b, y0: b.y0 - d, y1: b.y1 - d } : { ...b, x0: b.x0 - d, x1: b.x1 - d };
};
const unionAll = (bs: Box[]) => bs.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));

/** The row's text in the Header across from `a` (a bar chart's task table). */
function rowText(plan: PlanReading, axis: Axis, a: number): string | null {
  const t = axis === "y",
    rows = plan.zones.rows ?? [];
  const inRows = (b: Box) => rows.some((r) => (b.x0 + b.x1) / 2 >= r.x0 && (b.x0 + b.x1) / 2 <= r.x1 && (b.y0 + b.y1) / 2 >= r.y0 && (b.y0 + b.y1) / 2 <= r.y1);
  const hits: string[] = [];
  for (const s of plan.text.spans.values()) {
    if (!s.text || /^[\d.,:\s-]+$/.test(s.text)) continue;
    const c = t ? (s.box.y0 + s.box.y1) / 2 : (s.box.x0 + s.box.x1) / 2;
    if (rows.length ? !inRows(s.box) : c >= plan.body[0]) continue;
    const lo = t ? s.box.x0 : s.box.y0,
      hi = t ? s.box.x1 : s.box.y1;
    if (a >= lo - 1.5 && a <= hi + 1.5) hits.push(s.text);
  }
  return hits.length ? hits.sort((x, y) => y.length - x.length)[0]! : null;
}

/** Names one Place (its marks by number, the Activities it is). */
export function nameOne(markNos: readonly number[], activities: readonly string[], ctx: NamingContext): Naming {
  const marks = markNos.map((i) => ctx.marks[i]!);
  const sides: Side[] = marks.some((m) => m.plan === "new") ? ["new", "old"] : ["old"];
  const nm: Naming = { name: null, nameFrom: null, oldName: null, note: null, shape: "Text", when: null, where: null, side: sides[0]!, labelSpans: [] };
  let mainRaw: Box | null = null;
  let point = false;

  // 1. The Activity's own Label, the New Activity first, from whichever Plan has one.
  const acts = activities
    .map((k) => {
      const [side, id] = k.split(":") as [Side, string];
      const plan = ctx.plans[side];
      return { side, label: labelOf(plan.text, plan.activities.list[+id]!) };
    })
    .sort((a, b) => Number(b.side === "new") - Number(a.side === "new"));
  const lab = acts.find((a) => a.label.name) ?? acts[0];
  if (lab) {
    nm.side = lab.side;
    const objs = ctx.plans[lab.side].objs;
    const shape = lab.label.shape.map((i) => objs[i]!);
    mainRaw = boxOfObjects(shape);
    nm.shape = shapeOf(shape);
    if (lab.label.name) {
      nm.name = lab.label.name;
      nm.nameFrom = "label";
      // a Label changed in the other Plan: its old text
      const other = acts.find((a) => a.side !== lab.side && a.label.name && a.label.name !== lab.label.name);
      if (other && lab.side === "new") nm.oldName = other.label.name;
      // only its New words changed: the Old Label at the same place
      const word = marks.find((m) => m.plan === "new" && m.shape === "word");
      if (!nm.oldName && lab.side === "new" && word && !marks.some((m) => m.plan === "old")) {
        const old = ctx.plans.old.text,
          so = spanAt(old, word.box);
        const t = so && wholeBlock(old, so).text;
        if (t && t !== nm.name) nm.oldName = t;
      }
    }
  }
  // 2. No Label of its own: the text at a leader's free end, else a text beside it.
  if (!nm.name)
    for (const sd of sides) {
      const plan = ctx.plans[sd];
      const seeds = marks.filter((m) => m.plan === sd && m.shape !== "word").map((m) => m.objects[0]!);
      if (!seeds.length) continue;
      const core = splitSeeds(plan.objs, seeds);
      const f = followLine(plan.text, core);
      const leaders = new Set(f.leaders);
      const main = core.filter((i) => !leaders.has(i));
      const body = (main.length ? main : core).map((i) => plan.objs[i]!);
      if (!mainRaw) {
        mainRaw = boxOfObjects(body);
        nm.side = sd;
        nm.shape = shapeOf(body);
      }
      if (f.hits.length) {
        const block = wholeBlock(plan.text, f.hits[0]!.span);
        Object.assign(nm, { name: block.text, nameFrom: "leader", side: sd });
        nm.labelSpans.push(...block.spans.map((s) => `${sd}|${s.id}`));
        break;
      }
      const b = besideText(plan.text, main.length ? main : core);
      if (b) {
        const block = wholeBlock(plan.text, b);
        Object.assign(nm, { name: block.text, nameFrom: "beside", side: sd });
        nm.labelSpans.push(...block.spans.map((s) => `${sd}|${s.id}`));
        break;
      }
    }
  // 3. A Label that changed on its own: its own text, placed where its leader leads back to.
  if (!mainRaw) {
    for (const sd of ["new", "old"] as const) {
      const words = marks.filter((m) => m.plan === sd && m.shape === "word");
      if (!words.length) continue;
      const plan = ctx.plans[sd];
      const s = spanOfLetter(plan.text, words[0]!.objects[0]!);
      const block = s ? wholeBlock(plan.text, s) : null,
        text = block ? block.text : words.map((w) => w.text).join(" ");
      if (!nm.name) {
        Object.assign(nm, { name: text, nameFrom: "text", side: sd });
        mainRaw = toRaw(unionAll(words.map((w) => w.box)), sd, ctx);
        const back = block ? followBack(plan.text, block.spans) : [];
        if (back.length) {
          const objs = back.map((i) => plan.objs[i]!);
          mainRaw = boxOfObjects(objs);
          nm.shape = shapeOf(objs);
        }
      } else if (text !== nm.name) nm.oldName = text;
    }
    // a replaced word leaves only the new word: read the old text line at the same place
    if (nm.nameFrom === "text" && !nm.oldName && nm.side === "new") {
      const w = marks.find((m) => m.shape === "word")!;
      const old = ctx.plans.old.text,
        so = spanAt(old, w.box);
      const t = so && wholeBlock(old, so).text;
      if (t && t !== nm.name) nm.oldName = t;
    }
  }
  if (nm.shape === "Raute") point = true;
  if (mainRaw) {
    const plan = ctx.plans[nm.side],
      ax = plan.axes(),
      t = ctx.axis === "y";
    const a0 = t ? mainRaw.x0 : mainRaw.y0,
      a1 = t ? mainRaw.x1 : mainRaw.y1,
      t0 = t ? mainRaw.y0 : mainRaw.x0,
      t1 = t ? mainRaw.y1 : mainRaw.x1;
    const k0 = kmAt(ax, a0),
      k1 = kmAt(ax, a1);
    if (k0 !== null && k1 !== null) nm.where = { from: Math.min(k0, k1), to: Math.max(k0, k1) };
    const d0 = dayAt(ax, t0),
      d1 = dayAt(ax, t1);
    if (d0 !== null && d1 !== null) nm.when = { from: Math.min(d0, d1), to: Math.max(d0, d1), point, mmPerDay: 1 / Math.abs(ax.time!.c1) };
    // 4. A bar chart: the row across from it is the name; a text by the bar is a note.
    if (!ax.km && (ctx.axis === "x" || (plan.zones.rows ?? []).length)) {
      const row = rowText(plan, ctx.axis, (a0 + a1) / 2);
      if (row && nm.nameFrom !== "leader") {
        if (nm.name && nm.name !== row) nm.note = nm.name;
        nm.name = row;
        nm.nameFrom = "row";
        nm.oldName = null;
      }
    }
  }
  return nm;
}

/** Text lines that a Place made only of words shows ("new|12"), to join it to the Place its leader or nearness named it for. */
export function spansOfWords(markNos: readonly number[], ctx: NamingContext): string[] | null {
  const marks = markNos.map((i) => ctx.marks[i]!);
  if (!marks.every((m) => m.shape === "word")) return null;
  const out: string[] = [];
  for (const m of marks) {
    const s = spanOfLetter(ctx.plans[m.plan].text, m.objects[0]!);
    if (s) out.push(`${m.plan}|${s.id}`);
  }
  return out;
}

/** The Plan's reading for naming: its text, Activities, and axes on first use. */
export function readPlan(objs: readonly DrawnObject[], text: TextIndex, activities: Activities, axis: Axis, body: readonly [number, number], zones: AxisZones = {}): PlanReading {
  let axes: Axes | undefined;
  return { objs, text, activities, zones, body, axes: () => (axes ??= readAxes(objs, { axis, body, zones, text })) };
}
