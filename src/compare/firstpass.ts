// The first thin pass through the whole comparison (slice "match objects and show the first
// Differences"): until the setup tabs exist, the Header and Footer are the guessed ones, no
// area is ignored and the best Offset candidate is taken. Runs in the Old Plan's worker.

import { guessBody } from "./body";
import { compare, type Comparison, type ComparisonSetup } from "./compare";
import { axisOf, type DrawnObject, type TimeDirection } from "./objects";
import { findOffset, type OffsetResult } from "./offset";
import { findPlaces, type Place } from "./places";

export interface PlanObjects {
  objects: readonly DrawnObject[];
  /** The page's width and height, mm. */
  pageMm: readonly [number, number];
}

export interface FirstPassInput {
  timeDirection: TimeDirection;
  old: PlanObjects;
  new: PlanObjects;
}

export interface FirstPass {
  timeDirection: TimeDirection;
  offset: OffsetResult;
  setup: ComparisonSetup;
  comparison: Comparison;
  /** The Places, formed as the comparison is shown. */
  places: Place[];
  ms: { offset: number; compare: number; places: number };
}

export function firstPass(input: FirstPassInput): FirstPass {
  const axis = axisOf(input.timeDirection);
  const old = { body: guessBody(input.old.objects, input.old.pageMm, axis), ignored: [] };
  const nu = { body: guessBody(input.new.objects, input.new.pageMm, axis), ignored: [] };
  let t = performance.now();
  const offset = findOffset(input.old.objects, input.new.objects, { axis, bodyOld: old.body, bodyNew: nu.body });
  const offsetMs = performance.now() - t;
  const setup: ComparisonSetup = { axis, offset: offset.offset, old, new: nu };
  t = performance.now();
  const comparison = compare(input.old.objects, input.new.objects, setup);
  const compareMs = performance.now() - t;
  t = performance.now();
  const places = findPlaces({ old: input.old.objects, new: input.new.objects, setup, comparison });
  return { timeDirection: input.timeDirection, offset, setup, comparison, places, ms: { offset: offsetMs, compare: compareMs, places: performance.now() - t } };
}
