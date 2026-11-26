// The rules that make Places (ADR 0005, 0006, 0008), on small hand-made Plans: time runs
// down, both Bodies are 0–500 mm, no Offset.
import { describe, expect, it } from "vitest";
import { compare, type ComparisonSetup } from "./compare";
import type { DrawnObject } from "./objects";
import { findPlaces } from "./places";
import { area, BLACK, BLUE, hatch, line, rect, RED, text, WHITE } from "../testing/drawn";

const setup: ComparisonSetup = { axis: "y", offset: 0, old: { body: [0, 500], ignored: [] }, new: { body: [0, 500], ignored: [] } };
const places = (oldObjs: DrawnObject[], newObjs: DrawnObject[]) => {
  const comparison = compare(oldObjs, newObjs, setup);
  return { comparison, places: findPlaces({ old: oldObjs, new: newObjs, setup, comparison }) };
};

interface Act {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  colour?: string;
  label?: string;
  /** Where the label stands: beside the shape's right edge at this y, or (with labelX) there. */
  labelY?: number;
  labelX?: number;
  labelColour?: string;
  /** Drawn the Plan software's way (a white underlay under the hatch), or not. */
  inOneGo?: boolean;
}
/** An Activity drawn in one go: white underlay, hatch, outline, then label background, text and leader. */
function activity(a: Act): DrawnObject[] {
  const colour = a.colour ?? RED,
    pts = rect(a.x0, a.y0, a.x1, a.y1);
  const out: DrawnObject[] = [];
  if (a.inOneGo !== false) out.push(area(pts, WHITE));
  out.push(hatch(pts, colour), line(pts, { colour, closed: true }));
  if (a.label) {
    const ly = a.labelY ?? a.y0 + 4,
      lx = a.labelX ?? a.x1 + 3;
    out.push(area(rect(lx - 0.3, ly - 2.3, lx + a.label.length * 1.5 + 0.3, ly + 0.8), WHITE));
    out.push(...text(a.label, lx, ly, { colour: a.labelColour ?? colour }));
    out.push(line(lx > a.x1 ? [a.x1, ly - 1, lx - 0.3, ly - 1] : [lx + a.label.length * 1.5 + 0.3, ly - 1, a.x0, ly - 1], { colour, width: 0.12 }));
  }
  return out;
}

describe("Places from the drawing order", () => {
  it("keeps two Activities that touch corner to corner apart: each is drawn in one go", () => {
    const a = activity({ x0: 100, y0: 100, x1: 120, y1: 150, label: "Gleis 1 erneuern" }),
      b = activity({ x0: 120, y0: 150, x1: 140, y1: 200, label: "Gleis 2 erneuern" });
    const r = places([...a, ...b], []);
    expect(r.places.map((p) => [p.kind, p.name])).toEqual([
      ["gone", "Gleis 1 erneuern"],
      ["gone", "Gleis 2 erneuern"],
    ]);
  });

  it("groups by nearness when no Activity is drawn in one go (no white underlay)", () => {
    const a = activity({ x0: 100, y0: 100, x1: 120, y1: 150, inOneGo: false }),
      b = activity({ x0: 120, y0: 150, x1: 140, y1: 200, inOneGo: false });
    expect(places([...a, ...b], []).places).toHaveLength(1);
  });

  it("makes an Old and a New Activity one Place when matched objects link them", () => {
    // extended by 30 mm; its label at the start is unchanged
    const r = places(activity({ x0: 100, y0: 100, x1: 120, y1: 150, label: "Mast umbauen" }), activity({ x0: 100, y0: 100, x1: 120, y1: 180, label: "Mast umbauen" }));
    expect(r.places.map((p) => [p.kind, p.kinds, p.name, p.amount?.mm])).toEqual([["longer", ["longer"], "Mast umbauen", 30]]);
  });

  it("joins an Activity that only moved with the Activity it left: something moved", () => {
    const r = places(activity({ x0: 100, y0: 100, x1: 120, y1: 150, label: "Mast umbauen" }), activity({ x0: 100, y0: 130, x1: 120, y1: 180, label: "Mast umbauen" }));
    expect(r.places.map((p) => [p.kind, p.kinds, p.amount?.mm])).toEqual([["later", ["later", "labelMoved"], 30]]);
  });

  it("joins a km marker (black, with text, drawn in its own pass) to the Activity Place it lies on", () => {
    // a tick from the shape's edge, its text right before it
    const marker = (y: number) => [line([92, y, 100, y], { colour: BLACK, width: 0.15 }), ...text("km 12,4 + 70", 78.5, y + 0.7, { colour: BLACK, size: 1.8 })];
    const r = places(
      [...activity({ x0: 100, y0: 100, x1: 120, y1: 150, label: "Mast umbauen" }), ...marker(110)],
      [...activity({ x0: 100, y0: 130, x1: 120, y1: 180, label: "Mast umbauen" }), ...marker(140)],
    );
    expect(r.places).toHaveLength(1);
    expect(r.places[0]!.marks.filter((i) => r.comparison.marks[i]!.text === "12,4")).toHaveLength(2);
  });

  it("makes a free note over two lines one Place of its own, named by its whole text", () => {
    const note = [...text("Achtung: Sperrpause", 300, 300, { colour: BLACK }), ...text("beachten", 300, 302.8, { colour: BLACK })];
    const r = places(activity({ x0: 100, y0: 100, x1: 120, y1: 150, label: "Mast umbauen" }), [...activity({ x0: 100, y0: 100, x1: 120, y1: 150, label: "Mast umbauen" }), ...note]);
    expect(r.places.map((p) => [p.kind, p.name, p.nameFrom])).toEqual([["new", "Achtung: Sperrpause beachten", "text"]]);
  });

  it("calls a label that only moved (with its leader) Beschriftung verschoben, with no amount", () => {
    const r = places(
      activity({ x0: 100, y0: 100, x1: 120, y1: 150, label: "Weiche einbauen" }),
      activity({ x0: 100, y0: 100, x1: 120, y1: 150, label: "Weiche einbauen", labelX: 70, labelY: 120 }),
    );
    expect(r.places.map((p) => [p.kind, p.kinds, p.name, p.amount])).toEqual([["labelMoved", ["labelMoved"], "Weiche einbauen", null]]);
  });

  it("reads timing from the shape, never from the label: a shorter label with its leader is Text geändert", () => {
    const r = places(activity({ x0: 100, y0: 100, x1: 120, y1: 150, label: "Weiche einbauen alt" }), activity({ x0: 100, y0: 100, x1: 120, y1: 150, label: "Weiche einbauen" }));
    expect(r.places.map((p) => [p.kind, p.kinds])).toEqual([["textChanged", ["textChanged"]]]);
  });

  it("gives a Place every kind it has: a recoloured label beside a longer shape, each part its own kind", () => {
    const r = places(
      activity({ x0: 100, y0: 100, x1: 120, y1: 150, label: "Mast umbauen" }),
      activity({ x0: 100, y0: 100, x1: 120, y1: 180, label: "Mast umbauen", colour: BLUE }),
    );
    const p = r.places[0]!;
    expect([r.places.length, p.kind, p.kinds]).toEqual([1, "longer", ["longer", "recoloured"]]);
    const kindOf = (shape: string) => [...new Set(p.marks.map((i, k) => [r.comparison.marks[i]!, p.partKinds[k]] as const).filter(([m]) => m.shape === shape).map(([, k]) => k))];
    expect(kindOf("word")).toEqual(["recoloured"]);
    expect(kindOf("area")).toEqual(["longer"]);
  });

  it("calls a line drawn only thicker Strichstärke, and a recolour only Umgefärbt", () => {
    const thick = (w: number) => [area(rect(100, 100, 120, 150), WHITE), hatch(rect(100, 100, 120, 150)), line(rect(100, 100, 120, 150), { closed: true, width: w })];
    expect(places(thick(0.25), thick(0.4)).places.map((p) => p.kinds)).toEqual([["lineWidth"]]);
    const r = places(activity({ x0: 100, y0: 100, x1: 120, y1: 150, label: "Mast" }), activity({ x0: 100, y0: 100, x1: 120, y1: 150, label: "Mast", colour: BLUE }));
    expect(r.places.map((p) => p.kinds)).toEqual([["recoloured"]]);
  });
});
