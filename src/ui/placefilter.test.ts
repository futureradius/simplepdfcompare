import { describe, expect, it } from "vitest";
import { place } from "../testing/place";
import { defaultFilter, filterIsDefault, kindCounts, markShown, parseDay, parseFilter, parseKm, placeShown, sameFilter, setAllKinds, setKind, setRange } from "./placefilter";

describe("the filter by kind of change", () => {
  it("lets every Place through by default", () => {
    expect(placeShown(defaultFilter(), place({}))).toBe(true);
    expect(filterIsDefault(defaultFilter())).toBe(true);
  });

  it("shows a Place when any of its kinds is checked (ADR 0008)", () => {
    const p = place({ kind: "new", kinds: ["new", "recoloured"], partKinds: ["new", "recoloured"] });
    const none = setAllKinds(defaultFilter(), false);
    expect(placeShown(setKind(none, "recoloured", true), p)).toBe(true);
    expect(placeShown(setKind(none, "later", true), p)).toBe(false);
    expect(placeShown(none, p)).toBe(false);
  });

  it("makes each mark follow its own kind, also inside a Place of another kind", () => {
    const p = place({ kind: "new", kinds: ["new", "recoloured"], marks: [4, 5, 6], partKinds: ["new", "recoloured", "new"] });
    const f = setKind(setAllKinds(defaultFilter(), false), "recoloured", true);
    expect([0, 1, 2].map((i) => markShown(f, p, i))).toEqual([false, true, false]);
  });

  it("counts the Places that have a kind anywhere, so the counts can add up to more than the total", () => {
    const places = [
      place({ no: 1, kind: "later", kinds: ["later", "recoloured"] }),
      place({ no: 2, kind: "recoloured", kinds: ["recoloured"] }),
      place({ no: 3, kind: "new", kinds: ["new"] }),
    ];
    const c = kindCounts(places);
    expect(c.later).toBe(1);
    expect(c.recoloured).toBe(2);
    expect(c.new).toBe(1);
    expect(c.gone).toBe(0);
    expect(Object.values(c).reduce((a, b) => a + b, 0)).toBeGreaterThan(places.length);
  });

  it("keeps only plain data, so a Vorlage can save and load it", () => {
    const f = setRange(setKind(defaultFilter(), "later", false), "where", [12.4, 14.5]);
    const again = parseFilter(JSON.parse(JSON.stringify(f)));
    expect(sameFilter(again, f)).toBe(true);
    expect(sameFilter(again, defaultFilter())).toBe(false);
  });

  it("reads a damaged filter as far as it can", () => {
    expect(sameFilter(parseFilter(null), defaultFilter())).toBe(true);
    expect(sameFilter(parseFilter({ off: ["later", "nonsense"], when: "x", where: [1] }), setKind(defaultFilter(), "later", false))).toBe(true);
  });
});

describe("the Wann and Wo ranges", () => {
  const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86400000;
  const when = (a: number, b: number) => ({ from: a, to: b, point: false, mmPerDay: 1 });

  it("shows a Place whose km range overlaps the range, and none without km", () => {
    const f = setRange(defaultFilter(), "where", [12, 13]);
    expect(placeShown(f, place({ where: { from: 12.5, to: 14 } }))).toBe(true);
    expect(placeShown(f, place({ where: { from: 13.5, to: 14 } }))).toBe(false);
    expect(placeShown(f, place({ where: null }))).toBe(false);
  });

  it("shows a Place whose days overlap the range", () => {
    const f = setRange(defaultFilter(), "when", [day(2027, 3, 1), day(2027, 3, 10)]);
    expect(placeShown(f, place({ when: when(day(2027, 3, 8), day(2027, 3, 20)) }))).toBe(true);
    expect(placeShown(f, place({ when: when(day(2027, 4, 1), day(2027, 4, 2)) }))).toBe(false);
  });

  it("clears a range with null", () => {
    const f = setRange(setRange(defaultFilter(), "where", [1, 2]), "where", null);
    expect(filterIsDefault(f)).toBe(true);
  });

  it("reads km as typed", () => {
    expect(parseKm("12,4")).toBeCloseTo(12.4);
    expect(parseKm("12.4")).toBeCloseTo(12.4);
    expect(parseKm("km 14 + 500")).toBeCloseTo(14.5);
    expect(parseKm("abc")).toBeNull();
  });

  it("reads days as typed, with the Plan's year when there is none, and a closing day ends at its end", () => {
    const y = 2027;
    expect(parseDay("03.06.27", false, y)).toBe(day(2027, 6, 3));
    expect(parseDay("03.06.2027", false, y)).toBe(day(2027, 6, 3));
    expect(parseDay("03.06.", false, y)).toBe(day(2027, 6, 3));
    expect(parseDay("03.06.27", true, y)).toBe(day(2027, 6, 4));
    expect(parseDay("03.06.27 12:00", false, y)).toBeCloseTo(day(2027, 6, 3) + 0.5);
    expect(parseDay("nope", false, y)).toBeNull();
  });
});
