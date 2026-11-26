import { describe, expect, it } from "vitest";
import { applySetup, readSetupList, sameSetup, setupFromJson, setupToJson, setupOf, type SetupVorlage } from "./vorlagen";
import type { PlanZones } from "./model";

const pz: PlanZones = {
  header: 40,
  footer: 1100,
  zones: [
    { id: 1, kind: "area", full: true, box: { x0: 10, x1: 60, y0: 100, y1: 500 } },
    { id: 2, kind: "time", full: false, box: { x0: 0, x1: 30, y0: 50, y1: 900 } },
  ],
};

describe("what a setup Vorlage holds", () => {
  it("keeps the lines and zones, as distances from the Header line, and no Time direction", () => {
    const v = setupOf(pz, "y", 1200);
    expect(v).toEqual({
      header: 40,
      footerFromEnd: 100,
      zones: [
        { kind: "area", full: true, a0: 10, a1: 60, t0: 60, t1: 460 },
        { kind: "time", full: false, a0: 0, a1: 30, t0: 10, t1: 860 },
      ],
    });
    expect("axis" in v).toBe(false);
  });

  it("applies in either direction: the same distances, nothing stretched", () => {
    const v = setupOf(pz, "y", 1200);
    // A longer Plan: the Header stays 40 mm, the zones keep their distance from it, the Footer its distance from the end.
    const longer = applySetup(v, "y", { width: 800, height: 1500 }, () => 0);
    expect(longer.header).toBe(40);
    expect(longer.footer).toBe(1400);
    expect(longer.zones[0]!.box).toEqual({ x0: 10, x1: 60, y0: 100, y1: 500 });
    // Time runs to the right: across and along swap, still the same mm.
    const wide = applySetup(v, "x", { width: 1500, height: 800 }, () => 0);
    expect(wide.zones[0]!.box).toEqual({ y0: 10, y1: 60, x0: 100, x1: 500 });
    expect(wide.footer).toBe(1400);
  });
  it("numbers the zones' ids through the callback", () => {
    let n = 10;
    const out = applySetup(setupOf(pz, "y", 1200), "y", { width: 800, height: 1200 }, () => n++);
    expect(out.zones.map((z) => z.id)).toEqual([10, 11]);
  });
});

describe("same setup", () => {
  const a = setupOf(pz, "y", 1200);
  it("ignores ids and sub-0.1 mm noise, sees a moved line or zone, kind or order", () => {
    expect(sameSetup(a, setupOf({ ...pz, header: 40.04 }, "y", 1200))).toBe(true);
    expect(sameSetup(a, setupOf({ ...pz, header: 41 }, "y", 1200))).toBe(false);
    expect(sameSetup(a, setupOf({ ...pz, footer: 1099 }, "y", 1200))).toBe(false);
    expect(sameSetup(a, setupOf({ ...pz, zones: [pz.zones[0]!] }, "y", 1200))).toBe(false);
    expect(sameSetup(a, setupOf({ ...pz, zones: [...pz.zones].reverse() }, "y", 1200))).toBe(false);
    expect(sameSetup(a, setupOf({ ...pz, zones: [{ ...pz.zones[0]!, kind: "path" }, pz.zones[1]!] }, "y", 1200))).toBe(false);
  });
});

describe("file format", () => {
  const v = setupOf(pz, "y", 1200);
  it("round-trips", () => {
    const json = setupToJson([{ name: "Strecke A", setup: v }]);
    expect(JSON.parse(json).kind).toBe("simplepdfcompare-setup-vorlagen");
    expect(JSON.parse(json).version).toBe(1);
    expect(setupFromJson(json)).toEqual([{ name: "Strecke A", setup: v }]);
  });
  it("refuses what is not a setup file, with a German message", () => {
    expect(() => setupFromJson("nope")).toThrow(/JSON/);
    expect(() => setupFromJson(JSON.stringify({ kind: "simplepdfclipper-presets", presets: [] }))).toThrow(/Vorlagen-Datei/);
    expect(() => setupFromJson(JSON.stringify({ kind: "simplepdfcompare-filter-vorlagen", version: 1, presets: [] }))).toThrow(/Vorlagen-Datei/);
  });
  it("drops what is unusable and cleans the rest", () => {
    const list = readSetupList([
      null,
      { name: "  ", setup: v },
      { name: "no setup" },
      { name: "bad header", setup: { ...v, header: "x" } },
      { name: "negative", setup: { ...v, header: -5 } },
      { name: "  Gut  ", setup: { ...v, axis: "y", extra: 1, zones: [...v.zones, { kind: "bogus", a0: 0, a1: 1, t0: 0, t1: 1 }, { kind: "path", a0: 5, a1: 1, t0: 9, t1: 2 }, { kind: "area", a0: 1, a1: NaN, t0: 0, t1: 1 }] } },
    ]);
    expect(list.map((p) => p.name)).toEqual(["Gut"]);
    const s: SetupVorlage = list[0]!.setup;
    expect(Object.keys(s).sort()).toEqual(["footerFromEnd", "header", "zones"]);
    // the unknown kind and the broken numbers are gone; reversed corners are put in order; `full` defaults to false
    expect(s.zones).toEqual([...v.zones, { kind: "path", full: false, a0: 1, a1: 5, t0: 2, t1: 9 }]);
  });
  it("a stored list that is not a list gives none", () => {
    expect(readSetupList({})).toEqual([]);
  });
});
