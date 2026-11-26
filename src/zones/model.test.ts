import { describe, expect, it } from "vitest";
import { bandBoxes, copyToNewPlan, dragZone, effectiveBox, hitTest, isClick, newZone, toggleFull, zoneLabel, type PlanZones } from "./model";

const page = { width: 1000, height: 14000 };
const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

describe("hitTest", () => {
  const b = box(100, 200, 300, 400);
  it("finds edges, corners, inside and outside", () => {
    expect(hitTest(b, { x: 100, y: 300 }, 5)).toBe("w");
    expect(hitTest(b, { x: 300, y: 200 }, 5)).toBe("ne");
    expect(hitTest(b, { x: 200, y: 300 }, 5)).toBe("move");
    expect(hitTest(b, { x: 50, y: 300 }, 5)).toBe("new");
  });
});

describe("dragZone", () => {
  const b = box(100, 200, 300, 400);
  it("moves inside the Plan and stops at its edge", () => {
    expect(dragZone(b, "move", { x: 0, y: 0 }, { x: 50, y: 20 }, page, "y")).toEqual(box(150, 220, 350, 420));
    expect(dragZone(b, "move", { x: 0, y: 0 }, { x: -500, y: 0 }, page, "y")).toEqual(box(0, 200, 200, 400));
  });
  it("resizes one edge and flips when dragged past the opposite one", () => {
    expect(dragZone(b, "e", { x: 300, y: 0 }, { x: 350, y: 0 }, page, "y")).toEqual(box(100, 200, 350, 400));
    expect(dragZone(b, "e", { x: 300, y: 0 }, { x: 50, y: 0 }, page, "y")).toEqual(box(50, 200, 100, 400));
  });
  it("draws a new zone from the press to the pointer, kept on the Plan", () => {
    expect(dragZone(b, "new", { x: 10, y: 10 }, { x: 60, y: -30 }, page, "y")).toEqual(box(10, 0, 60, 10));
  });
});

describe("full-length zones (the ⇕ bubble)", () => {
  const z = newZone(1, "area", box(100, 500, 200, 800));
  it("stretch over the whole length along the Time direction and back", () => {
    const full = toggleFull(z);
    expect(effectiveBox(full, "y", page)).toEqual(box(100, 0, 200, 14000));
    expect(effectiveBox(full, "x", page)).toEqual(box(0, 500, 1000, 800));
    expect(effectiveBox(toggleFull(full), "y", page)).toEqual(box(100, 500, 200, 800));
  });
  it("keep their remembered length when dragged across", () => {
    const full = toggleFull(z);
    const moved = dragZone(effectiveBox(full, "y", page), "move", { x: 0, y: 0 }, { x: 30, y: 400 }, page, "y", box(100, 500, 200, 800));
    expect(moved).toEqual(box(130, 500, 230, 800));
  });
});

describe("zoneLabel", () => {
  const zs = [newZone(5, "area", box(0, 0, 1, 1)), newZone(6, "time", box(0, 0, 1, 1)), newZone(9, "area", box(0, 0, 1, 1))];
  it("numbers the Bereiche in order and names an axis zone by its kind", () => {
    expect(zs.map((z) => zoneLabel(zs, z))).toEqual(["Bereich 1", "Zeitachse", "Bereich 2"]);
  });
});

describe("the 4 px click rule", () => {
  it("a press that moves less than 4 px is a click", () => {
    expect(isClick({ x: 10, y: 10 }, { x: 12, y: 12 })).toBe(true);
    expect(isClick({ x: 10, y: 10 }, { x: 14, y: 10 })).toBe(false);
  });
});

describe("Header and Footer as bands", () => {
  it("run from the Plan's edge to their line along the Time direction", () => {
    const pz: PlanZones = { header: 150, footer: 13450, zones: [] };
    const [h, f] = bandBoxes(pz, "y", page);
    expect(h).toEqual(box(0, 0, 1000, 150));
    expect(f).toEqual(box(0, 13450, 1000, 14000));
    const [hx] = bandBoxes({ header: 80, footer: 900, zones: [] }, "x", { width: 1000, height: 300 });
    expect(hx).toEqual(box(0, 0, 80, 300));
  });
  it("are empty when the line sits on the edge (zone deleted)", () => {
    const [h, f] = bandBoxes({ header: 0, footer: 14000, zones: [] }, "y", page);
    expect(h).toBeUndefined();
    expect(f).toBeUndefined();
  });
});

describe("copyToNewPlan", () => {
  const old: PlanZones = { header: 150, footer: 13450, zones: [newZone(7, "area", box(10, 300, 90, 900)), toggleFull(newZone(8, "time", box(100, 0, 150, 10)))] };
  it("keeps the Header height and the Footer's distance from the end, others at the same place", () => {
    const n = copyToNewPlan(old, 13710, { width: 1000, height: 13990 }, "y");
    expect(n.header).toBe(150);
    expect(n.footer).toBe(13990 - 260);
    expect(n.zones.map((z) => z.box)).toEqual(old.zones.map((z) => z.box));
    expect(n.zones[1]!.full).toBe(true);
    expect(n.zones.map((z) => z.kind)).toEqual(["area", "time"]);
  });
  it("cuts a zone that lies beyond a shorter Plan", () => {
    const n = copyToNewPlan(old, 13710, { width: 1000, height: 500 }, "y");
    expect(n.zones[0]!.box).toEqual(box(10, 300, 90, 500));
    expect(n.footer).toBeGreaterThanOrEqual(n.header);
  });
});
