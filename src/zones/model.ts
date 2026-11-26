// The zones of one Plan (ADR 0002): the Header and Footer lines, the Bereiche (Ignored
// areas) and the optional axis zones. Pure geometry in page mm, no DOM. The mouse rules
// (handles, moving, the 4 px click) are adapted from simplepdfclipper's clipdrag.ts.

import type { Axis, Box } from "../compare/objects";

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "move" | "new";

export interface Point {
  x: number;
  y: number;
}

export interface PageMm {
  width: number;
  height: number;
}

/** A Bereich (Ignored area), or an axis zone that is only read: Zeitachse, Wegachse, Vorgänge. */
export type ZoneKind = "area" | "time" | "path" | "rows";

export interface Zone {
  id: number;
  kind: ZoneKind;
  /** Where it lies in page mm. A full-length zone keeps its length here for the way back. */
  box: Box;
  /** Stretched over the whole length of the Plan along the Time direction (a sidebar). */
  full: boolean;
}

/** One Plan's setup. The lines are positions along the Time direction in page mm. */
export interface PlanZones {
  /** Where the Header ends. 0: the Header zone is deleted, its line sits on the Plan's edge. */
  header: number;
  /** Where the Footer starts. The Plan's length: the Footer zone is deleted. */
  footer: number;
  zones: Zone[];
}

export const KIND_NAME: Record<ZoneKind, string> = { area: "Ausgenommen", time: "Zeitachse", path: "Wegachse", rows: "Vorgänge" };

/** The same zone with another kind: geometry, id and length flag stay. */
export const setKind = (z: Zone, kind: ZoneKind): Zone => ({ ...z, kind });

/** "Ausgenommen 1", "Zeitachse 2" ...: every zone is numbered within its kind, 1..n in the order of creation. */
export function zoneLabel(all: readonly Zone[], z: Zone): string {
  return `${KIND_NAME[z.kind]} ${all.filter((o) => o.kind === z.kind).indexOf(z) + 1}`;
}

export const lengthOf = (page: PageMm, axis: Axis): number => (axis === "y" ? page.height : page.width);

/** The symbol of the bubble that stretches a zone over the whole length: it points along the Time direction. */
export const fullLengthGlyph = (axis: Axis): string => (axis === "y" ? "⇕" : "⇔");

export const newZone = (id: number, kind: ZoneKind, box: Box): Zone => ({ id, kind, box, full: false });

export const toggleFull = (z: Zone): Zone => ({ ...z, full: !z.full });

/** The box as it is drawn and compared: a full-length zone runs over the whole Plan along the Time direction. */
export function effectiveBox(z: Zone, axis: Axis, page: PageMm): Box {
  if (!z.full) return z.box;
  return axis === "y" ? { ...z.box, y0: 0, y1: page.height } : { ...z.box, x0: 0, x1: page.width };
}

/** The shaded Header and Footer bands; undefined where the zone is deleted (line on the edge). */
export function bandBoxes(pz: PlanZones, axis: Axis, page: PageMm): [Box | undefined, Box | undefined] {
  const len = lengthOf(page, axis);
  const mk = (t0: number, t1: number): Box => (axis === "y" ? { x0: 0, y0: t0, x1: page.width, y1: t1 } : { x0: t0, y0: 0, x1: t1, y1: page.height });
  return [pz.header > 0 ? mk(0, pz.header) : undefined, pz.footer < len ? mk(pz.footer, len) : undefined];
}

/** The Bereiche as boxes for the comparison, in page mm. */
export const ignoredBoxes = (pz: PlanZones, axis: Axis, page: PageMm): Box[] =>
  pz.zones.filter((z) => z.kind === "area").map((z) => effectiveBox(z, axis, page));

/** Which part of the box is under point p? tol is the grab distance in mm. */
export function hitTest(c: Box, p: Point, tol: number): Handle {
  const insideX = p.x >= c.x0 - tol && p.x <= c.x1 + tol;
  const insideY = p.y >= c.y0 - tol && p.y <= c.y1 + tol;
  if (!insideX || !insideY) return "new";
  const v = Math.abs(p.y - c.y0) <= tol ? "n" : Math.abs(p.y - c.y1) <= tol ? "s" : "";
  const h = Math.abs(p.x - c.x0) <= tol ? "w" : Math.abs(p.x - c.x1) <= tol ? "e" : "";
  if (v || h) return (v + h) as Handle;
  return "move";
}

const normalise = (b: Box): Box => ({ x0: Math.min(b.x0, b.x1), y0: Math.min(b.y0, b.y1), x1: Math.max(b.x0, b.x1), y1: Math.max(b.y0, b.y1) });

/**
 * The box after dragging `handle` from `from` to `to`, kept on the Plan. Each dragged edge stops
 * hard at the Plan's edge; dragging past the opposite edge flips the box. For a full-length zone
 * `keepLength` is its stored box: only the way across changes, the length stays.
 */
export function dragZone(start: Box, handle: Handle, from: Point, to: Point, page: PageMm, axis: Axis, keepLength?: Box): Box {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const cx = (x: number) => Math.min(Math.max(0, x), page.width);
  const cy = (y: number) => Math.min(Math.max(0, y), page.height);
  let out: Box;
  if (handle === "new") {
    out = normalise({ x0: cx(from.x), y0: cy(from.y), x1: cx(to.x), y1: cy(to.y) });
  } else if (handle === "move") {
    const w = start.x1 - start.x0,
      h = start.y1 - start.y0;
    const x0 = Math.min(Math.max(0, start.x0 + dx), Math.max(0, page.width - w));
    const y0 = Math.min(Math.max(0, start.y0 + dy), Math.max(0, page.height - h));
    out = { x0, y0, x1: x0 + w, y1: y0 + h };
  } else {
    let { x0, y0, x1, y1 } = start;
    if (handle.includes("w")) x0 = cx(x0 + dx);
    if (handle.includes("e")) x1 = cx(x1 + dx);
    if (handle.includes("n")) y0 = cy(y0 + dy);
    if (handle.includes("s")) y1 = cy(y1 + dy);
    out = normalise({ x0, y0, x1, y1 });
  }
  if (keepLength) out = axis === "y" ? { ...out, y0: keepLength.y0, y1: keepLength.y1 } : { ...out, x0: keepLength.x0, x1: keepLength.x1 };
  return out;
}

/** A press that moves less than this many CSS px is a click, not a drag (as in the clipper). */
export const CLICK_PX = 4;

export const isClick = (down: Point, now: Point): boolean => Math.hypot(now.x - down.x, now.y - down.y) < CLICK_PX;

const clipBox = (b: Box, page: PageMm): Box | undefined => {
  const r = { x0: Math.max(0, b.x0), y0: Math.max(0, b.y0), x1: Math.min(page.width, b.x1), y1: Math.min(page.height, b.y1) };
  return r.x0 < r.x1 && r.y0 < r.y1 ? r : undefined;
};

/**
 * The New Plan's zones from the Old Plan's (ADR 0002): the Header with the same height, the
 * Footer with the same distance from the end (it moves with the end of the Body), every other
 * zone at the same place on the page. A zone beyond a shorter Plan is cut, or dropped if nothing is left.
 */
export function copyToNewPlan(old: PlanZones, oldLength: number, newPage: PageMm, axis: Axis): PlanZones {
  const newLength = lengthOf(newPage, axis);
  const header = Math.min(old.header, newLength);
  const footer = Math.max(header, newLength - (oldLength - old.footer));
  const zones: Zone[] = [];
  for (const z of old.zones) {
    const box = clipBox(z.box, newPage);
    if (box) zones.push({ ...z, box });
  }
  return { header, footer, zones };
}

/** The size shown in a name tag, as "120 × 340 mm" (across × along the Time direction). */
export function sizeText(b: Box, axis: Axis): string {
  const w = b.x1 - b.x0,
    h = b.y1 - b.y0;
  const [across, along] = axis === "y" ? [w, h] : [h, w];
  const n = (v: number) => Math.round(v).toLocaleString("de-DE");
  return `${n(across)} × ${n(along)} mm`;
}
