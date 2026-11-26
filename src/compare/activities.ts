// The Activities of one Plan, found from its drawing order (ADR 0005). The Plan software
// draws each Activity in one go: a white underlay, its hatch, the outline, a centre line,
// symbols, then the label (a white background, the text, its leader). Neighbouring
// Activities touch corner to corner, so nearness cannot separate them; the drawing order can.
//
// Ported from the comparison-view prototype (prototype/comparison-view,
// prototypes/comparison/activities.mjs: activitiesOf, partOf).

import { cellKey, cellXY, colourOf, inPolygon, objectCells, touching, WHITE } from "./drawing";
import { outlineBox, unionBox, type Box, type DrawnObject } from "./objects";

/** Parts that touch: within this many mm (chained). */
export const TOUCH = 0.6;
/** A text block of the Activity's run within this many mm of its shape is its label. */
const LABEL_NEAR = 5;
/** With no label near its shape: the first label of its colour drawn in its run, this near. */
const LABEL_REACH = 30;
/** How far a run is read at most, objects. */
const RUN_MAX = 2000;

export interface Activity {
  id: number;
  /** Drawing-order number of its white underlay. */
  start: number;
  /** Its hatch (the object after the underlay with the same box). */
  hatch: number;
  /** Its colour: that of its first coloured outline. */
  colour: string | null;
  /** Drawing-order numbers of its objects. */
  objects: number[];
  /** Where its label begins in the drawing order (Infinity: no label). */
  labelFrom: number;
}

export interface Activities {
  /** The Activity of each object (by drawing order), or -1. */
  of: Int32Array;
  list: Activity[];
}

const sameBox = (a: Box, b: Box, t = 0.3) =>
  Math.abs(a.x0 - b.x0) < t && Math.abs(a.y0 - b.y0) < t && Math.abs(a.x1 - b.x1) < t && Math.abs(a.y1 - b.y1) < t;

/** Does an Activity start here: a white underlay followed (within 3 objects) by a hatch with its box? */
function hatchAfter(objs: readonly DrawnObject[], i: number): number {
  const o = objs[i]!;
  if (o.kind !== "fill" || colourOf(o) !== WHITE) return -1;
  const b = outlineBox(o);
  for (let j = i + 1; j <= i + 3 && j < objs.length; j++) if (objs[j]!.kind === "hatch" && sameBox(outlineBox(objs[j]!), b)) return j;
  return -1;
}

const gap = (a: Box, b: Box) => Math.max(a.x0 - b.x1, b.x0 - a.x1, a.y0 - b.y1, b.y0 - a.y1);

/** The Activities of a Plan, from its drawing order. */
export function findActivities(objs: readonly DrawnObject[]): Activities {
  const of = new Int32Array(objs.length).fill(-1);
  const list: Activity[] = [];
  const starts: [number, number][] = [];
  for (let i = 0; i < objs.length; i++) {
    const h = hatchAfter(objs, i);
    if (h >= 0) starts.push([i, h]);
  }
  starts.forEach(([s, hatch], k) => {
    const end = Math.min(k + 1 < starts.length ? starts[k + 1]![0] : objs.length, s + RUN_MAX);
    let colour: string | null = null;
    for (let j = s + 1; j < Math.min(end, s + 6) && !colour; j++) {
      const o = objs[j]!;
      if (o.kind === "stroke" && colourOf(o) !== WHITE) colour = colourOf(o);
    }
    // the objects of its run in its colour, white, or hatched
    const run: number[] = [];
    for (let j = s; j < end; j++) {
      const o = objs[j]!,
        c = colourOf(o);
      if (c === WHITE || c === colour || o.kind === "hatch") run.push(j);
    }
    const parts = touching(run.map((j) => objs[j]!), TOUCH);
    const root = parts[0]!;
    const keep = new Set([root]);
    const glyphOfColour = (j: number) => objs[j]!.kind === "glyph" && colourOf(objs[j]!) === colour;
    const groups = new Map<number, number[]>();
    run.forEach((j, i) => {
      const g = parts[i]!;
      if (g === root) return;
      let l = groups.get(g);
      if (!l) groups.set(g, (l = []));
      l.push(j);
    });
    // a text block of the run near its shape is its label (one set beside it, without a leader)
    const G = LABEL_NEAR / 2,
      nearShape = new Set<number>();
    run.forEach((j, i) => {
      if (parts[i] === root) for (const c of objectCells(objs[j]!, G)) nearShape.add(c);
    });
    const isNear = (j: number) => {
      for (const c of objectCells(objs[j]!, G)) {
        const [x, y] = cellXY(c);
        for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) if (nearShape.has(cellKey(x + dx, y + dy))) return true;
      }
      return false;
    };
    for (const [g, l] of groups) if (l.some(glyphOfColour) && l.some(isNear)) keep.add(g);
    // no label near its shape: the first of its colour drawn in its run, within reach of it
    const hasText = run.some((j, i) => keep.has(parts[i]!) && objs[j]!.kind === "glyph");
    if (!hasText) {
      const sb = outlineBox(objs[s]!);
      const far = [...groups]
        .filter(([, l]) => l.some(glyphOfColour))
        .map(([g, l]) => ({ g, first: Math.min(...l), box: l.map((j) => outlineBox(objs[j]!)).reduce(unionBox) }))
        .filter((x) => gap(x.box, sb) < LABEL_REACH)
        .sort((a, b) => a.first - b.first);
      if (far.length) keep.add(far[0]!.g);
    }
    // a part of its colour inside its shape is its own, even when it does not touch the outline
    const shape = objs[s]!.kind === "fill" ? (objs[s] as { polys: { pts: number[] }[] }).polys[0]?.pts ?? [] : [];
    const inside = (o: DrawnObject) => {
      if (colourOf(o) !== colour) return false;
      const b = outlineBox(o);
      return inPolygon((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, shape);
    };
    const a: Activity = { id: list.length, start: s, hatch, colour, objects: [], labelFrom: Infinity };
    run.forEach((j, i) => {
      if (keep.has(parts[i]!) || inside(objs[j]!)) {
        of[j] = a.id;
        a.objects.push(j);
      }
    });
    // the label begins at the first white background followed by text
    for (const j of a.objects) {
      const o = objs[j]!;
      if (j > s && o.kind === "fill" && colourOf(o) === WHITE && [1, 2].some((d) => objs[j + d]?.kind === "glyph")) {
        a.labelFrom = j;
        break;
      }
    }
    list.push(a);
  });
  return { of, list };
}

/** Is an object part of an Activity's shape, of its label (text, background, leader, tags), or of none? */
export function partOf(acts: Activities, no: number): "shape" | "label" | null {
  const id = acts.of[no] ?? -1;
  if (id < 0) return null;
  return no >= acts.list[id]!.labelFrom ? "label" : "shape";
}
