// The temporary marks view: one picture of both Plans in the Old frame.
import { describe, expect, it } from "vitest";
import { markFrame } from "./markframe";

describe("the frame of the marks view", () => {
  it("covers both Plans, the New one moved by the Offset along the Time direction", () => {
    const f = markFrame({ old: [1189, 13710], new: [1189, 13990] }, "y", 560);
    expect([f.x0, f.y0, f.widthMm, f.heightMm]).toEqual([0, 0, 1189, 14550]);
    expect(f.place.old).toEqual([0, 0]);
    expect(f.place.new).toEqual([0, 560 * f.pxPerMm]);
  });

  it("starts before the Old Plan when the Offset is negative", () => {
    const f = markFrame({ old: [590, 210], new: [614, 220] }, "x", -36);
    expect([f.x0, f.y0, f.widthMm, f.heightMm]).toEqual([-36, 0, 626, 220]);
    expect(f.place.old).toEqual([36 * f.pxPerMm, 0]);
    expect(f.place.new).toEqual([0, 0]);
  });

  it("keeps the picture to at most 12 million pixels and 4 px per mm", () => {
    const big = markFrame({ old: [1189, 13710], new: [1189, 13990] }, "y", 560);
    expect(big.widthPx * big.heightPx).toBeLessThanOrEqual(12e6);
    expect(big.widthPx).toBe(Math.round(1189 * big.pxPerMm));
    expect(markFrame({ old: [100, 50], new: [100, 50] }, "x", 0).pxPerMm).toBe(4);
  });
});
