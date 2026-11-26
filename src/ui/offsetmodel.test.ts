import { describe, expect, it } from "vitest";
import { formatOffset, isCandidateOn, nudgeFromKey, parseOffset, roundOffset, snapOffset } from "./offsetmodel";

const cands = [
  { offset: 560, votes: 90 },
  { offset: 12.5, votes: 20 },
];

describe("snapping the Offset while the Plan is dragged", () => {
  it("jumps to the best candidate when close, and calls it the automatic one", () => {
    expect(snapOffset(558, cands, 1, false)).toEqual({ offset: 560, source: "auto", snapped: true });
  });

  it("jumps to another candidate and calls it picked", () => {
    expect(snapOffset(14, cands, 1, false)).toEqual({ offset: 12.5, source: "picked", snapped: true });
  });

  it("reaches 10 screen px: far in mm when zoomed out, near when zoomed in", () => {
    expect(snapOffset(540, cands, 0.5, false).snapped).toBe(true); // 20 mm = 10 px
    expect(snapOffset(540, cands, 2, false).snapped).toBe(false); // 20 mm = 40 px
  });

  it("does not snap with Alt held: the value is free, rounded to 0.01 mm", () => {
    expect(snapOffset(559.99912, cands, 1, true)).toEqual({ offset: 560, source: "hand", snapped: false });
    expect(snapOffset(558.123, cands, 1, true)).toEqual({ offset: 558.12, source: "hand", snapped: false });
  });

  it("takes the nearest of two candidates in reach", () => {
    const two = [
      { offset: 10, votes: 5 },
      { offset: 14, votes: 9 },
    ];
    expect(snapOffset(13, two, 1, false).offset).toBe(14);
  });

  it("leaves a value that is not near any candidate by hand", () => {
    expect(snapOffset(300, cands, 1, false)).toEqual({ offset: 300, source: "hand", snapped: false });
  });
});

describe("typing the Offset", () => {
  it("reads a German or an English decimal and a minus sign", () => {
    expect(parseOffset("560,5")).toBe(560.5);
    expect(parseOffset(" 12.25 ")).toBe(12.25);
    expect(parseOffset("−3,5")).toBe(-3.5);
    expect(parseOffset("-0,1")).toBe(-0.1);
    expect(parseOffset("560 mm")).toBe(560);
  });

  it("rounds to 0.01 mm", () => {
    expect(parseOffset("1,2345")).toBe(1.23);
  });

  it("refuses what is no number", () => {
    for (const t of ["", "abc", "1,2,3", "--1", "1e400", "mm"]) expect(parseOffset(t)).toBeUndefined();
  });

  it("keeps the value within the limit", () => {
    expect(parseOffset("99999", 5000)).toBe(5000);
    expect(parseOffset("-99999", 5000)).toBe(-5000);
  });

  it("never gives minus zero", () => {
    expect(Object.is(parseOffset("-0"), 0)).toBe(true);
    expect(Object.is(roundOffset(-0.001), 0)).toBe(true);
  });
});

describe("arrow keys", () => {
  it("nudge along the Time direction: down runs with the arrows up and down", () => {
    expect(nudgeFromKey({ key: "ArrowDown" }, "y")).toBe(0.1);
    expect(nudgeFromKey({ key: "ArrowUp" }, "y")).toBe(-0.1);
    expect(nudgeFromKey({ key: "ArrowRight" }, "y")).toBeUndefined();
  });

  it("nudge along the Time direction: right runs with the arrows left and right", () => {
    expect(nudgeFromKey({ key: "ArrowRight" }, "x")).toBe(0.1);
    expect(nudgeFromKey({ key: "ArrowLeft" }, "x")).toBe(-0.1);
    expect(nudgeFromKey({ key: "ArrowDown" }, "x")).toBeUndefined();
  });

  it("take 1 mm with Ctrl (not Shift: Shift triggers Sticky Keys) and 10 mm on Page up and down", () => {
    expect(nudgeFromKey({ key: "ArrowDown", ctrlKey: true }, "y")).toBe(1);
    expect(nudgeFromKey({ key: "ArrowDown", shiftKey: true }, "y")).toBe(0.1);
    expect(nudgeFromKey({ key: "PageDown" }, "y")).toBe(10);
    expect(nudgeFromKey({ key: "PageUp" }, "x")).toBe(-10);
  });

  it("do not nudge with Alt or Meta", () => {
    expect(nudgeFromKey({ key: "ArrowDown", altKey: true }, "y")).toBeUndefined();
    expect(nudgeFromKey({ key: "ArrowDown", metaKey: true }, "y")).toBeUndefined();
  });
});

describe("showing the Offset", () => {
  it("writes it with two decimals and a German comma", () => {
    expect(formatOffset(560)).toBe("560,00");
    expect(formatOffset(-0.1)).toBe("-0,10");
  });

  it("marks the candidate that is on", () => {
    expect(isCandidateOn(cands[0]!, 560.004)).toBe(true);
    expect(isCandidateOn(cands[0]!, 560.02)).toBe(false);
  });
});

describe("rounding", () => {
  it("rounds to 0.01 mm without float dust", () => {
    expect(roundOffset(0.1 + 0.2)).toBe(0.3);
    expect(roundOffset(559.9987)).toBe(560);
  });
});
