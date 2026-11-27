import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./compareframe";
import { parseSettings, SETTINGS_LIMITS } from "./displaysettings";

describe("the remembered display settings", () => {
  it("falls back to the defaults for nothing or for rubbish", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("nope")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps good values and ignores bad ones one by one", () => {
    const s = parseSettings({ base: "both", marks: false, fade: 60, outline: "x", removed: "soft", xSize: 100, rings: false, extra: 1 });
    expect(s).toEqual({ ...DEFAULT_SETTINGS, base: "both", marks: false, fade: 60, removed: "soft", xSize: 100, rings: false });
  });

  it("holds the sliders inside their ranges", () => {
    const s = parseSettings({ outline: 999, fade: -5, xSize: 1 });
    expect(s.outline).toBe(SETTINGS_LIMITS.outline.max);
    expect(s.fade).toBe(SETTINGS_LIMITS.fade.min);
    expect(s.xSize).toBe(SETTINGS_LIMITS.xSize.min);
  });

  it("rejects an unknown base Plan", () => {
    expect(parseSettings({ base: "middle" }).base).toBe(DEFAULT_SETTINGS.base);
  });
});
