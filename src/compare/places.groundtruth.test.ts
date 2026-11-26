// Places on the synthetic pairs (ADR 0005, 0006, 0008): every planted change comes out as
// the expected Place with the expected main kind and other kinds, the controls make no
// Place, and the name, Wann, Wo and amount are what the ground truth says.
//
// The "activities" pair draws its Activities in one go, as the Plan software does, so its
// Places come from the drawing order. The "down" and "right" pairs do not, so theirs come
// from nearness; there a line Activity's label set far off without a leader is a Place of
// its own (the ground truth's labelPlace).
import { describe, expect, it } from "vitest";
import { compare } from "./compare";
import { axisOf, boxesTouch, type Box } from "./objects";
import { findPlaces, type Place } from "./places";
import { umText, wannText, woText } from "./wording";
import { objectsOf, pair, type ExpectedPlace, type GroundTruthPair } from "../testing/groundtruth";

const inOldFrame = (b: Box, gt: GroundTruthPair): Box => {
  const d = gt.offsetMm;
  return gt.timeDirection === "down" ? { ...b, y0: b.y0 + d, y1: b.y1 + d } : { ...b, x0: b.x0 + d, x1: b.x1 + d };
};

/** What a Place says, in the terms of the ground truth (only what the ground truth gives). */
function said(p: Place | undefined, want: ExpectedPlace) {
  if (!p) return null;
  const out: Record<string, unknown> = { kind: p.kind, name: p.name };
  if (want.kinds) out.kinds = p.kinds;
  if (want.nameFrom) out.nameFrom = p.nameFrom;
  if (want.oldName) out.oldName = p.oldName;
  if (want.note) out.note = p.note;
  if (want.shape) out.shape = p.shape;
  if (want.wann) out.wann = wannText(p.when);
  if (want.wo) out.wo = woText(p.where);
  out.um = umText(p.amount);
  return out;
}
const wanted = (want: ExpectedPlace) => {
  const { kind, kinds, name, nameFrom, oldName, note, shape, wann, wo, um } = want;
  return Object.fromEntries(Object.entries({ kind, name, kinds, nameFrom, oldName, note, shape, wann, wo, um: um ?? null }).filter(([, v]) => v !== undefined));
};

describe("Places of the synthetic pairs", () => {
  for (const name of ["activities", "down", "right"]) {
    const gt = pair(name);
    const oldObjs = objectsOf(gt.old.file),
      newObjs = objectsOf(gt.new.file);
    const setup = {
      axis: axisOf(gt.timeDirection),
      offset: gt.offsetMm,
      old: { body: gt.old.bodyMm, ignored: [] },
      new: { body: gt.new.bodyMm, ignored: [] },
    };
    const comparison = compare(oldObjs, newObjs, setup);
    const places = findPlaces({
      old: oldObjs,
      new: newObjs,
      setup,
      comparison,
      axisZones: { old: gt.old.axisZonesMm, new: gt.new.axisZonesMm },
    });
    /** The Places that hold a part of the planted change, its own Place first. */
    const placesOf = (id: string): Place[] => {
      const c = gt.changes.find((x) => x.id === id)!;
      const boxes = c.differences.map((d) => (d.plan === "new" ? inOldFrame(d.boxMm, gt) : d.boxMm));
      // a mark of the Place has its middle in a box of the change (touching corners do not count)
      const inside = (m: Box) => boxes.some((b) => boxesTouch({ x0: (m.x0 + m.x1) / 2, y0: (m.y0 + m.y1) / 2, x1: (m.x0 + m.x1) / 2, y1: (m.y0 + m.y1) / 2 }, b, 0.5));
      const hits = places.filter((p) => p.marks.some((i) => inside(comparison.marks[i]!.box)));
      const onlyText = (p: Place) => Number(p.marks.every((i) => comparison.marks[i]!.shape === "word"));
      return c.place.labelPlace ? hits.sort((a, b) => onlyText(a) - onlyText(b)) : hits;
    };

    it(`${name}: every planted change is the expected Place (and its own label's), and the controls make none`, () => {
      expect(gt.changes.map((c) => `${c.id}: ${placesOf(c.id).length}`)).toEqual(gt.changes.map((c) => `${c.id}: ${c.place.labelPlace ? 2 : 1}`));
      expect(places.length).toBe(gt.changes.reduce((n, c) => n + (c.place.labelPlace ? 2 : 1), 0));
    });

    it(`${name}: each Place has the expected kinds, name, Wann, Wo and amount`, () => {
      expect(gt.changes.map((c) => ({ id: c.id, ...said(placesOf(c.id)[0], c.place) }))).toEqual(gt.changes.map((c) => ({ id: c.id, ...wanted(c.place) })));
    });

    it(`${name}: a label set apart is named by its own text and has no amount`, () => {
      const apart = gt.changes.filter((c) => c.place.labelPlace);
      expect(apart.map((c) => ({ id: c.id, ...said(placesOf(c.id)[1], c.place.labelPlace!) }))).toEqual(apart.map((c) => ({ id: c.id, ...wanted(c.place.labelPlace!) })));
    });
  }
});
