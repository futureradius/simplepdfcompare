// How Wann, Wo and the amount read in the list (ADR 0006).
import { describe, expect, it } from "vitest";
import { kindText, umText, wannText, wasText, woText } from "./wording";

const day = (iso: string) => Date.parse(`${iso}Z`) / 86400000;

describe("Wann", () => {
  it("is a date range from the first to the last day covered", () => {
    expect(wannText({ from: day("2027-06-03T00:00"), to: day("2027-07-13T00:00"), point: false, mmPerDay: 10 })).toBe("03.06.–12.07.27");
  });
  it("shows both years when the range crosses a year", () => {
    expect(wannText({ from: day("2027-12-30T00:00"), to: day("2028-01-03T00:00"), point: false, mmPerDay: 10 })).toBe("30.12.27–02.01.28");
  });
  it("is one day when the range covers one", () => {
    expect(wannText({ from: day("2027-06-03T00:00"), to: day("2027-06-04T00:00"), point: false, mmPerDay: 10 })).toBe("am 03.06.27");
  });
  it("shows the times when a start or an end is not on a day boundary", () => {
    expect(wannText({ from: day("2027-06-03T22:00"), to: day("2027-06-04T05:00"), point: false, mmPerDay: 120 })).toBe("03.06. 22:00 – 04.06.27 05:00");
    expect(wannText({ from: day("2027-06-03T08:00"), to: day("2027-06-03T14:00"), point: false, mmPerDay: 120 })).toBe("03.06.27, 08:00–14:00");
  });
  it("counts anything within 0.6 mm of a day boundary as on it (line widths)", () => {
    // 0.5 mm at 10 mm per day is 1.2 hours
    expect(wannText({ from: day("2027-06-03T00:00") - 0.05, to: day("2027-06-05T00:00") + 0.05, point: false, mmPerDay: 10 })).toBe("03.06.–04.06.27");
  });
  it("is one date for a milestone", () => {
    expect(wannText({ from: day("2027-05-17T00:00") - 0.1, to: day("2027-05-17T00:00") + 0.1, point: true, mmPerDay: 10 })).toBe("am 17.05.27");
  });
  it("is empty without a time axis", () => {
    expect(wannText(null)).toBeNull();
  });
});

describe("Wo", () => {
  it("is a km range, one decimal", () => {
    expect(woText({ from: 12.41, to: 15.63 })).toBe("km 12,4–15,6");
  });
  it("is one km when the range is shorter than 50 m", () => {
    expect(woText({ from: 26.01, to: 26.04 })).toBe("km 26,0");
  });
  it("is empty without a km axis", () => {
    expect(woText(null)).toBeNull();
  });
});

describe("Was and Art", () => {
  const place = { name: "Gleis 1 erneuern", shape: "Linie", when: null, where: null };
  it("names a Place by its name, cut at 40 characters", () => {
    expect(wasText(place)).toBe("Gleis 1 erneuern");
    expect(wasText({ ...place, name: "Gleis 1 und 2 erneuern, danach Weichen prüfen und abnehmen" })).toBe("Gleis 1 und 2 erneuern, danach Weichen…");
  });
  it("names a Place without a name by its shape and where it lies", () => {
    expect(wasText({ ...place, name: null, where: { from: 12.2, to: 17.5 }, when: { from: day("2027-06-03T00:00"), to: day("2027-07-13T00:00"), point: false, mmPerDay: 10 } })).toBe(
      "Linie km 12,2–17,5, 03.06.–12.07.27",
    );
  });
  it("says each kind in German", () => {
    expect(["later", "movedAcross", "labelMoved", "lineWidth", "new", "gone"].map((k) => kindText(k as never))).toEqual(["Später", "Quer verschoben", "Beschriftung verschoben", "Strichstärke", "Neu", "Entfallen"]);
  });
});

describe("the amount (Um)", () => {
  it("is in days and hours once the time axis is read", () => {
    expect(umText({ along: true, mm: 30, days: 3, km: null })).toBe("3 Tage");
    expect(umText({ along: true, mm: 10, days: 1, km: null })).toBe("1 Tag");
    expect(umText({ along: true, mm: 160, days: 4 / 3, km: null })).toBe("1 Tag 8 Std.");
    expect(umText({ along: true, mm: 35, days: 7 / 24, km: null })).toBe("7 Std.");
    expect(umText({ along: true, mm: 3, days: 0.5 / 24, km: null })).toBe("30 Min.");
  });
  it("is in km or m across once the km axis is read", () => {
    expect(umText({ along: false, mm: 18.3, days: null, km: 0.5 })).toBe("500 m");
    expect(umText({ along: false, mm: 50, days: null, km: 1.25 })).toBe("1,3 km");
  });
  it("is in mm without the axis", () => {
    expect(umText({ along: true, mm: -4.25, days: null, km: null })).toBe("4,3 mm");
    expect(umText({ along: false, mm: 18.3, days: null, km: null })).toBe("18 mm");
  });
  it("is empty for a Place with no amount (a moved label has none)", () => {
    expect(umText(null)).toBeNull();
  });
});
