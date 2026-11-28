import { describe, expect, it } from "vitest";
import { ADDED, placesMask, REMOVED } from "./minimapraster";

const at = (m: Uint8Array, w: number, x: number, y: number) => m[y * w + x];

describe("placesMask: the Places of the minimap as pixels, each mark grown by half the 3 px line", () => {
  const W = 40,
    H = 40;

  it("a dot is a disc of its diameter around its middle", () => {
    const m = placesMask(W, H, [{ colour: "added", dot: { x: 20, y: 20, d: 3 } }], { scale: 1, origin: { x: 0, y: 0 }, r: 1.5 });
    expect(at(m, W, 20, 20)).toBe(ADDED);
    expect(at(m, W, 19, 19)).toBe(ADDED);
    expect(at(m, W, 22, 20)).toBe(0);
  });

  it("a small mark is its box, grown by the half line", () => {
    const mark = { shape: "area" as const, box: { x0: 10, y0: 10, x1: 11, y1: 11 }, coords: [10, 10, 11, 10, 11, 11, 10, 11] };
    const m = placesMask(W, H, [{ colour: "removed", marks: [mark] }], { scale: 1, origin: { x: 0, y: 0 }, r: 1.5 });
    for (const [x, y] of [[9, 9], [11, 11], [8, 10]]) expect(at(m, W, x!, y!)).toBe(REMOVED);
    expect(at(m, W, 13, 10)).toBe(0);
    expect(at(m, W, 10, 13)).toBe(0);
  });

  it("a larger line keeps its own shape: the pixels along it, not its box", () => {
    const line = { shape: "line" as const, box: { x0: 0, y0: 0, x1: 30, y1: 30 }, coords: [0, 0, 30, 30] };
    const m = placesMask(W, H, [{ colour: "added", marks: [line] }], { scale: 1, origin: { x: 0, y: 0 }, r: 1.5 });
    expect(at(m, W, 15, 15)).toBe(ADDED);
    expect(at(m, W, 25, 5)).toBe(0); // inside its box, away from the line
  });

  it("a larger area is filled inside, not only along its edges", () => {
    const area = { shape: "area" as const, box: { x0: 5, y0: 5, x1: 30, y1: 30 }, coords: [5, 5, 30, 5, 30, 30, 5, 30] };
    const m = placesMask(W, H, [{ colour: "removed", marks: [area] }], { scale: 1, origin: { x: 0, y: 0 }, r: 1.5 });
    expect(at(m, W, 17, 17)).toBe(REMOVED);
  });

  it("Added lies over Removed, and the scale and origin place the marks (mm to px)", () => {
    const mark = (x: number) => ({ shape: "word" as const, box: { x0: x, y0: 100, x1: x + 10, y1: 110 }, coords: [] });
    const m = placesMask(W, H, [
      { colour: "added", marks: [mark(1000)] },
      { colour: "removed", marks: [mark(1000)] },
    ], { scale: 0.1, origin: { x: 900, y: 0 }, r: 0.5 });
    expect(at(m, W, 10, 10)).toBe(ADDED);
  });
});
