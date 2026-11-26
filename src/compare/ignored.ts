// Ignored areas ("Bereiche"): parts of the Body that are not compared. Each is a box in its
// own Plan's page mm. An object counts as ignored when its middle lies in one.

import { outlineBox, type Box, type DrawnObject } from "./objects";

export const insideAny = (x: number, y: number, areas: readonly Box[]): boolean =>
  areas.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);

/** The middle of a box; for a letter, where it sits. */
export function middleOf(o: DrawnObject, box: Box = outlineBox(o)): [number, number] {
  if (o.kind === "glyph") return o.origin;
  return [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
}

/** An object (on its own page, unclipped) whose middle lies in an Ignored area. */
export function isIgnored(o: DrawnObject, areas: readonly Box[]): boolean {
  if (!areas.length) return false;
  const [x, y] = middleOf(o);
  return insideAny(x, y, areas);
}
