// The setup remembered silently for the next pair (ADR 0002): the Header height, the Footer's
// distance from the end and the zones relative to the Header line. The Time direction decides
// whether it fits. Stored in the browser; storage may be unavailable, so every access is guarded.

import type { Axis } from "../compare/objects";
import { lengthOf, type PageMm, type PlanZones, type Zone, type ZoneKind } from "./model";

export interface RememberedZone {
  kind: ZoneKind;
  full: boolean;
  /** Across the Time direction, page mm. */
  a0: number;
  a1: number;
  /** Along the Time direction, mm after the Header line. */
  t0: number;
  t1: number;
}

export interface Remembered {
  axis: Axis;
  header: number;
  footerFromEnd: number;
  zones: RememberedZone[];
}

export function toRemembered(pz: PlanZones, axis: Axis, length: number): Remembered {
  return {
    axis,
    header: pz.header,
    footerFromEnd: length - pz.footer,
    zones: pz.zones.map((z) => {
      const b = z.box;
      const [a0, a1, t0, t1] = axis === "y" ? [b.x0, b.x1, b.y0, b.y1] : [b.y0, b.y1, b.x0, b.x1];
      return { kind: z.kind, full: z.full, a0, a1, t0: t0 - pz.header, t1: t1 - pz.header };
    }),
  };
}

/** The setup on a Plan of this page size, or undefined when it was remembered for the other Time direction. */
export function applyRemembered(r: Remembered, axis: Axis, page: PageMm, nextId: () => number): PlanZones | undefined {
  if (r.axis !== axis) return undefined;
  const len = lengthOf(page, axis);
  const header = Math.min(r.header, len);
  const footer = Math.max(header, len - r.footerFromEnd);
  const zones: Zone[] = r.zones.map((z) => ({
    id: nextId(),
    kind: z.kind,
    full: z.full,
    box: axis === "y" ? { x0: z.a0, x1: z.a1, y0: z.t0 + header, y1: z.t1 + header } : { y0: z.a0, y1: z.a1, x0: z.t0 + header, x1: z.t1 + header },
  }));
  return { header, footer, zones };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const KINDS: ZoneKind[] = ["area", "time", "path", "rows"];

/** Reads the stored text back; anything unusable gives undefined. */
export function parseRemembered(raw: string | null): Remembered | undefined {
  if (raw === null) return undefined;
  try {
    const r = JSON.parse(raw) as Remembered;
    if ((r.axis !== "x" && r.axis !== "y") || !isNum(r.header) || !isNum(r.footerFromEnd) || !Array.isArray(r.zones)) return undefined;
    for (const z of r.zones) if (!KINDS.includes(z.kind) || ![z.a0, z.a1, z.t0, z.t1].every(isNum)) return undefined;
    return r;
  } catch {
    return undefined;
  }
}

const KEY = "simplepdfcompare.setup";

export function loadRemembered(): Remembered | undefined {
  try {
    return parseRemembered(localStorage.getItem(KEY));
  } catch {
    return undefined;
  }
}

export function storeRemembered(r: Remembered): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    // not remembered; the setup still works
  }
}
