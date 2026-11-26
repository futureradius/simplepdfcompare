// The comparison's rules (ADR 0001, GLOSSARY: Difference, Added, Removed) on small
// hand-made Plans: time runs down, the Body is 0–200 mm, the New Plan is shifted by 10 mm.
import { describe, expect, it } from "vitest";
import { compare, type ComparisonSetup } from "./compare";
import type { DrawnObject, GlyphObject } from "./objects";

const BLACK = "0.000,0.000,0.000",
  RED = "1.000,0.000,0.000";

const line = (x0: number, y0: number, x1: number, y1: number, { colour = BLACK, width = 0.25 } = {}): DrawnObject => ({
  kind: "stroke",
  style: `stroke|${colour}|d0|0|1.00`,
  nums: [width],
  polys: [{ pts: [x0, y0, x1, y1], closed: false }],
  clip: null,
  halfWidth: width / 2,
});

const area = (x0: number, y0: number, x1: number, y1: number, colour = BLACK): DrawnObject => ({
  kind: "fill",
  style: `fill|${colour}|0|1.00`,
  nums: [],
  polys: [{ pts: [x0, y0, x1, y0, x1, y1, x0, y1], closed: true }],
  clip: null,
});

let spanNo = 0;
/** A label line: 2 mm per letter, at (x, y). */
function label(text: string, x: number, y: number, colour = BLACK): GlyphObject[] {
  const span = ++spanNo;
  return [...text].map((ch, index) => ({
    kind: "glyph",
    style: `glyph|${ch}|Helvetica|${colour}`,
    nums: [2.5],
    ch,
    origin: [x + 2 * index, y],
    box: { x0: x + 2 * index, y0: y - 2, x1: x + 2 * index + 2, y1: y + 0.5 },
    span,
    index,
    clip: null,
  }));
}

/** The New Plan's version of an object drawn `d` mm higher up (its Body starts 10 mm earlier). */
const up = <T extends DrawnObject>(o: T, d = 10): T =>
  o.kind === "glyph"
    ? { ...o, origin: [o.origin[0], o.origin[1] - d], box: { ...o.box, y0: o.box.y0 - d, y1: o.box.y1 - d } }
    : { ...o, polys: o.polys.map((p) => ({ ...p, pts: p.pts.map((v, i) => (i % 2 ? v - d : v)) })) };

const setup = (ignoredOld: ComparisonSetup["old"]["ignored"] = [], ignoredNew: ComparisonSetup["new"]["ignored"] = []): ComparisonSetup => ({
  axis: "y",
  offset: 10,
  old: { body: [20, 200], ignored: ignoredOld },
  new: { body: [10, 190], ignored: ignoredNew },
});

const summary = (r: ReturnType<typeof compare>) => r.marks.map((m) => `${m.kind} ${m.shape}${m.text ? ` ${m.text}` : ""}${m.restyled ? " restyled" : ""}`).sort();

describe("comparing two Plans", () => {
  it("reports nothing when the New Plan draws the same, shifted by the Offset", () => {
    const old = [line(10, 50, 60, 50), area(10, 60, 20, 70), ...label("Gleis 2 umbauen", 30, 80)];
    const r = compare(old, old.map((o) => up(o)), setup());
    expect(r.marks).toEqual([]);
    expect(r.counts).toMatchObject({ old: old.length, new: old.length, unchanged: old.length, added: 0, removed: 0 });
  });

  it("marks a line that moved as Removed where it was and Added where it is", () => {
    const r = compare([line(10, 50, 60, 50)], [up(line(10, 53, 60, 53))], setup());
    expect(summary(r)).toEqual(["Added line", "Removed line"]);
    expect(r.marks.find((m) => m.kind === "Added")!.coords).toEqual([10, 53, 60, 53]);
  });

  it("marks a recoloured or thicker line as Added only", () => {
    const r = compare([line(10, 50, 60, 50), line(10, 70, 60, 70)], [up(line(10, 50, 60, 50, { colour: RED })), up(line(10, 70, 60, 70, { width: 0.35 }))], setup());
    expect(summary(r)).toEqual(["Added line restyled", "Added line restyled"]);
  });

  it("finds no Difference in a line cut into other pieces", () => {
    const r = compare([line(10, 50, 60, 50)], [up(line(10, 50, 30, 50)), up(line(30, 50, 60, 50))], setup());
    expect(r.marks).toEqual([]);
  });

  it("marks changed text per word: a replaced word is Added, a deleted one Removed", () => {
    const r = compare(label("Gleis 2 umbauen alt", 30, 80), label("Gleis 2 erneuern", 30, 80).map((g) => up(g)), setup());
    expect(summary(r)).toEqual(["Added word erneuern", "Removed word alt"]);
  });

  it("marks a word that only lost letters as Removed", () => {
    const r = compare(label("Gleis 22", 30, 80), label("Gleis 2", 30, 80).map((g) => up(g)), setup());
    expect(summary(r)).toEqual(["Removed word 22"]);
  });

  it("marks a recoloured label as Added, word by word", () => {
    const r = compare(label("Gleis 2", 30, 80), label("Gleis 2", 30, 80, RED).map((g) => up(g)), setup());
    expect(summary(r)).toEqual(["Added word 2 restyled", "Added word Gleis restyled"]);
  });

  it("does not compare the Header, the Footer or the Overhang", () => {
    // The New Body (5–180) lies at 15–190 in the Old frame: the Old Plan's last 10 mm and
    // the New Plan's first 5 mm have no counterpart.
    const s: ComparisonSetup = { ...setup(), new: { body: [5, 180], ignored: [] } };
    const old = [line(10, 5, 60, 5), line(10, 195, 60, 195), line(10, 205, 60, 205)];
    const nu = [line(10, 2, 60, 2), line(10, 7, 60, 7), line(10, 185, 60, 185)];
    expect(compare(old, nu, s).marks).toEqual([]);
  });

  it("skips the Ignored areas, each in its own Plan's page", () => {
    const old = [line(10, 50, 20, 50), line(100, 50, 120, 50)];
    const nu = [up(line(10, 52, 20, 52)), up(line(100, 52, 120, 52))];
    const r = compare(old, nu, setup([{ x0: 0, y0: 20, x1: 30, y1: 200 }], [{ x0: 0, y0: 10, x1: 30, y1: 190 }]));
    expect(r.marks.map((m) => m.box.x0)).toEqual([100 - 0.125, 100 - 0.125]);
  });

  it("counts an object as ignored by the middle of its part that is compared", () => {
    // A long line starting in the Header: its compared part (y 20.5–60) lies in the Ignored area.
    const r = compare([line(10, 0, 10, 60)], [], setup([{ x0: 0, y0: 20, x1: 30, y1: 70 }]));
    expect(r.marks).toEqual([]);
  });
});
