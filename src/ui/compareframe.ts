// The frame of the comparison view (ADR 0003, ADR 0004): the Old Plan's page mm, with the
// New Plan moved by the Offset along the Time direction. Which parts are not compared, and
// how big the marks are drawn. Pure logic, no DOM.

import type { ComparisonSetup } from "../compare/compare";
import type { Axis, Box } from "../compare/objects";
import type { Role, Sides } from "./openplans";

export type PageSizes = Sides<readonly [number, number]>;

/** Where a Plan's page mm lie in the Old frame: the New Plan moved by the Offset. */
export const shiftOf = (role: Role, axis: Axis, offset: number): { dx: number; dy: number } => {
  const d = role === "new" ? offset : 0;
  return axis === "y" ? { dx: 0, dy: d } : { dx: d, dy: 0 };
};

/** The box in the Old frame that holds both Plans. */
export function comparisonFrame(pages: PageSizes, axis: Axis, offset: number): Box {
  const n = shiftOf("new", axis, offset);
  return {
    x0: Math.min(0, n.dx),
    y0: Math.min(0, n.dy),
    x1: Math.max(pages.old[0], pages.new[0] + n.dx),
    y1: Math.max(pages.old[1], pages.new[1] + n.dy),
  };
}

/** A part of one Plan that is not compared: dimmed, and the Overhang hatched too. */
export interface NotCompared {
  plan: Role;
  kind: "header" | "footer" | "overhang";
  /** In the Old frame. */
  rect: Box;
  label: string;
}

const LABEL: Record<NotCompared["kind"], Sides<string>> = {
  header: { old: "Kopf · nicht verglichen", new: "Kopf · nicht verglichen" },
  footer: { old: "Fuß · nicht verglichen", new: "Fuß · nicht verglichen" },
  overhang: { old: "nur im alten Plan", new: "nur im neuen Plan" },
};

/** Shorter than this along the Time direction, a part is left out, mm. */
const MIN_MM = 1;

/**
 * Header, Footer and Overhang of both Plans, in the Old frame. `window` is what was
 * compared along the Time direction (the comparison's window, Old frame).
 */
export function notCompared(setup: ComparisonSetup, window: readonly [number, number], pages: PageSizes): NotCompared[] {
  const { axis, offset } = setup;
  const t = axis === "y" ? 1 : 0;
  const out: NotCompared[] = [];
  for (const plan of ["old", "new"] as Role[]) {
    const sh = plan === "new" ? offset : 0;
    const length = pages[plan][t]!,
      across = pages[plan][1 - t]!;
    const [b0, b1] = setup[plan].body;
    const add = (kind: NotCompared["kind"], lo: number, hi: number) => {
      if (hi - lo < MIN_MM) return;
      const rect = axis === "y" ? { x0: 0, y0: lo, x1: across, y1: hi } : { x0: lo, y0: 0, x1: hi, y1: across };
      out.push({ plan, kind, rect, label: LABEL[kind][plan] });
    };
    add("header", sh, sh + b0);
    add("footer", sh + b1, sh + length);
    add("overhang", sh + b0, Math.min(sh + b1, window[0]));
    add("overhang", Math.max(sh + b0, window[1]), sh + b1);
  }
  return out;
}

/** What the view needs to know of a Place: where it is and which kinds of mark it has (of those shown). */
export interface PlaceSpot {
  no: number;
  /** In the Old frame. */
  box: Box;
  added: boolean;
  removed: boolean;
}

/** Which Places and marks are shown: the filter and hiding decide (a later slice); all if left out. */
export interface Shown {
  place?(no: number): boolean;
  /** A mark follows the filter by its own kind, also inside a Place of another kind. */
  mark?(index: number): boolean;
}

/** The Places as the view and the minimap show them: only shown ones, from their shown marks. */
export function placeSpots(
  places: readonly { no: number; marks: readonly number[] }[],
  marks: readonly { kind: "Added" | "Removed"; box: Box }[],
  shown: Shown,
): PlaceSpot[] {
  const out: PlaceSpot[] = [];
  for (const p of places) {
    if (shown.place && !shown.place(p.no)) continue;
    let box: Box | undefined,
      added = false,
      removed = false;
    for (const i of p.marks) {
      if (shown.mark && !shown.mark(i)) continue;
      const m = marks[i]!;
      if (m.kind === "Added") added = true;
      else removed = true;
      box = box ? { x0: Math.min(box.x0, m.box.x0), y0: Math.min(box.y0, m.box.y0), x1: Math.max(box.x1, m.box.x1), y1: Math.max(box.y1, m.box.y1) } : { ...m.box };
    }
    if (box) out.push({ no: p.no, box, added, removed });
  }
  return out;
}

/** Places smaller than this on screen get a ring, CSS px (ADR 0003). */
export const RING_BELOW_PX = 18;
/** The ring's radius, CSS px; its centre may lie this far outside the view and still show. */
export const RING_RADIUS_PX = 11;
const RING_MARGIN_PX = 20;

export interface Ring {
  no: number;
  /** Its centre, Old frame mm. */
  x: number;
  y: number;
  kind: "added" | "removed" | "both";
}

/** The rings to draw at `cssPxPerMm` in the view `visible` (Old frame mm). */
export function rings(places: readonly PlaceSpot[], cssPxPerMm: number, visible: Box): Ring[] {
  const m = RING_MARGIN_PX / cssPxPerMm;
  const out: Ring[] = [];
  for (const p of places) {
    const b = p.box;
    if (Math.max(b.x1 - b.x0, b.y1 - b.y0) * cssPxPerMm >= RING_BELOW_PX) continue;
    const x = (b.x0 + b.x1) / 2,
      y = (b.y0 + b.y1) / 2;
    if (x < visible.x0 - m || x > visible.x1 + m || y < visible.y0 - m || y > visible.y1 + m) continue;
    out.push({ no: p.no, x, y, kind: p.added && p.removed ? "both" : p.added ? "added" : "removed" });
  }
  return out;
}

/** How the marks are drawn (ADR 0003); the display settings (a later slice) change them. */
export interface ViewSettings {
  /** The Plan under the marks. */
  base: "old" | "new" | "both";
  /** Marks on. */
  marks: boolean;
  /** How strong the Plan under the marks is, % (100: not faded). */
  fade: number;
  /** The outline around each mark, CSS px (0–50). */
  outline: number;
  /** Removed: the dashed x–x–x line, or a soft yellow outline. */
  removed: "xxx" | "soft";
  /** Size of the x–x–x, %. */
  xSize: number;
  /** A ring around each Place smaller than 18 px. */
  rings: boolean;
}

/** As in the comparison-view prototype (variant A, last round). */
export const DEFAULT_SETTINGS: ViewSettings = { base: "new", marks: true, fade: 35, outline: 6, removed: "xxx", xSize: 70, rings: true };

export interface MarkMetrics {
  /** The outline beyond each side of a mark, mm. */
  outlineMm: number;
  /** Lines are drawn at least this wide, mm. */
  minLineMm: number;
  xxx: {
    /** From the object to the middle of the dashed line, mm. */
    distanceMm: number;
    /** Width of the dashed line and the crosses, mm and device px. */
    lineMm: number;
    linePx: number;
    dashMm: number;
    gapMm: number;
    /** Half the size of a cross, device px. */
    crossHalfPx: number;
  };
}

/**
 * The sizes of the marks in mm at `s` device px per mm, so that on screen they stay the
 * same at any zoom (ADR 0003). Ported from the prototype's paintCompare.
 */
export function markMetrics(settings: Pick<ViewSettings, "outline" | "xSize">, s: number, dpr: number): MarkMetrics {
  const z = settings.xSize / 100,
    out = settings.outline * dpr;
  const linePx = (1 + 0.7 * z) * dpr;
  return {
    outlineMm: out / s,
    minLineMm: (1.5 * dpr) / s,
    xxx: {
      distanceMm: Math.max(4 * dpr, out) / s,
      lineMm: linePx / s,
      linePx,
      dashMm: (9 * z * dpr) / s,
      gapMm: (9 * z * dpr) / s,
      crossHalfPx: 3.6 * z * dpr,
    },
  };
}
