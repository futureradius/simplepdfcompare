import { describe, expect, it } from "vitest";
import { dropTargets, isPdf, needsPagePicker, swapped } from "./openplans";

describe("which box a dropped PDF fills", () => {
  it("fills the Old box first when both are empty", () => {
    expect(dropTargets({ old: false, new: false }, 1)).toEqual(["old"]);
  });
  it("fills the New box when the Old one is already filled", () => {
    expect(dropTargets({ old: true, new: false }, 1)).toEqual(["new"]);
  });
  it("fills the Old box when only that one is empty", () => {
    expect(dropTargets({ old: false, new: true }, 1)).toEqual(["old"]);
  });
  it("fills both in order when two are dropped at once", () => {
    expect(dropTargets({ old: false, new: false }, 2)).toEqual(["old", "new"]);
  });
  it("ignores files beyond the empty boxes", () => {
    expect(dropTargets({ old: true, new: false }, 3)).toEqual(["new"]);
    expect(dropTargets({ old: false, new: false }, 5)).toEqual(["old", "new"]);
  });
  it("ignores a drop when both boxes are full", () => {
    expect(dropTargets({ old: true, new: true }, 1)).toEqual([]);
  });
  it("lets a single file dropped on a box replace that box", () => {
    expect(dropTargets({ old: true, new: true }, 1, "old")).toEqual(["old"]);
    expect(dropTargets({ old: false, new: true }, 1, "new")).toEqual(["new"]);
  });
  it("uses the anywhere rule for several files dropped on a box", () => {
    expect(dropTargets({ old: false, new: false }, 2, "new")).toEqual(["old", "new"]);
  });
});

describe("swapping", () => {
  it("exchanges the Old and the New side", () => {
    expect(swapped({ old: "a", new: "b" })).toEqual({ old: "b", new: "a" });
    expect(swapped({ old: "a", new: undefined })).toEqual({ old: undefined, new: "a" });
  });
});

describe("page picker decision", () => {
  it("opens only for a Document with several pages", () => {
    expect(needsPagePicker(1)).toBe(false);
    expect(needsPagePicker(3)).toBe(true);
  });
});

describe("isPdf", () => {
  it("accepts by extension or type", () => {
    expect(isPdf({ name: "Plan.PDF", type: "" })).toBe(true);
    expect(isPdf({ name: "x", type: "application/pdf" })).toBe(true);
    expect(isPdf({ name: "x.png", type: "image/png" })).toBe(false);
  });
});
