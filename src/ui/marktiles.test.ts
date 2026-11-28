import { describe, expect, it } from "vitest";
import { LEVEL_STEP, levelFor, levelScale, MAX_TILED_S, metricScale, nearestFirst, pictureFor, tilesFor, TILE_PX } from "./marktiles";

describe("pictureFor: what stands for a tile whose own picture is not up to date", () => {
  const frame = { x0: 0, y0: 0, x1: 3000, y1: 3000 };
  // Level 4 (1.0 px/mm, 1024 mm tiles) and its neighbours.
  const k = 4;
  const t = tilesFor(k, frame, { x0: 10, y0: 10, x1: 20, y1: 20 })[0]!;
  type C = { current: boolean; name: string };
  const cache = (entries: Record<string, C>) => (kk: number, tx: number, ty: number) => entries[`${kk}:${tx}:${ty}`];
  const all = (kk: number, current: boolean, name: string) =>
    Object.fromEntries(tilesFor(kk, frame, t.rect).map((u) => [`${kk}:${u.tx}:${u.ty}`, { current, name }]));

  it("is its own picture when that is up to date", () => {
    const p = pictureFor(k, t, frame, cache({ "4:0:0": { current: true, name: "own" }, ...all(5, true, "coarser") }));
    expect(p.own?.name).toBe("own");
    expect(p.current).toBe(true);
  });

  it("is another level's up-to-date pictures before its own outdated one, the nearest level and coarser first", () => {
    const p = pictureFor(k, t, frame, cache({ "4:0:0": { current: false, name: "own" }, ...all(3, true, "finer"), ...all(5, true, "coarser"), ...all(6, true, "coarser 2") }));
    expect(p.own).toBeUndefined();
    expect(p.cover?.level).toBe(5);
    expect(p.cover?.tiles.map(([c]) => c.name)).toEqual(["coarser"]);
    expect(p.current).toBe(true);
  });

  it("takes a level only when all its pictures over the tile are there", () => {
    const finer = all(3, true, "finer");
    delete finer[Object.keys(finer)[0]!];
    const p = pictureFor(k, t, frame, cache({ ...finer, ...all(6, true, "coarser 2") }));
    expect(p.cover?.level).toBe(6);
  });

  it("is its own outdated picture when nothing up to date can stand in, and says so", () => {
    const p = pictureFor(k, t, frame, cache({ "4:0:0": { current: false, name: "own" }, ...all(5, false, "coarser") }));
    expect(p.own?.name).toBe("own");
    expect(p.current).toBe(false);
  });

  it("is an outdated cover when there is no picture of its own, and nothing when there is none at all", () => {
    expect(pictureFor(k, t, frame, cache(all(5, false, "coarser"))).cover?.level).toBe(5);
    const none = pictureFor(k, t, frame, cache({}));
    expect(none.own).toBeUndefined();
    expect(none.cover).toBeUndefined();
    expect(none.current).toBe(false);
  });
});

describe("nearestFirst: the tiles in view are painted from the middle of the view out", () => {
  it("orders them by their distance from the view's centre", () => {
    const frame = { x0: 0, y0: 0, x1: 4096, y1: 4096 };
    const ts = tilesFor(8, frame, frame); // 0.5 px/mm: 2048 mm tiles, 2 × 2
    const order = nearestFirst(ts, { x: 3000, y: 1000 }).map((u) => `${u.tx}:${u.ty}`);
    expect(order[0]).toBe("1:0");
    expect(order[3]).toBe("0:1");
  });
});

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
