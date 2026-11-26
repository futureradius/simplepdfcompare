// Finding the Offset (ADR 0001): vote over pairs of identically shaped objects in both
// Bodies that sit at the same place across the Time direction; every pair votes for how far
// the New Plan is shifted along it. Ported from the detection prototype's refineOffset
// (prototype/difference-detection) with the whole Plan as its range, as the alignment
// prototype's offsetCandidates used it.
//
// The Offset maps the New Plan onto the Old: oldPos = newPos + offset (along the Time direction).

import { boxOfPoints, type Axis, type Box, type DrawnObject } from "./objects";
import { isIgnored } from "./ignored";

export interface OffsetCandidate {
  /** mm */
  offset: number;
  /** How many pairs of identical shapes agree on it. */
  votes: number;
}

export interface OffsetResult extends OffsetCandidate {
  /** Best first, at least 1 mm apart. */
  candidates: OffsetCandidate[];
}

export interface OffsetOptions {
  axis: Axis;
  /** Each Plan's Body along the Time direction, in its own page mm. */
  bodyOld: [number, number];
  bodyNew: [number, number];
  /** Ignored areas, each in its own Plan's page mm. */
  ignoredOld?: Box[];
  ignoredNew?: Box[];
  /** How many candidates to list. */
  top?: number;
}

/** Shapes with more points than this do not vote (long lines rarely repeat exactly). */
const MAX_COORDS = 40;
/** A shape that appears more often than this in the Old Plan does not vote (grid ticks, dashes). */
const MAX_TWINS = 50;
/** How far apart across the Time direction two shapes may sit and still vote, mm. */
const ACROSS_TOL = 0.2;
/** Votes are counted in bins of 0.01 mm, summed with their neighbours within 0.02 mm. */
const BIN = 100;

const tIndex = (axis: Axis) => (axis === "y" ? 1 : 0);

function shapeKey(o: DrawnObject): string | null {
  if (o.kind === "glyph") return `${o.style}|${Math.round(o.nums[0]! * 10)}`;
  const all = o.polys.flatMap((p) => p.pts);
  if (all.length > MAX_COORDS) return null;
  const b = boxOfPoints(all);
  return `${o.style}|${o.nums.map((v) => Math.round(v * 10))}|${all.map((v, i) => Math.round((v - (i % 2 ? b.y0 : b.x0)) * 10)).join(",")}`;
}

function position(o: DrawnObject): [number, number] {
  if (o.kind === "glyph") return o.origin;
  const b = boxOfPoints(o.polys.flatMap((p) => p.pts));
  return [b.x0, b.y0];
}

/** Lies the whole object inside [b0, b1] along the Time direction? */
function inBody(o: DrawnObject, t: number, [b0, b1]: [number, number]): boolean {
  if (o.kind === "glyph") return o.origin[t]! >= b0 && o.origin[t]! <= b1;
  const b = boxOfPoints(o.polys.flatMap((p) => p.pts));
  return (t ? b.y0 : b.x0) >= b0 && (t ? b.y1 : b.x1) <= b1;
}

export function findOffset(oldObjs: readonly DrawnObject[], newObjs: readonly DrawnObject[], opts: OffsetOptions): OffsetResult {
  const t = tIndex(opts.axis),
    top = opts.top ?? 4;
  const keep = (objs: readonly DrawnObject[], body: [number, number], ignored: Box[] = []) =>
    objs.filter((o) => inBody(o, t, body) && !isIgnored(o, ignored));

  const byKey = new Map<string, [number, number][]>();
  for (const o of keep(oldObjs, opts.bodyOld, opts.ignoredOld)) {
    const k = shapeKey(o);
    if (!k) continue;
    let list = byKey.get(k);
    if (!list) byKey.set(k, (list = []));
    list.push(position(o));
  }
  const bins = new Map<number, number>();
  const deltas: number[] = [];
  for (const o of keep(newObjs, opts.bodyNew, opts.ignoredNew)) {
    const k = shapeKey(o),
      list = k ? byKey.get(k) : undefined;
    if (!list || list.length > MAX_TWINS) continue;
    const p = position(o);
    for (const q of list) {
      if (Math.abs(q[1 - t]! - p[1 - t]!) > ACROSS_TOL) continue;
      const d = q[t]! - p[t]!;
      const bin = Math.round(d * BIN);
      bins.set(bin, (bins.get(bin) ?? 0) + 1);
      deltas.push(d);
    }
  }
  const around = (bin: number) => {
    let n = 0;
    for (let k = -2; k <= 2; k++) n += bins.get(bin + k) ?? 0;
    return n;
  };
  const ranked = [...bins.keys()].map((bin) => [bin, around(bin)] as const).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const peaks: number[] = [];
  for (const [bin] of ranked) {
    if (peaks.length >= top) break;
    if (peaks.some((p) => Math.abs(p - bin) < BIN)) continue;
    peaks.push(bin);
  }
  if (!peaks.length) return { offset: 0, votes: 0, candidates: [] };
  const candidates = peaks.map((bin) => {
    const near = deltas.filter((d) => Math.abs(d - bin / BIN) <= 2 / BIN);
    return { offset: near.reduce((a, b) => a + b, 0) / near.length, votes: near.length };
  });
  return { ...candidates[0]!, candidates };
}
