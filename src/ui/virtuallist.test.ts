import { describe, expect, it } from "vitest";
import { place } from "../testing/place";
import { defaultFilter, setKind } from "./placefilter";
import { listPlaces } from "./placetable";
import { rowWindow, scrollToShow } from "./virtuallist";

describe("which rows of a long list are in the page", () => {
  it("builds only the rows in view and a few beside them", () => {
    const w = rowWindow({ scrollTop: 5000, viewH: 400, rowH: 50, count: 10_000, overscan: 4 });
    expect(w.first).toBe(96);
    expect(w.end).toBe(112);
    expect(w.total).toBe(500_000);
  });

  it("holds at the ends and in a short list", () => {
    expect(rowWindow({ scrollTop: 0, viewH: 400, rowH: 50, count: 3, overscan: 4 })).toMatchObject({ first: 0, end: 3, total: 150 });
    expect(rowWindow({ scrollTop: 10_000_000, viewH: 400, rowH: 50, count: 100, overscan: 4 }).end).toBe(100);
    expect(rowWindow({ scrollTop: 0, viewH: 400, rowH: 50, count: 0, overscan: 4 })).toMatchObject({ first: 0, end: 0, total: 0 });
  });

  it("scrolls only as far as needed to show a row, and not at all when it is in view", () => {
    expect(scrollToShow({ scrollTop: 0, viewH: 400, rowH: 50, index: 3 })).toBeNull();
    expect(scrollToShow({ scrollTop: 0, viewH: 400, rowH: 50, index: 20 })).toBe(20 * 50 + 50 - 400);
    expect(scrollToShow({ scrollTop: 2000, viewH: 400, rowH: 50, index: 10 })).toBe(500);
  });
});

describe("a long list of Places", () => {
  it("filters and sorts thousands of Places quickly", () => {
    const places = Array.from({ length: 5000 }, (_, i) =>
      place({ no: i + 1, name: `Aktivität ${(i * 7919) % 5000}`, kind: i % 3 ? "later" : "new", kinds: i % 3 ? ["later"] : ["new"], when: { from: i, to: i + 2, point: false, mmPerDay: 1 } }),
    );
    const t0 = performance.now();
    const l = listPlaces(places, { filter: setKind(defaultFilter(), "new", false), sort: [{ key: "name", dir: 1 }, { key: "when", dir: 1 }], isHidden: () => false });
    const ms = performance.now() - t0;
    expect(l.length).toBeGreaterThan(3000);
    expect(ms).toBeLessThan(500);
  });
});
