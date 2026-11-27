// The marks, zoomed out, as cached pictures (ADR 0004, as for the Plans): painted once into
// tiles at a few zoom levels, so a frame only draws pictures. A whole 14 m Plan has tens of
// thousands of marks; painting them all every frame took a third of a second. Zoomed in
// further than the finest level, few marks are in view and they are painted live.
// Pure logic: which level and which tiles.

import type { Box } from "../compare/objects";

/** A tile's side, device px. */
export const TILE_PX = 1024;
/** The finest cached level, device px per mm; zoomed in further, the marks are painted live. */
export const MAX_TILED_S = 2;

/** From one level to the next coarser: close enough that sizes kept on screen stay within ±9 %. */
export const LEVEL_STEP = Math.pow(2, 1 / 4);

/** Level k's scale: the finest level, then each LEVEL_STEP coarser. */
export const levelScale = (k: number): number => (k === 0 ? MAX_TILED_S : MAX_TILED_S / Math.pow(LEVEL_STEP, k));

/**
 * The scale a tile of level k sizes its marks for (outline, x–x–x, rings of lines): the
 * middle of the zooms it is drawn at, so on screen they are off by ±9 % at most.
 */
export const metricScale = (k: number): number => levelScale(k) / Math.sqrt(LEVEL_STEP);

/** The coarsest level at least as sharp as `s` (device px per mm), or null when zoomed in further. */
export function levelFor(s: number): number | null {
  if (s > MAX_TILED_S) return null;
  let k = Math.floor(Math.log(MAX_TILED_S / s) / Math.log(LEVEL_STEP) + 1e-9);
  while (k > 0 && levelScale(k) < s) k--;
  return k;
}

export interface Tile {
  tx: number;
  ty: number;
  /** In the Old frame, mm. */
  rect: Box;
}

/** The tiles of level k, counted from the frame's top left corner, that touch `visible` (both Old frame mm). */
export function tilesFor(k: number, frame: Box, visible: Box): Tile[] {
  const mm = TILE_PX / levelScale(k);
  const x0 = Math.max(visible.x0, frame.x0),
    y0 = Math.max(visible.y0, frame.y0),
    x1 = Math.min(visible.x1, frame.x1),
    y1 = Math.min(visible.y1, frame.y1);
  if (x1 <= x0 || y1 <= y0) return [];
  const out: Tile[] = [];
  for (let ty = Math.floor((y0 - frame.y0) / mm); ty <= Math.floor((y1 - frame.y0 - 1e-9) / mm); ty++) {
    for (let tx = Math.floor((x0 - frame.x0) / mm); tx <= Math.floor((x1 - frame.x0 - 1e-9) / mm); tx++) {
      const rx = frame.x0 + tx * mm,
        ry = frame.y0 + ty * mm;
      out.push({ tx, ty, rect: { x0: rx, y0: ry, x1: rx + mm, y1: ry + mm } });
    }
  }
  return out;
}
