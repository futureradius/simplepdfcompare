// What happened at a Place: its main kind of change and every other kind it has, each part
// with exactly one kind (ADR 0005, ADR 0008). Timing is read from the Activity's shape,
// never from its label or leader; a moved label has no amount (ADR 0006).
//
// Ported from the comparison-view prototype (prototypes/comparison/common.mjs: classify).

import type { Mark } from "./compare";
import { unionBox, type Axis, type Box } from "./objects";

/** The kinds of change, in the order of the filter list (GLOSSARY: Kind of change). */
export const KINDS = [
  "later",
  "earlier",
  "longer",
  "shorter",
  "movedAcross",
  "textChanged",
  "new",
  "gone",
  "recoloured",
  "lineWidth",
  "labelMoved",
  "other",
] as const;
export type KindOfChange = (typeof KINDS)[number];

/** How much a Place changed, mm in the Old frame: along the Time direction or across it. */
export type RawAmount = { along: true; mm: number } | { along: false; mm: number; at: number };

export interface Kinds {
  /** The main kind. */
  kind: KindOfChange;
  /** The main kind first, then the others. */
  kinds: KindOfChange[];
  /** The kind of each mark, in the order given. */
  partKinds: KindOfChange[];
  amount: RawAmount | null;
}

/** Changes smaller than this are none, mm. */
const TOL = 0.3;

const restyleKind = (m: Mark): KindOfChange => (m.recoloured === false ? "lineWidth" : "recoloured");

/**
 * The kinds of change of a Place's marks. `isLabel` tells the parts of an Activity's label
 * (its text, background, leader, tags) from its shape.
 */
export function kindsOf(marks: readonly Mark[], axis: Axis, isLabel: (m: Mark) => boolean, inBothPlans = false): Kinds {
  const t = axis === "y";
  const tLo = (b: Box) => (t ? b.y0 : b.x0),
    tHi = (b: Box) => (t ? b.y1 : b.x1),
    aLo = (b: Box) => (t ? b.x0 : b.y0),
    aHi = (b: Box) => (t ? b.x1 : b.y1);
  const core = marks.filter((m) => !m.restyled);
  const styled = marks.length - core.length;
  const o = core.filter((m) => m.plan === "old"),
    n = core.filter((m) => m.plan === "new");
  const words = (l: readonly Mark[]) => l.length > 0 && l.every((m) => m.shape === "word");
  // Recoloured and thicker parts, and a label edited or moved beside a changed shape, are other kinds.
  const extras: KindOfChange[] = [];
  if (marks.some((m) => m.restyled && restyleKind(m) === "recoloured")) extras.push("recoloured");
  if (marks.some((m) => m.restyled && restyleKind(m) === "lineWidth")) extras.push("lineWidth");
  const done = (kind: KindOfChange, amount: RawAmount | null = null): Kinds => {
    const kinds = [kind, ...extras.filter((k) => k !== kind)];
    const lx = kinds.find((k) => k !== kind && (k === "textChanged" || k === "labelMoved"));
    return {
      kind,
      kinds,
      partKinds: marks.map((m) => (m.restyled ? restyleKind(m) : lx && (m.shape === "word" || isLabel(m)) ? lx : kind)),
      amount,
    };
  };
  // Only restyled: the same drawing in another colour, or only in another line width.
  if (!core.length) return done(marks.some((m) => m.recoloured !== false) ? "recoloured" : "lineWidth");
  // A whole label that appears or disappears belongs with a new or removed Activity; with
  // restyled parts around it, or an Activity in both Plans, its words changed.
  if (!o.length) return done(words(n) && (styled > 0 || inBothPlans || !n.every((m) => m.why === "new")) ? "textChanged" : "new");
  if (!n.length) return done(words(o) && (styled > 0 || inBothPlans || !o.every((m) => m.why === "gone")) ? "textChanged" : "gone");
  const label = (m: Mark) => m.shape === "word" || isLabel(m);
  let go = o.filter((m) => !label(m)),
    gn = n.filter((m) => !label(m)),
    labelOnly = false;
  const texts = (l: readonly Mark[]) =>
    l
      .filter((m) => m.shape === "word")
      .map((m) => m.text)
      .sort()
      .join(" ");
  if (!go.length && !gn.length) {
    if (texts(o) !== texts(n)) return done("textChanged");
    go = o;
    gn = n;
    labelOnly = true;
  } else {
    const lo = o.filter(label),
      ln = n.filter(label);
    if (lo.length || ln.length) extras.push(texts(lo) !== texts(ln) ? "textChanged" : "labelMoved");
    if (!go.length || !gn.length) return done("other");
  }
  // A label is placed by hand: how far it moved says nothing about the time.
  if (labelOnly) return done("labelMoved");
  const bo = go.map((m) => m.box).reduce(unionBox),
    bn = gn.map((m) => m.box).reduce(unionBox);
  const d0 = tLo(bn) - tLo(bo),
    d1 = tHi(bn) - tHi(bo),
    dl = d1 - d0,
    da0 = aLo(bn) - aLo(bo),
    da1 = aHi(bn) - aHi(bo);
  if (Math.abs(dl) <= TOL) {
    if (Math.abs(d0) > TOL) return done(d0 > 0 ? "later" : "earlier", { along: true, mm: d0 });
    if (Math.abs(da0) > TOL || Math.abs(da1) > TOL) return done("movedAcross", { along: false, mm: (da0 + da1) / 2, at: aLo(bo) });
    return done("other");
  }
  return done(dl > 0 ? "longer" : "shorter", { along: true, mm: dl });
}
