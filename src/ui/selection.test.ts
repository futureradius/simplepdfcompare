import { describe, expect, it } from "vitest";
import { place } from "../testing/place";
import { HiddenPlaces, placeKey } from "./hiddenplaces";
import { Selection } from "./selection";
import { cursorAfterHide, step } from "./stepping";

describe("the selection, one set shared by the list and the Plan", () => {
  it("starts empty and selects one Place", () => {
    const s = new Selection();
    expect(s.size).toBe(0);
    s.only(3);
    expect(s.nos()).toEqual([3]);
    s.only(5);
    expect(s.nos()).toEqual([5]);
  });

  it("toggles with Ctrl and removes", () => {
    const s = new Selection();
    s.only(1);
    s.toggle(2);
    s.toggle(1);
    expect(s.nos()).toEqual([2]);
    s.add([4, 5]);
    s.remove([5, 2]);
    expect(s.nos()).toEqual([4]);
  });

  it("selects a range from the last click, as Explorer does", () => {
    const order = [10, 11, 12, 13, 14];
    const s = new Selection();
    s.only(11);
    s.range(order, 13, false);
    expect(s.nos().sort()).toEqual([11, 12, 13]);
    s.range(order, 10, false); // the range keeps its start
    expect(s.nos().sort()).toEqual([10, 11]);
  });

  it("adds a range with Ctrl + Shift", () => {
    const order = [10, 11, 12, 13, 14];
    const s = new Selection();
    s.only(10);
    s.toggle(14);
    s.range(order, 12, true);
    expect(s.nos().sort()).toEqual([10, 12, 13, 14]);
  });

  it("selects a range from the first Place when nothing was clicked yet", () => {
    const s = new Selection();
    s.range([1, 2, 3], 2, false);
    expect(s.nos().sort()).toEqual([1, 2]);
  });

  it("replaces, and clears", () => {
    const s = new Selection();
    s.replace([1, 2]);
    s.replace([3]);
    expect(s.nos()).toEqual([3]);
    s.clear();
    expect(s.size).toBe(0);
  });

  it("drops what is no longer shown", () => {
    const s = new Selection();
    s.replace([1, 2, 3]);
    s.prune((n) => n !== 2);
    expect(s.nos().sort()).toEqual([1, 3]);
  });

  it("tells the listener when it changes, and only then", () => {
    const s = new Selection();
    let n = 0;
    s.onChange = () => n++;
    s.only(1);
    s.only(1);
    s.clear();
    s.clear();
    expect(n).toBe(2);
  });
});

describe("hiding Places", () => {
  it("hides and shows again, keeping the hidden by kind and position", () => {
    const h = new HiddenPlaces();
    const a = place({ no: 1, kind: "later", box: { x0: 10.2, y0: 20, x1: 30, y1: 40 } });
    h.hide([a]);
    expect(h.has(a)).toBe(true);
    // The comparison ran again: the same Place has another number.
    expect(h.has({ ...a, no: 9, box: { x0: 10.4, y0: 20.1, x1: 29.8, y1: 40 } })).toBe(true);
    expect(h.has(place({ kind: "new", box: a.box }))).toBe(false);
    h.show([a]);
    expect(h.has(a)).toBe(false);
  });

  it("counts the hidden among the Places there are now", () => {
    const h = new HiddenPlaces();
    const ps = [place({ no: 1 }), place({ no: 2, box: { x0: 50, y0: 50, x1: 60, y1: 60 } })];
    h.hide([ps[1]!, place({ kind: "gone", box: { x0: 999, y0: 999, x1: 1000, y1: 1000 } })]);
    expect(h.count(ps)).toBe(1);
    h.clear();
    expect(h.count(ps)).toBe(0);
  });

  it("makes the key of a kind and a rounded box", () => {
    expect(placeKey(place({ kind: "gone", box: { x0: 1.2, y0: 2.4, x1: 3.6, y1: 4.5 } }))).toBe("gone|1,2,4,5");
  });
});

describe("stepping with the arrows", () => {
  const order = [5, 6, 7, 8];
  it("goes to the next and the previous Place, round the ends", () => {
    expect(step(order, { no: 6 }, 1)).toBe(7);
    expect(step(order, { no: 6 }, -1)).toBe(5);
    expect(step(order, { no: 8 }, 1)).toBe(5);
    expect(step(order, { no: 5 }, -1)).toBe(8);
  });

  it("starts at the first or the last Place when nothing is selected", () => {
    expect(step(order, null, 1)).toBe(5);
    expect(step(order, null, -1)).toBe(8);
    expect(step(order, { no: 99 }, 1)).toBe(5);
  });

  it("does nothing in an empty list", () => {
    expect(step([], null, 1)).toBeNull();
  });

  it("goes on from where a hidden Place was", () => {
    // 6 and 7 hidden: the list is 5, 8 and the cursor lies between them.
    const c = cursorAfterHide([5, 6, 7, 8], new Set([6, 7]));
    expect(step([5, 8], c, 1)).toBe(8);
    expect(step([5, 8], c, -1)).toBe(5);
  });

  it("goes on from the end when the last Places were hidden", () => {
    const c = cursorAfterHide([5, 6, 7], new Set([7]));
    expect(step([5, 6], c, 1)).toBe(5);
    expect(step([5, 6], c, -1)).toBe(6);
  });
});
