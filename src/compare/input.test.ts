// The comparison from the user's setup: Body from the Header and Footer lines, Ausgenommen
// boxes, axis zones and the confirmed Offset (ADR 0002), against the synthetic pairs.
import { describe, expect, it } from "vitest";
import { comparisonInput } from "./input";
import { compare } from "./compare";
import { findPlaces } from "./places";
import { axisOf, type Box } from "./objects";
import { newZone, type PlanZones } from "../zones/model";
import { objectsOf, pair } from "../testing/groundtruth";

const zones = (header: number, footer: number, ...z: ReturnType<typeof newZone>[]): PlanZones => ({ header, footer, zones: z });

describe("the comparison input from the setup", () => {
  const page = { width: 1189, height: 13710 };

  it("takes the Body from the Header and Footer lines of each Plan", () => {
    const r = comparisonInput("y", 560, { page, zones: zones(150, 13450) }, { page: { width: 1189, height: 13990 }, zones: zones(150, 13730) });
    expect(r.setup).toMatchObject({ axis: "y", offset: 560, old: { body: [150, 13450] }, new: { body: [150, 13730] } });
  });

  it("takes only the Ausgenommen zones as ignored, each Plan its own", () => {
    const area = newZone(1, "area", { x0: 10, y0: 200, x1: 50, y1: 300 });
    const time = newZone(2, "time", { x0: 0, y0: 100, x1: 20, y1: 400 });
    const r = comparisonInput("y", 0, { page, zones: zones(100, 13000, area, time) }, { page, zones: zones(100, 13000) });
    expect(r.setup.old.ignored).toEqual([area.box]);
    expect(r.setup.new.ignored).toEqual([]);
  });

  it("stretches a full-length Ausgenommen zone over the whole Plan along the Time direction", () => {
    const side = { ...newZone(1, "area", { x0: 0, y0: 500, x1: 30, y1: 600 }), full: true };
    const r = comparisonInput("y", 0, { page, zones: zones(100, 13000, side) }, { page, zones: zones(100, 13000) });
    expect(r.setup.old.ignored).toEqual([{ x0: 0, y0: 0, x1: 30, y1: 13710 }]);
    const right = comparisonInput("x", 0, { page: { width: 590, height: 210 }, zones: zones(10, 500, side) }, { page: { width: 590, height: 210 }, zones: zones(10, 500) });
    expect(right.setup.old.ignored).toEqual([{ x0: 0, y0: 500, x1: 590, y1: 600 }]);
  });

  it("hands the axis zones to the Places: Zeitachse, Wegachse and Vorgänge, each Plan its own", () => {
    const t = newZone(1, "time", { x0: 0, y0: 100, x1: 20, y1: 400 });
    const p = newZone(2, "path", { x0: 100, y0: 0, x1: 900, y1: 90 });
    const rows = newZone(3, "rows", { x0: 0, y0: 5, x1: 40, y1: 60 });
    const r = comparisonInput("y", 0, { page, zones: zones(100, 13000, t, p, rows) }, { page, zones: zones(100, 13000, t) });
    expect(r.axisZones.old).toEqual({ time: [t.box], location: [p.box], rows: [rows.box] });
    expect(r.axisZones.new).toEqual({ time: [t.box] });
  });

  it("gives no axis zones when none is marked", () => {
    const r = comparisonInput("y", 0, { page, zones: zones(100, 13000) }, { page, zones: zones(100, 13000) });
    expect(r.axisZones).toEqual({ old: {}, new: {} });
  });
});

describe("a comparison run with the user's zones, on the down pair", () => {
  const gt = pair("down");
  const oldObjs = objectsOf(gt.old.file),
    newObjs = objectsOf(gt.new.file);
  const axis = axisOf(gt.timeDirection);
  const pageOf = (p: typeof gt.old) => ({ width: p.pageMm[0], height: p.pageMm[1] });
  const input = (extra: ReturnType<typeof newZone>[], extraNew: ReturnType<typeof newZone>[] = []) =>
    comparisonInput(
      axis,
      gt.offsetMm,
      { page: pageOf(gt.old), zones: zones(gt.old.bodyMm[0], gt.old.bodyMm[1], ...extra) },
      { page: pageOf(gt.new), zones: zones(gt.new.bodyMm[0], gt.new.bodyMm[1], ...extraNew) },
    );
  const run = (extra: ReturnType<typeof newZone>[], extraNew: ReturnType<typeof newZone>[] = []) => compare(oldObjs, newObjs, input(extra, extraNew).setup);
  const d1 = gt.changes.find((c) => c.id === "D1")!;
  const o = d1.differences.find((d) => d.plan === "old")!.boxMm;
  const n = d1.differences.find((d) => d.plan === "new")!.boxMm;
  const around = (b: Box, id: number) => newZone(id, "area", { x0: b.x0 - 5, y0: b.y0 - 5, x1: b.x1 + 5, y1: b.y1 + 5 });
  const inOldFrame = (b: Box): Box => ({ ...b, y0: b.y0 + gt.offsetMm, y1: b.y1 + gt.offsetMm });
  /** The marks of the planted change D1: those whose middle lies in its box, in the Old frame. */
  const d1Marks = (c: ReturnType<typeof run>, plan: "old" | "new") =>
    c.marks.filter((m) => {
      const z = plan === "old" ? o : inOldFrame(n);
      const x = (m.box.x0 + m.box.x1) / 2,
        y = (m.box.y0 + m.box.y1) / 2;
      return m.plan === plan && x >= z.x0 - 5 && x <= z.x1 + 5 && y >= z.y0 - 5 && y <= z.y1 + 5;
    });
  const plain = run([]);

  it("shows the planted change with no Ausgenommen box", () => {
    expect(d1Marks(plain, "old").length).toBeGreaterThan(0);
    expect(d1Marks(plain, "new").length).toBeGreaterThan(0);
  });

  it("loses the Difference when an Ausgenommen box lies over it in both Plans", () => {
    // The same band in both Plans: over D1's Removed and Added part in the Old frame, moved back by the Offset for the New Plan.
    const band = { x0: Math.min(o.x0, n.x0), x1: Math.max(o.x1, n.x1), y0: Math.min(o.y0, n.y0 + gt.offsetMm), y1: Math.max(o.y1, n.y1 + gt.offsetMm) };
    const c = run([around(band, 1)], [around({ ...band, y0: band.y0 - gt.offsetMm, y1: band.y1 - gt.offsetMm }, 1)]);
    expect(d1Marks(c, "old")).toEqual([]);
    expect(d1Marks(c, "new")).toEqual([]);
    expect(c.marks.length).toBeLessThan(plain.marks.length);
  });

  it("shows the other Plan's part when only one Plan leaves the box out (its twin is then unmatched)", () => {
    const c = run([around(o, 1)]);
    expect(d1Marks(c, "old")).toEqual([]);
    expect(c.marks.length).toBeGreaterThan(plain.marks.length);
  });

  it("forms the Places with those marks and the axis zones", () => {
    const { setup, axisZones } = input([]);
    expect(findPlaces({ old: oldObjs, new: newObjs, setup, comparison: plain, axisZones }).length).toBeGreaterThan(0);
  });
}, 60_000);
