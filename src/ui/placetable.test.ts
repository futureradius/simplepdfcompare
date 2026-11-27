import { describe, expect, it } from "vitest";
import { place } from "../testing/place";
import { defaultFilter, setKind, setRange } from "./placefilter";
import { cellText, columnOrder, COLUMN_IDS, listPlaces, listRows, moveColumn, sortBy, sortPlaces, type SortKey } from "./placetable";

const when = (from: number) => ({ from, to: from + 3, point: false, mmPerDay: 1 });

describe("sorting the list", () => {
  const ps = [
    place({ no: 1, name: "Gleis b", kind: "later", when: when(30), where: { from: 12, to: 13 }, amount: { along: true, mm: 3, days: 3, km: null } }),
    place({ no: 2, name: "Gleis a", kind: "new", when: when(10), where: null, amount: { along: true, mm: 9, days: 9, km: null } }),
    place({ no: 3, name: "weg", kind: "later", when: when(20), where: { from: 11, to: 12 }, amount: null }),
  ];
  const nos = (l: readonly { no: number }[]) => l.map((p) => p.no);

  it("keeps the numbers' order without a sort", () => {
    expect(nos(sortPlaces(ps, []))).toEqual([1, 2, 3]);
  });

  it("sorts by a column, with empty cells always last", () => {
    expect(nos(sortPlaces(ps, [{ key: "name", dir: 1 }]))).toEqual([2, 1, 3]);
    expect(nos(sortPlaces(ps, [{ key: "where", dir: 1 }]))).toEqual([3, 1, 2]);
    expect(nos(sortPlaces(ps, [{ key: "where", dir: -1 }]))).toEqual([1, 3, 2]);
    expect(nos(sortPlaces(ps, [{ key: "when", dir: 1 }]))).toEqual([2, 3, 1]);
  });

  it("sorts the Um column with the largest first", () => {
    const keys = sortBy([], "amount");
    expect(keys).toEqual([{ key: "amount", dir: -1 }]);
    expect(nos(sortPlaces(ps, keys))).toEqual([2, 1, 3]);
  });

  it("sorts by kind in the order of the filter list, then keeps the earlier sort inside it, as in Excel", () => {
    let keys: SortKey[] = sortBy([], "when");
    keys = sortBy(keys, "kind");
    expect(keys.map((k) => k.key)).toEqual(["kind", "when"]);
    expect(nos(sortPlaces(ps, keys))).toEqual([3, 1, 2]);
  });

  it("turns the main key round when it is clicked again, and keeps four keys at most", () => {
    let keys = sortBy([], "no");
    keys = sortBy(keys, "no");
    expect(keys).toEqual([{ key: "no", dir: -1 }]);
    for (const k of ["name", "kind", "amount", "when", "where"] as const) keys = sortBy(keys, k);
    expect(keys.map((k) => k.key)).toEqual(["where", "when", "amount", "kind"]);
  });

  it("sorts names without caring for case, and numbers within them", () => {
    const l = [place({ no: 1, name: "b 10" }), place({ no: 2, name: "B 9" }), place({ no: 3, name: "a" })];
    expect(nos(sortPlaces(l, [{ key: "name", dir: 1 }]))).toEqual([3, 2, 1]);
  });
});

describe("the columns", () => {
  it("starts in the default order", () => {
    expect(columnOrder(undefined)).toEqual(COLUMN_IDS);
  });

  it("starts with the small picture, then the columns of text", () => {
    expect(COLUMN_IDS).toEqual(["thumb", "no", "name", "kind", "amount", "when", "where"]);
  });

  it("repairs a saved order: unknown columns go, a missing one comes back after the column it followed originally", () => {
    expect(columnOrder(["where", "bogus", "no", "where"])).toEqual(["thumb", "where", "no", "name", "kind", "amount", "when"]);
    expect(columnOrder(["thumb", "where", "no"])).toEqual(["thumb", "where", "no", "name", "kind", "amount", "when"]);
    expect(columnOrder(["no", "name", "kind", "amount", "when", "where"])).toEqual(COLUMN_IDS); // saved before the picture could move
    expect(columnOrder("x")).toEqual(COLUMN_IDS);
  });

  it("moves any column before or after another, the picture too", () => {
    expect(moveColumn(COLUMN_IDS, "where", "no", "before")).toEqual(["thumb", "where", "no", "name", "kind", "amount", "when"]);
    expect(moveColumn(COLUMN_IDS, "no", "when", "after")).toEqual(["thumb", "name", "kind", "amount", "when", "no", "where"]);
    expect(moveColumn(COLUMN_IDS, "thumb", "where", "after")).toEqual(["no", "name", "kind", "amount", "when", "where", "thumb"]);
    expect(moveColumn(COLUMN_IDS, "no", "no", "after")).toEqual(COLUMN_IDS);
  });

  it("leaves the picture out of the table for the export", () => {
    const t = listRows([place({ no: 1, name: "a" })], { filter: defaultFilter(), sort: [], isHidden: () => false, columns: ["name", "thumb", "no"] });
    expect(t.columns).toEqual(["name", "no"]);
    expect(t.rows[0]!.cells).toEqual(["a", "1"]);
  });
});

describe("the cells", () => {
  it("says the kind, then the others", () => {
    expect(cellText(place({ kind: "later", kinds: ["later", "recoloured"] }), "kind")).toBe("Später, Umgefärbt");
  });
  it("names a Place by its name, else its shape", () => {
    expect(cellText(place({ name: "Gleis 1 erneuern" }), "name")).toBe("Gleis 1 erneuern");
    expect(cellText(place({ name: null, shape: "Schraffur" }), "name")).toContain("Schraffur");
  });
  it("leaves an empty cell empty", () => {
    expect(cellText(place({ when: null }), "when")).toBe("");
    expect(cellText(place({ where: null }), "where")).toBe("");
    expect(cellText(place({ amount: null }), "amount")).toBe("");
  });
});

describe("the rows as shown", () => {
  const ps = [
    place({ no: 1, kind: "later", kinds: ["later"], where: { from: 12, to: 13 } }),
    place({ no: 2, kind: "new", kinds: ["new"], where: { from: 20, to: 21 } }),
    place({ no: 3, kind: "gone", kinds: ["gone"], where: { from: 12.5, to: 13 } }),
  ];
  const hidden = (p: { no: number }) => p.no === 3;

  it("leaves out what the filter and hiding take away", () => {
    const f = setKind(defaultFilter(), "new", false);
    expect(listPlaces(ps, { filter: f, sort: [], isHidden: hidden }).map((p) => p.no)).toEqual([1]);
    expect(listPlaces(ps, { filter: setRange(defaultFilter(), "where", [12, 13]), sort: [], isHidden: () => false }).map((p) => p.no)).toEqual([1, 3]);
  });

  it("gives the rows in the sort order and the column order, for the export", () => {
    const t = listRows(ps, { filter: defaultFilter(), sort: [{ key: "kind", dir: -1 }], isHidden: hidden, columns: ["kind", "no"] });
    expect(t.columns).toEqual(["kind", "no"]);
    expect(t.rows.map((r) => r.cells)).toEqual([["Neu", "2"], ["Später", "1"]]);
  });

  it("can include the hidden ones, marked", () => {
    const t = listRows(ps, { filter: defaultFilter(), sort: [], isHidden: hidden }, { withHidden: true });
    expect(t.rows.map((r) => [r.no, r.hidden])).toEqual([[1, false], [2, false], [3, true]]);
  });
});
