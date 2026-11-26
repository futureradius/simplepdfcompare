// The frame of the temporary marks view (first thin pass, until the smooth comparison view):
// one picture in the Old Plan's frame that holds both Plans, the New Plan moved by the
// Offset. Pure logic, no DOM.

import type { Axis } from "../compare/objects";
import type { Sides } from "./openplans";

export interface MarkFrame {
  /** The frame's top left corner, Old frame mm. */
  x0: number;
  y0: number;
  widthMm: number;
  heightMm: number;
  pxPerMm: number;
  widthPx: number;
  heightPx: number;
  /** Where each Plan's picture goes, px. */
  place: Sides<[number, number]>;
}

const MAX_PIXELS = 12e6;
const MAX_PX_PER_MM = 4;

export function markFrame(pageMm: Sides<readonly [number, number]>, axis: Axis, offset: number): MarkFrame {
  const [ow, oh] = pageMm.old,
    [nw, nh] = pageMm.new;
  const dx = axis === "x" ? offset : 0,
    dy = axis === "y" ? offset : 0;
  const x0 = Math.min(0, dx),
    y0 = Math.min(0, dy);
  const widthMm = Math.max(ow, nw + dx) - x0,
    heightMm = Math.max(oh, nh + dy) - y0;
  const pxPerMm = Math.min(MAX_PX_PER_MM, Math.sqrt(MAX_PIXELS / (widthMm * heightMm)) * 0.999);
  return {
    x0,
    y0,
    widthMm,
    heightMm,
    pxPerMm,
    widthPx: Math.round(widthMm * pxPerMm),
    heightPx: Math.round(heightMm * pxPerMm),
    place: { old: [(0 - x0) * pxPerMm, (0 - y0) * pxPerMm], new: [(dx - x0) * pxPerMm, (dy - y0) * pxPerMm] },
  };
}
