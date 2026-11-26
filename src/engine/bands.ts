// Planning the cached overview and the band display lists (ADR 0004). Pure logic: the
// engine renders a Plan whole once at the overview scale, and cuts its display list into
// bands along the Time direction, so that a sharp render walks only the bands it touches.
// Ported from research/smooth-comparison-view (worker.mjs: bands, renderBands).

/** The overview's scale: about 0.5 px per mm (ADR 0004). */
export const OVERVIEW_PX_PER_MM = 0.5;
/** Each side of a bitmap stays under the GPU's texture limit (16,384 px in Edge here). */
const MAX_SIDE_PX = 16000;
const MAX_PIXELS = 24e6;
/** About this long per band, mm. */
const BAND_MM = 1000;
const MAX_BANDS = 32;

/** px per mm of the whole-Plan overview. */
export function overviewScale(widthMm: number, heightMm: number): number {
  return Math.min(OVERVIEW_PX_PER_MM, MAX_SIDE_PX / Math.max(widthMm, heightMm), Math.sqrt(MAX_PIXELS / (widthMm * heightMm)));
}

/** How many bands a Plan this long (along the Time direction) is cut into. */
export function bandCount(lengthMm: number): number {
  return Math.max(1, Math.min(MAX_BANDS, Math.ceil(lengthMm / BAND_MM)));
}

/** The n + 1 edges of n equal bands from lo to hi. */
export function bandEdges(lo: number, hi: number, n: number): number[] {
  return Array.from({ length: n + 1 }, (_, i) => (i === n ? hi : lo + ((hi - lo) * i) / n));
}

/** The bands (by index) that the range a..b reaches into. */
export function bandsTouching(edges: readonly number[], a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < edges.length; i++) if (edges[i + 1]! > a && edges[i]! < b) out.push(i);
  return out;
}
