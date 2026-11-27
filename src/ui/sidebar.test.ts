import { describe, expect, it } from "vitest";
import { clampPanelWidth, COMPARE_TABLE_W, defaultPanelWidth, PANEL_DEFAULT, PANEL_MIN, panelKindFor, readPanelWidth } from "./sidebar";

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

describe("two widths", () => {
  it("Vergleich has its own width, the other tabs share one", () => {
    expect(panelKindFor("open")).toBe("setup");
    expect(panelKindFor("old")).toBe("setup");
    expect(panelKindFor("new")).toBe("setup");
    expect(panelKindFor("offset")).toBe("setup");
    expect(panelKindFor("compare")).toBe("compare");
  });

  it("the setup default is the width the tab names need", () => {
    expect(defaultPanelWidth("setup", 1920)).toBe(400);
  });

  it("the Vergleich default is wide: 60 % of the window, at least what the table needs, at most two thirds", () => {
    expect(defaultPanelWidth("compare", 1920)).toBe(1152);
    expect(defaultPanelWidth("compare", 1280)).toBe(COMPARE_TABLE_W);
    expect(defaultPanelWidth("compare", 1000)).toBe(666);
    expect(defaultPanelWidth("compare", 600)).toBe(400);
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
