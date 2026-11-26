// Comparing the synthetic pairs (ADR 0001): every planted change is found, no control is
// reported, and the Offset found is the ground truth's.
import { describe, expect, it } from "vitest";
import { compare, type Mark } from "./compare";
import { firstPass } from "./firstpass";
import { guessTimeDirection } from "./body";
import { axisOf, boxesTouch, type Box } from "./objects";
import { objectsOf, pair, type GroundTruthPair } from "../testing/groundtruth";

/** A ground-truth box of the New Plan, moved into the Old Plan's frame. */
function inOldFrame(b: Box, gt: GroundTruthPair): Box {
  const d = gt.offsetMm;
  return gt.timeDirection === "down" ? { ...b, y0: b.y0 + d, y1: b.y1 + d } : { ...b, x0: b.x0 + d, x1: b.x1 + d };
}

/**
 * The parts each planted change must produce. A label whose word was replaced is marked
 * Added only, on the new word (GLOSSARY: Added, Removed): the ground truth's Removed part
 * of such a change is not expected.
 */
function expectedParts(gt: GroundTruthPair) {
  return gt.changes.flatMap((c) =>
    c.differences
      .filter((d) => !(/text changed/.test(c.what) && d.kind === "Removed"))
      .map((d) => ({ id: c.id, kind: d.kind, box: d.plan === "new" ? inOldFrame(d.boxMm, gt) : d.boxMm })),
  );
}

function check(gt: GroundTruthPair, marks: Mark[]) {
  const missing = expectedParts(gt)
    .filter((p) => !marks.some((m) => m.kind === p.kind && boxesTouch(m.box, p.box, 0.5)))
    .map((p) => `${p.id} ${p.kind}`);
  const all = gt.changes.flatMap((c) => c.differences.map((d) => (d.plan === "new" ? inOldFrame(d.boxMm, gt) : d.boxMm)));
  const falseAlarms = marks.filter((m) => !all.some((b) => boxesTouch(m.box, b, 1)));
  return { missing, falseAlarms };
}

describe("comparing the synthetic pairs", () => {
  for (const name of ["down", "right"]) {
    const gt = pair(name);
    const axis = axisOf(gt.timeDirection);
    const oldObjs = objectsOf(gt.old.file),
      newObjs = objectsOf(gt.new.file);

    it(`${name}: finds every planted change and reports no control, with the ground-truth setup`, () => {
      const r = compare(oldObjs, newObjs, {
        axis,
        offset: gt.offsetMm,
        old: { body: gt.old.bodyMm, ignored: [] },
        new: { body: gt.new.bodyMm, ignored: [] },
      });
      const { missing, falseAlarms } = check(gt, r.marks);
      expect(missing).toEqual([]);
      expect(falseAlarms).toEqual([]);
    });

    it(`${name}: does the same in a first pass, with the default Header and Footer and the Offset found`, () => {
      const r = firstPass({
        timeDirection: guessTimeDirection(gt.old.pageMm),
        old: { objects: oldObjs, pageMm: gt.old.pageMm },
        new: { objects: newObjs, pageMm: gt.new.pageMm },
      });
      expect(r.timeDirection).toBe(gt.timeDirection);
      expect(r.offset.offset).toBeCloseTo(gt.offsetMm, 2);
      expect(r.setup.old.body[0]).toBeCloseTo(gt.old.bodyMm[0], 2);
      expect(r.setup.new.body[1]).toBeCloseTo(gt.new.bodyMm[1], 2);
      const { missing, falseAlarms } = check(gt, r.comparison.marks);
      expect(missing).toEqual([]);
      expect(falseAlarms).toEqual([]);
    });
  }
});
