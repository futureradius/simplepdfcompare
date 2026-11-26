import { describe, expect, it } from "vitest";
import { bandCount, bandEdges, bandsTouching, overviewScale } from "./bands";

describe("overviewScale", () => {
  it("renders the 14 m Plan whole at 0.5 px per mm (ADR 0004)", () => {
    expect(overviewScale(1189, 13990)).toBe(0.5);
  });

  it("keeps each side of the picture under the GPU's 16,384 px", () => {
    const s = overviewScale(1189, 40000);
    expect(40000 * s).toBeLessThanOrEqual(16000);
    expect(s).toBeCloseTo(0.4);
  });

  it("keeps a huge sheet under 24 Mpx", () => {
    const s = overviewScale(12000, 12000);
    expect(12000 * s * 12000 * s).toBeLessThanOrEqual(24e6);
  });
});

describe("band planning", () => {
  it("cuts a 14 m Plan into 14 bands of about 1 m along the Time direction", () => {
    expect(bandCount(13710)).toBe(14);
    expect(bandCount(1120)).toBe(2);
    expect(bandCount(300)).toBe(1);
  });

  it("never makes more than 32 bands", () => {
    expect(bandCount(100_000)).toBe(32);
  });

  it("edges split the length evenly, from the first to the last", () => {
    expect(bandEdges(0, 1000, 4)).toEqual([0, 250, 500, 750, 1000]);
    expect(bandEdges(-10, 10, 2)).toEqual([-10, 0, 10]);
  });

  it("a region walks only the bands it touches", () => {
    const edges = [0, 250, 500, 750, 1000];
    expect(bandsTouching(edges, 260, 490)).toEqual([1]);
    expect(bandsTouching(edges, 200, 600)).toEqual([0, 1, 2]);
    expect(bandsTouching(edges, -50, 10)).toEqual([0]);
    expect(bandsTouching(edges, 1200, 1300)).toEqual([]);
    expect(bandsTouching(edges, 0, 1000)).toEqual([0, 1, 2, 3]);
  });
});
