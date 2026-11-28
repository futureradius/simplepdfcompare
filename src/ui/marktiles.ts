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

/** The levels that may stand in for level k: the nearest first, coarser before finer, then only coarser. */
function standInLevels(k: number): number[] {
  const out = [k + 1, k - 1, k + 2, k - 2, k + 3, k - 3];
  for (let i = 4; i < 44; i++) out.push(k + i);
  return out.filter((kk) => kk >= 0);
}

/** A cached picture of a tile; `current`: it shows the marks as they are now. */
export interface Cached {
  current: boolean;
}

export interface Picture<T extends Cached> {
  /** The tile's own picture. */
  own?: T;
  /** Else another level's pictures over the tile, all of them there. */
  cover?: { level: number; tiles: [T, Box][] };
  /** What it shows is up to date. */
  current: boolean;
}

/**
 * What a frame draws for tile `t` of level k, from the cached pictures (`get`): its own when
 * up to date; else another level's up-to-date pictures (a little off in size and sharpness,
 * but right); else its own outdated picture, else another level's outdated ones, until the
 * new one is painted; else nothing.
 */
export function pictureFor<T extends Cached>(k: number, t: Tile, frame: Box, get: (k: number, tx: number, ty: number) => T | undefined): Picture<T> {
  const own = get(k, t.tx, t.ty);
  if (own?.current) return { own, current: true };
  let outdated: Picture<T>["cover"];
  for (const kk of standInLevels(k)) {
    const under = tilesFor(kk, frame, t.rect).map((u) => [get(kk, u.tx, u.ty), u.rect] as const);
    if (!under.length || !under.every(([u]) => u)) continue;
    const cover = { level: kk, tiles: under as [T, Box][] };
    if (under.every(([u]) => u!.current)) return { cover, current: true };
    outdated ??= cover;
  }
  if (own) return { own, current: false };
  return outdated ? { cover: outdated, current: false } : { current: false };
}

/** The tiles ordered by the distance of their middle from `centre` (Old frame mm), the nearest first. */
export function nearestFirst(tiles: readonly Tile[], centre: { x: number; y: number }): Tile[] {
  const d = (t: Tile) => Math.hypot((t.rect.x0 + t.rect.x1) / 2 - centre.x, (t.rect.y0 + t.rect.y1) / 2 - centre.y);
  return [...tiles].sort((a, b) => d(a) - d(b));
}
