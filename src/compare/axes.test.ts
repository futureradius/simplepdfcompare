// Reading a Plan's axes (ADR 0006): dates and hours along time, km across, from its own labels.
// Time runs down here; the Body starts at 100 mm.
import { describe, expect, it } from "vitest";
import { dayAt, kmAt, readAxes } from "./axes";
import type { DrawnObject } from "./objects";
import { line, text } from "../testing/drawn";

const day = (iso: string) => Date.parse(`${iso}Z`) / 86400000;
const BODY: [number, number] = [100, 2000];
const dmy = (d: number) => {
  const x = new Date(d * 86400000);
  return `${String(x.getUTCDate()).padStart(2, "0")}.${String(x.getUTCMonth() + 1).padStart(2, "0")}.${String(x.getUTCFullYear()).slice(2)}`;
};

/** Day lines across the Body every `mmPerDay` from 100 mm, a date label `labelAfter` mm after each. */
function dateColumn(first: number, days: number, mmPerDay: number, labelAfter: number): DrawnObject[] {
  const out: DrawnObject[] = [];
  for (let d = 0; d < days; d++) {
    const y = 100 + d * mmPerDay;
    out.push(line([0, y, 600, y]), ...text(`Mo ${dmy(first + d)}`, 2, y + labelAfter));
  }
  return out;
}

describe("the time axis", () => {
  it("reads the dates from the date labels, each standing for the day line at or before it", () => {
    const objs = dateColumn(day("2027-01-04T00:00"), 12, 10, 4);
    const ax = readAxes(objs, { axis: "y", body: BODY });
    expect(dayAt(ax, 100)).toBeCloseTo(day("2027-01-04T00:00"), 3);
    expect(dayAt(ax, 155)).toBeCloseTo(day("2027-01-09T12:00"), 3);
  });

  it("joins KW labels without a year to the dates", () => {
    const objs: DrawnObject[] = [];
    for (let w = 0; w < 8; w++) {
      const y = 100 + w * 70;
      objs.push(line([0, y, 600, y]), ...text(`KW ${String(1 + w).padStart(2, "0")}`, 2, y + 4));
      if (w % 2 === 0) objs.push(...text(dmy(day("2027-01-04T00:00") + 7 * w), 20, y + 4));
    }
    const ax = readAxes(objs, { axis: "y", body: BODY });
    expect(dayAt(ax, 100 + 5 * 70)).toBeCloseTo(day("2027-02-08T00:00"), 3);
  });

  it("reads the time of day from hour labels in a Zeitachse zone", () => {
    // 72 mm per day, a grid line every 3 hours; the date labels stand 11 mm after their day
    // line, so by themselves they stand for the 3-hour line before them (3 hours off). The
    // hour labels ("3", "6" ... "24") stand just above their line.
    const objs = dateColumn(day("2027-03-15T00:00"), 6, 72, 11);
    for (let h = 3; h < 6 * 24; h += 3) {
      const y = 100 + h * 3;
      if (h % 24) objs.push(line([0, y, 600, y], { width: 0.1 }));
      objs.push(...text(String(h % 24 || 24), 52, y - 0.5, { size: 2 }));
    }
    const zones = { time: [{ x0: 0, y0: 100, x1: 40, y1: 2000 }, { x0: 50, y0: 100, x1: 58, y1: 2000 }] };
    expect(dayAt(readAxes(objs, { axis: "y", body: BODY }), 100)).toBeCloseTo(day("2027-03-14T21:00"), 3);
    const ax = readAxes(objs, { axis: "y", body: BODY, zones });
    expect(dayAt(ax, 100)).toBeCloseTo(day("2027-03-15T00:00"), 3);
    expect(dayAt(ax, 100 + 72 + 21 * 3)).toBeCloseTo(day("2027-03-16T21:00"), 3);
  });

  it("does not read hours outside a Zeitachse zone (a time written by a bar is no axis)", () => {
    const objs = [...dateColumn(day("2027-03-15T00:00"), 6, 72, 0), ...text("17:30", 300, 160)];
    const ax = readAxes(objs, { axis: "y", body: BODY });
    expect(ax.hours).toBeNull();
  });
});

describe("the km axis", () => {
  it("reads km from plain numbers in the Header, on a straight line", () => {
    const objs: DrawnObject[] = [];
    for (let k = 10; k <= 20; k++) objs.push(...text(`${k},0`, 50 + (k - 10) * 40 - 3, 90));
    const ax = readAxes(objs, { axis: "y", body: BODY });
    expect(kmAt(ax, 50 + 2.5 * 40)).toBeCloseTo(12.5, 2);
  });

  it("reads km inside upright Header labels, piece by piece where the scale changes", () => {
    // 50 mm per km on open track, 200 mm per km in the station (km 12–13)
    const x = (km: number) => (km <= 12 ? 60 + (km - 10) * 50 : km <= 13 ? 160 + (km - 12) * 200 : 360 + (km - 13) * 50);
    const objs: DrawnObject[] = [];
    for (const km of [10, 10.5, 11, 11.5, 12, 12.25, 12.5, 12.75, 13, 13.5, 14, 14.5, 15, 15.5, 16]) {
      const a = Math.floor(km * 10 + 1e-9) / 10,
        m = Math.round((km - a) * 1000);
      // the letters' middle across lies on the mark
      objs.push(...text(`Bf Adorf km ${String(a.toFixed(1)).replace(".", ",")} + ${m}`, x(km) + 0.3 * 2.5, 95, { up: true }));
    }
    const ax = readAxes(objs, { axis: "y", body: BODY });
    expect(kmAt(ax, x(11.2))).toBeCloseTo(11.2, 2);
    expect(kmAt(ax, x(12.6))).toBeCloseTo(12.6, 2);
    expect(kmAt(ax, x(14.8))).toBeCloseTo(14.8, 2);
  });

  it("reads any number in a Wegachse zone as a km", () => {
    const objs: DrawnObject[] = [];
    for (let k = 0; k <= 8; k++) objs.push(...text(`${100 + k}`, 50 + k * 30 - 2, 60));
    const ax = readAxes(objs, { axis: "y", body: BODY, zones: { location: [{ x0: 0, y0: 50, x1: 600, y1: 70 }] } });
    expect(kmAt(ax, 50 + 4.5 * 30 + 1.6)).toBeCloseTo(104.5, 1);
  });
});
