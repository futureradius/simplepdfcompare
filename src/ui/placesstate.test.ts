import { describe, expect, it } from "vitest";
import type { Place } from "../compare/places";
import { place } from "../testing/place";
import { defaultFilter, setKind } from "./placefilter";
import { PlacesState } from "./placesstate";

const box = (i: number) => ({ x0: i * 100, y0: i * 100, x1: i * 100 + 10, y1: i * 100 + 10 });
const make = (): Place[] => [
  place({ no: 1, kind: "later", kinds: ["later"], marks: [0, 1], partKinds: ["later", "later"], box: box(1), name: "c" }),
  place({ no: 2, kind: "new", kinds: ["new", "recoloured"], marks: [2, 3], partKinds: ["new", "recoloured"], box: box(2), name: "a" }),
  place({ no: 3, kind: "gone", kinds: ["gone"], marks: [4], partKinds: ["gone"], box: box(3), name: "b" }),
  place({ no: 4, kind: "later", kinds: ["later"], marks: [5], partKinds: ["later"], box: box(4), name: "d" }),
];
const state = (token: unknown = 1) => {
  const s = new PlacesState();
  s.setResult(make(), token);
  return s;
};
const nos = (s: PlacesState) => s.listed.map((p) => p.no);

describe("the list of Places", () => {
  it("lists every Place in the order of their numbers at first", () => {
    expect(nos(state())).toEqual([1, 2, 3, 4]);
  });

  it("follows the filter and tells the view which marks show", () => {
    const s = state();
    s.setFilter(setKind(defaultFilter(), "later", false));
    expect(nos(s)).toEqual([2, 3]);
    expect(s.shown().place!(1)).toBe(false);
    s.setFilter(setKind(setKind(defaultFilter(), "new", false), "gone", false));
    // Place 2 stays because it has "recoloured" too, but only its recoloured mark shows.
    expect(nos(s)).toEqual([1, 2, 4]);
    expect([2, 3].map((i) => s.shown().mark!(i))).toEqual([false, true]);
  });

  it("follows the sort, and stepping follows it too", () => {
    const s = state();
    s.sortBy("name");
    expect(nos(s)).toEqual([2, 3, 1, 4]);
    s.select(2, {}, { reveal: false });
    expect(s.step(1)!.no).toBe(3);
    expect(s.step(1)!.no).toBe(1);
  });

  it("tells its listener what changed", () => {
    const s = state();
    const got: string[] = [];
    s.onChange = (c) => got.push(c);
    s.setFilter(setKind(defaultFilter(), "gone", false));
    s.sortBy("no");
    s.select(1, {}, { reveal: false });
    expect(got).toContain("filter");
    expect(got).toContain("sort");
    expect(got).toContain("selection");
  });
});

describe("selecting", () => {
  it("moves the Plan only when the list asks for it", () => {
    const s = state();
    const revealed: number[] = [];
    s.reveal = (p) => revealed.push(p.no);
    s.select(2, {}, { reveal: true });
    s.select(3, {}, { reveal: false });
    expect(revealed).toEqual([2]);
    expect(s.selection.nos()).toEqual([3]);
  });

  it("toggles with Ctrl and takes a range with Shift in the order of the list", () => {
    const s = state();
    s.sortBy("name"); // 2, 3, 1, 4
    s.select(3, {}, { reveal: false });
    s.select(4, { shift: true }, { reveal: false });
    expect(s.selection.nos().sort()).toEqual([1, 3, 4]);
    s.select(2, { ctrl: true }, { reveal: false });
    expect(s.selection.nos().sort()).toEqual([1, 2, 3, 4]);
    s.select(1, { ctrl: true }, { reveal: false });
    expect(s.selection.nos().sort()).toEqual([2, 3, 4]);
  });

  it("does not move the Plan for a Ctrl or Shift click in the list", () => {
    const s = state();
    let n = 0;
    s.reveal = () => n++;
    s.select(1, { ctrl: true }, { reveal: true });
    s.select(3, { shift: true }, { reveal: true });
    expect(n).toBe(0);
  });

  it("takes boxes from the Plan: replace, add, remove", () => {
    const s = state();
    s.selectMany([1, 2], "replace");
    s.selectMany([3], "add");
    s.selectMany([1], "remove");
    expect(s.selection.nos().sort()).toEqual([2, 3]);
    s.selectMany([], "replace");
    expect(s.selection.size).toBe(0);
  });

  it("drops from the selection what the filter takes away", () => {
    const s = state();
    s.selectMany([1, 2, 3], "replace");
    s.setFilter(setKind(defaultFilter(), "later", false));
    expect(s.selection.nos().sort()).toEqual([2, 3]);
  });

  it("starts with nothing selected for a new result", () => {
    const s = state();
    s.selectMany([1], "replace");
    s.setResult(make(), 1);
    expect(s.selection.size).toBe(0);
  });
});

describe("hiding", () => {
  it("hides the selection, leaves nothing selected and does not reveal anything", () => {
    const s = state();
    let n = 0;
    s.reveal = () => n++;
    s.selectMany([2, 3], "replace");
    s.hideSelection();
    expect(nos(s)).toEqual([1, 4]);
    expect(s.selection.size).toBe(0);
    expect(s.hiddenCount).toBe(2);
    expect(n).toBe(0);
    expect(s.shown().place!(2)).toBe(false);
  });

  it("goes on stepping from where the hidden Places were", () => {
    const s = state();
    s.select(2, {}, { reveal: false });
    s.hideSelection();
    expect(s.step(1)!.no).toBe(3);
    const t = state();
    t.select(2, {}, { reveal: false });
    t.hideSelection();
    expect(t.step(-1)!.no).toBe(1);
  });

  it("lists the hidden Places too when asked, and shows one again", () => {
    const s = state();
    s.selectMany([2], "replace");
    s.hideSelection();
    expect(s.rows().map((r) => r.place.no)).toEqual([1, 3, 4]);
    s.showHidden = true;
    expect(s.rows().map((r) => [r.place.no, r.hidden])).toEqual([[1, false], [2, true], [3, false], [4, false]]);
    s.unhide([2]);
    expect(nos(s)).toEqual([1, 2, 3, 4]);
    expect(s.hiddenCount).toBe(0);
    expect(s.showHidden).toBe(false);
  });

  it("keeps the hidden Places when the comparison runs again for the same pair", () => {
    const s = state(1);
    s.selectMany([3], "replace");
    s.hideSelection();
    const again = make().map((p) => ({ ...p, no: p.no + 10 }));
    s.setResult(again, 1);
    expect(s.listed.map((p) => p.no)).toEqual([11, 12, 14]);
  });

  it("forgets them for another pair", () => {
    const s = state(1);
    s.selectMany([3], "replace");
    s.hideSelection();
    s.setResult(make(), 2);
    expect(nos(s)).toEqual([1, 2, 3, 4]);
  });
});

describe("stepping", () => {
  it("steps round the list as it is shown and selects the Place it reaches", () => {
    const s = state();
    s.setFilter(setKind(defaultFilter(), "gone", false));
    const revealed: number[] = [];
    s.reveal = (p) => revealed.push(p.no);
    expect(s.step(1)!.no).toBe(1);
    expect(s.step(1)!.no).toBe(2);
    expect(s.step(1)!.no).toBe(4);
    expect(s.step(1)!.no).toBe(1);
    expect(s.step(-1)!.no).toBe(4);
    expect(revealed).toEqual([1, 2, 4, 1, 4]);
    expect(s.selection.nos()).toEqual([4]);
  });

  it("does nothing when no Place is listed", () => {
    const s = new PlacesState();
    s.setResult([], 1);
    expect(s.step(1)).toBeNull();
  });
});

describe("the rows for the export", () => {
  it("are the rows as shown: filtered, sorted, in the column order, hidden left out", () => {
    const s = state();
    s.sortBy("name");
    s.moveColumn("name", "no", "before");
    s.selectMany([3], "replace");
    s.hideSelection();
    s.setFilter(setKind(defaultFilter(), "later", false));
    const t = s.table();
    expect(t.columns[0]).toBe("name");
    expect(t.rows.map((r) => r.no)).toEqual([2]);
    expect(t.rows[0]!.cells[0]).toBe("a");
  });
});
