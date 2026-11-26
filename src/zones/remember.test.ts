import { describe, expect, it } from "vitest";
import { newZone, toggleFull, type PlanZones } from "./model";
import { applyRemembered, parseRemembered, toRemembered } from "./remember";

const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
const setup: PlanZones = { header: 150, footer: 13450, zones: [newZone(1, "area", box(10, 400, 90, 900)), toggleFull(newZone(2, "time", box(100, 160, 150, 300)))] };

describe("remembering the setup for the next pair (ADR 0002)", () => {
  it("keeps the Header height, the Footer's distance from the end and zones relative to the Header line", () => {
    const r = toRemembered(setup, "y", 13710);
    expect(r.header).toBe(150);
    expect(r.footerFromEnd).toBe(260);
    expect(r.zones[0]).toMatchObject({ kind: "area", a0: 10, a1: 90, t0: 250, t1: 750, full: false });
  });

  it("puts it on a Plan of another length with the same distances", () => {
    const r = toRemembered(setup, "y", 13710);
    const s = applyRemembered(r, "y", { width: 1189, height: 13990 }, () => 0)!;
    expect(s.header).toBe(150);
    expect(s.footer).toBe(13990 - 260);
    expect(s.zones[0]!.box).toEqual(box(10, 400, 90, 900));
    expect(s.zones[1]!.full).toBe(true);
  });

  it("is not used for the other Time direction", () => {
    expect(applyRemembered(toRemembered(setup, "y", 13710), "x", { width: 700, height: 300 }, () => 0)).toBeUndefined();
  });

  it("survives a round trip through the stored text and ignores garbage", () => {
    const r = toRemembered(setup, "y", 13710);
    expect(parseRemembered(JSON.stringify(r))).toEqual(r);
    expect(parseRemembered("{oops")).toBeUndefined();
    expect(parseRemembered(null)).toBeUndefined();
    expect(parseRemembered(JSON.stringify({ axis: "y", header: "x" }))).toBeUndefined();
  });
});
