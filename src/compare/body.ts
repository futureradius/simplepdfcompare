// First guesses for the setup, until the setup tabs set them (ADR 0002): the Time direction
// from the page shape, and the Body between the first and the last line drawn across the
// whole Plan. Rough on purpose: the user confirms them. Ported from the alignment prototype
// (prototype/alignment, prototypes/alignment/engine.mjs: guessBody, snapTargets).

import type { Axis, DrawnObject, TimeDirection } from "./objects";

/** Tall: time runs down; wide: time runs to the right (ADR 0002). */
export const guessTimeDirection = ([widthMm, heightMm]: readonly [number, number]): TimeDirection =>
  heightMm >= widthMm ? "down" : "right";

/**
 * Positions along the Time direction of straight lines (and area edges) that run across at
 * least `minShare` of the Plan: where a Header can end or a Footer start. Sorted, 0.05 mm apart.
 */
export function linesAcross(objs: readonly DrawnObject[], pageMm: readonly [number, number], axis: Axis, minShare: number): number[] {
  const t = axis === "y" ? 1 : 0,
    across = pageMm[1 - t]!;
  const out: number[] = [];
  for (const o of objs) {
    if (o.kind === "glyph") continue;
    for (const p of o.polys) {
      const pts = p.pts;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const dt = Math.abs(pts[i + t]! - pts[i + 2 + t]!),
          da = Math.abs(pts[i + 1 - t]! - pts[i + 3 - t]!);
        if (dt < 0.05 && da >= minShare * across) out.push(pts[i + t]!);
      }
    }
  }
  out.sort((a, b) => a - b);
  const kept: number[] = [];
  for (const v of out) if (!kept.length || v - kept[kept.length - 1]! > 0.05) kept.push(v);
  return kept;
}

/** The Body: from the first to the last line across the whole Plan (95 %), not the frame. */
export function guessBody(objs: readonly DrawnObject[], pageMm: readonly [number, number], axis: Axis): [number, number] {
  const length = pageMm[axis === "y" ? 1 : 0]!;
  const full = linesAcross(objs, pageMm, axis, 0.95).filter((v) => v > 1 && v < length - 1);
  if (full.length < 2) return [0, length];
  return [full[0]!, full[full.length - 1]!];
}
