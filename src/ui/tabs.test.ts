import { describe, expect, it } from "vitest";
import { confirmTab, initialReach, isTabEnabled, lockAfterOpen, signatureChanged, TABS, type OpenSignature } from "./tabs";

describe("tab rules", () => {
  it("lists the five tabs in order", () => {
    expect(TABS).toEqual(["open", "old", "new", "offset", "compare"]);
  });

  it("starts with only Öffnen reachable", () => {
    const reach = initialReach();
    expect(TABS.map((t) => isTabEnabled(t, reach))).toEqual([true, false, false, false, false]);
  });

  it("confirming a tab unlocks the next one only", () => {
    const reach = confirmTab(initialReach(), "open");
    expect(TABS.map((t) => isTabEnabled(t, reach))).toEqual([true, true, false, false, false]);
  });

  it("confirming an earlier tab again locks nothing", () => {
    let reach = initialReach();
    for (const t of TABS.slice(0, 3)) reach = confirmTab(reach, t);
    expect(TABS.map((t) => isTabEnabled(t, reach))).toEqual([true, true, true, true, false]);
    expect(confirmTab(reach, "open")).toBe(reach);
    expect(confirmTab(reach, "old")).toBe(reach);
  });

  it("the last tab has nothing after it to unlock", () => {
    expect(confirmTab(4, "compare")).toBe(4);
    expect(isTabEnabled("compare", 4)).toBe(true);
  });

  it("a change in Öffnen locks every later tab again", () => {
    const locked = lockAfterOpen(confirmTab(confirmTab(confirmTab(0, "open"), "old"), "new"));
    expect(TABS.map((t) => isTabEnabled(t, locked))).toEqual([true, false, false, false, false]);
  });
});

describe("signatureChanged", () => {
  const base: OpenSignature = { old: { file: "a.pdf", page: 0 }, new: { file: "b.pdf", page: 0 }, direction: "down" };
  it("is false for the same state", () => {
    expect(signatureChanged(base, { ...base, old: { file: "a.pdf", page: 0 } })).toBe(false);
  });
  it("is true for another file, page, order or direction", () => {
    expect(signatureChanged(base, { ...base, new: { file: "c.pdf", page: 0 } })).toBe(true);
    expect(signatureChanged(base, { ...base, old: { file: "a.pdf", page: 1 } })).toBe(true);
    expect(signatureChanged(base, { ...base, old: base.new, new: base.old })).toBe(true);
    expect(signatureChanged(base, { ...base, direction: "right" })).toBe(true);
  });
});
