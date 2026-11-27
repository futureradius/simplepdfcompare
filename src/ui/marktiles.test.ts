import { describe, expect, it } from "vitest";
import { LEVEL_STEP, levelFor, levelScale, MAX_TILED_S, metricScale, tilesFor, TILE_PX } from "./marktiles";

describe("levelFor: the cached level a zoom draws from", () => {
  it("is none when zoomed in further than the finest level", () => {
    expect(levelFor(MAX_TILED_S * 1.01)).toBeNull();
    expect(levelFor(3.78)).toBeNull();
  });

  it("is the coarsest level still at least as sharp as the screen, at most one step (2^¼) sharper", () => {
    expect(LEVEL_STEP).toBeCloseTo(Math.pow(2, 1 / 4), 9);
    for (const s of [1.9, 0.74, 0.5, 0.3, 0.1, 0.072, 0.01]) {
      const k = levelFor(s)!;
      expect(levelScale(k)).toBeGreaterThanOrEqual(s);
      expect(levelScale(k)).toBeLessThan(s * LEVEL_STEP + 1e-9);
    }
    expect(levelScale(levelFor(MAX_TILED_S)!)).toBe(MAX_TILED_S);
  });

  it("sizes the marks in a tile for the middle of its level's range: on screen within ±10 % of live", () => {
    for (const s of [1.9, 0.5, 0.072]) {
      const k = levelFor(s)!;
      // A size of n screen px at the metric scale is n * s / metricScale(k) px when drawn at s.
      const r = s / metricScale(k);
      expect(r).toBeGreaterThan(0.9);
      expect(r).toBeLessThan(1.1);
    }
  });
});

describe("tilesFor: the tiles of a level that a view touches", () => {
  const frame = { x0: -50, y0: 0, x1: 1189, y1: 13425 };

  it("covers the view with tiles from the frame's corner, each TILE_PX at the level's scale", () => {
    const k = levelFor(0.5)!,
      s = levelScale(k),
      mm = TILE_PX / s;
    const visible = { x0: 100, y0: 5000, x1: 900, y1: 5600 };
    const ts = tilesFor(k, frame, visible);
    expect(ts.length).toBeGreaterThan(0);
    for (const t of ts) {
      expect(t.rect.x1 - t.rect.x0).toBeCloseTo(mm, 6);
      expect(t.rect.x0).toBeCloseTo(frame.x0 + t.tx * mm, 6);
      expect(t.rect.y0).toBeCloseTo(frame.y0 + t.ty * mm, 6);
    }
    // Every corner of the view lies in one of them.
    for (const [x, y] of [
      [visible.x0, visible.y0],
      [visible.x1, visible.y1],
      [visible.x0, visible.y1],
    ] as const)
      expect(ts.some((t) => x >= t.rect.x0 && x <= t.rect.x1 && y >= t.rect.y0 && y <= t.rect.y1)).toBe(true);
  });

  it("stays inside the frame", () => {
    const k = levelFor(0.072)!;
    const ts = tilesFor(k, frame, { x0: -1000, y0: -1000, x1: 5000, y1: 50000 });
    for (const t of ts) {
      expect(t.tx).toBeGreaterThanOrEqual(0);
      expect(t.rect.x0).toBeLessThan(frame.x1);
      expect(t.rect.y0).toBeLessThan(frame.y1);
    }
    // The whole Plan at whole-view zoom: one or two tiles.
    expect(ts.length).toBeLessThanOrEqual(2);
  });
});
