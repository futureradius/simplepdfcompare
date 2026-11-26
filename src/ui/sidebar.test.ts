import { describe, expect, it } from "vitest";
import { clampPanelWidth, PANEL_DEFAULT, PANEL_MIN, readPanelWidth } from "./sidebar";

describe("clampPanelWidth", () => {
  it("never goes below the width the five tab names need", () => {
    expect(PANEL_MIN).toBe(400);
    expect(clampPanelWidth(100, 1920)).toBe(400);
  });

  it("leaves the Plan view a third of the window, with no fixed cap", () => {
    expect(clampPanelWidth(5000, 1800)).toBe(1200);
    expect(clampPanelWidth(900, 1920)).toBe(900);
  });

  it("keeps the minimum on a narrow window", () => {
    expect(clampPanelWidth(500, 500)).toBe(400);
  });

  it("falls back to the default for nonsense", () => {
    expect(clampPanelWidth(NaN, 1920)).toBe(PANEL_DEFAULT);
  });
});

describe("readPanelWidth", () => {
  it("ignores missing or unusable values", () => {
    expect(readPanelWidth(null)).toBeUndefined();
    expect(readPanelWidth("abc")).toBeUndefined();
    expect(readPanelWidth("0")).toBeUndefined();
    expect(readPanelWidth("512")).toBe(512);
  });
});
