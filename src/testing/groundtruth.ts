// The synthetic pairs and their ground truth (`npm run samples`, see
// scripts/make-sample-plans.mjs), for tests that run in Node.

import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { extractObjects } from "../engine/extract";
import type { Box, DrawnObject, TimeDirection } from "../compare/objects";

export interface GroundTruthPlan {
  file: string;
  pageMm: [number, number];
  headerMm: [number, number];
  bodyMm: [number, number];
  footerMm: [number, number];
  /** The axis zones the user would mark in step 2 (only some pairs). */
  axisZonesMm?: { time?: Box[]; location?: Box[]; rows?: Box[] };
}

export interface PlantedChange {
  id: string;
  what: string;
  differences: { kind: "Added" | "Removed"; plan: "old" | "new"; boxMm: Box }[];
  /** The Place it must come out as, with Wann, Wo and the amount as the list shows them. */
  place: ExpectedPlace & {
    /** A label set far from its shape without a leader, on a pair grouped by nearness: a Place of its own. */
    labelPlace?: ExpectedPlace;
  };
}

export interface ExpectedPlace {
  kind: string;
  kinds?: string[];
  name: string | null;
  nameFrom?: string;
  oldName?: string;
  note?: string;
  /** Its shape, when it is named by it. */
  shape?: string;
  wann?: string;
  wo?: string;
  um?: string;
}

export interface GroundTruthPair {
  name: string;
  timeDirection: TimeDirection;
  old: GroundTruthPlan;
  new: GroundTruthPlan;
  offsetMm: number;
  changes: PlantedChange[];
  controls: { id: string; what: string }[];
}

export function groundTruth(): GroundTruthPair[] {
  return (JSON.parse(readFileSync("samples/ground-truth.json", "utf8")) as { pairs: GroundTruthPair[] }).pairs;
}

export function pair(name: string): GroundTruthPair {
  const p = groundTruth().find((x) => x.name === name);
  if (!p) throw new Error(`no sample pair ${name}`);
  return p;
}

/** A sample Plan's drawn objects, extracted as the worker does it. */
export function objectsOf(file: string): DrawnObject[] {
  const doc = mupdf.Document.openDocument(readFileSync(file), "application/pdf");
  const page = doc.loadPage(0);
  try {
    return extractObjects(mupdf, page);
  } finally {
    page.destroy();
    doc.destroy();
  }
}
