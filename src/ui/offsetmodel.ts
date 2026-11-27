// The rules of the "Versatz" tab that need no DOM (unit-tested): snapping the dragged Plan to
// the Offset candidates, rounding and typing the Offset, and the arrow keys. Ported from the
// alignment prototype (prototype/alignment, variant A: setOffset, nudgeKeys), with Ctrl in
// place of Shift for the 1 mm step because Shift triggers Sticky Keys.

import type { OffsetCandidate } from "../compare/offset";
import type { Axis } from "../compare/objects";

/** Where the shown Offset came from. */
export type OffsetSource = "auto" | "picked" | "hand";

/** A drag snaps to a candidate that lies within this many screen px. */
export const SNAP_PX = 10;

/** Offsets are kept to 0.01 mm. */
export function roundOffset(v: number): number {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
}

export interface Snapped {
  offset: number;
  source: OffsetSource;
  snapped: boolean;
}

/**
 * The Offset for a dragged value: the nearest candidate within SNAP_PX screen px, else the value
 * itself. `free` (Alt held) never snaps. Candidates are best first: the first is "auto".
 */
export function snapOffset(value: number, candidates: readonly OffsetCandidate[], pxPerMm: number, free: boolean, snapPx = SNAP_PX): Snapped {
  if (!free) {
    let best = -1,
      bestDist = snapPx / pxPerMm;
    candidates.forEach((c, i) => {
      const d = Math.abs(c.offset - value);
      if (d <= bestDist) {
        best = i;
        bestDist = d;
      }
    });
    if (best >= 0) return { offset: candidates[best]!.offset, source: best === 0 ? "auto" : "picked", snapped: true };
  }
  return { offset: roundOffset(value), source: "hand", snapped: false };
}

/**
 * Reads a typed Offset: a German or English decimal, an ordinary or a typographic minus, an
 * optional "mm". Undefined if it is no number. Kept within ±limit, rounded to 0.01 mm.
 */
export function parseOffset(text: string, limit = Infinity): number | undefined {
  const t = text
    .trim()
    .replace(/\s*mm$/i, "")
    .replace("−", "-")
    .replace(",", ".");
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return undefined;
  const v = Number(t);
  if (!Number.isFinite(v)) return undefined;
  return roundOffset(Math.max(-limit, Math.min(limit, v)));
}

/**
 * How far a key moves the New Plan along the Time direction, mm; undefined if it is none of the
 * keys. Arrow 0.1 mm, with Ctrl 1 mm; Page down and up 10 mm. Down and right are forwards.
 */
export function nudgeFromKey(e: { key: string; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean }, axis: Axis): number | undefined {
  if (e.altKey || e.metaKey) return undefined;
  const forward = axis === "y" ? "ArrowDown" : "ArrowRight",
    back = axis === "y" ? "ArrowUp" : "ArrowLeft";
  const step = e.ctrlKey ? 1 : 0.1;
  if (e.key === forward) return step;
  if (e.key === back) return -step;
  if (e.key === "PageDown") return 10;
  if (e.key === "PageUp") return -10;
  return undefined;
}

export const formatOffset = (v: number): string => v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Is this the candidate the shown Offset is on? */
export const isCandidateOn = (c: OffsetCandidate, offset: number): boolean => Math.abs(c.offset - offset) < 0.01;

export const SOURCE_TEXT: Record<OffsetSource, string> = {
  auto: "automatisch erkannt",
  picked: "aus den Vorschlägen gewählt",
  hand: "von Hand eingestellt",
};
