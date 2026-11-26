// Clipping lines and areas to a box. Ported from the detection prototype.

import type { Box } from "./objects";

/** Liang–Barsky: a segment clipped to a box, or null when it lies outside. */
export function clipSegment(ax: number, ay: number, bx: number, by: number, r: Box): [number, number, number, number] | null {
  let t0 = 0,
    t1 = 1;
  const dx = bx - ax,
    dy = by - ay;
  const p = [-dx, dx, -dy, dy],
    q = [ax - r.x0, r.x1 - ax, ay - r.y0, r.y1 - ay];
  for (let i = 0; i < 4; i++) {
    const pi = p[i]!,
      qi = q[i]!;
    if (pi === 0) {
      if (qi < 0) return null;
      continue;
    }
    const t = qi / pi;
    if (pi < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  return [ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy];
}

/** Sutherland–Hodgman: a polygon (flat points) clipped to a box, or null when nothing is left. */
export function clipPolygon(flat: readonly number[], r: Box): number[] | null {
  let pts: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i]!, flat[i + 1]!]);
  const inside = [(p: number[]) => p[0]! >= r.x0, (p: number[]) => p[0]! <= r.x1, (p: number[]) => p[1]! >= r.y0, (p: number[]) => p[1]! <= r.y1];
  const cut: ((a: number[], b: number[]) => [number, number])[] = [
    (a, b) => [r.x0, a[1]! + ((b[1]! - a[1]!) * (r.x0 - a[0]!)) / (b[0]! - a[0]!)],
    (a, b) => [r.x1, a[1]! + ((b[1]! - a[1]!) * (r.x1 - a[0]!)) / (b[0]! - a[0]!)],
    (a, b) => [a[0]! + ((b[0]! - a[0]!) * (r.y0 - a[1]!)) / (b[1]! - a[1]!), r.y0],
    (a, b) => [a[0]! + ((b[0]! - a[0]!) * (r.y1 - a[1]!)) / (b[1]! - a[1]!), r.y1],
  ];
  for (let e = 0; e < 4 && pts.length; e++) {
    const out: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length]!,
        b = pts[i]!;
      const ina = inside[e]!(a),
        inb = inside[e]!(b);
      if (inb) {
        if (!ina) out.push(cut[e]!(a, b));
        out.push(b);
      } else if (ina) out.push(cut[e]!(a, b));
    }
    pts = out;
  }
  return pts.length >= 3 ? pts.flat() : null;
}
