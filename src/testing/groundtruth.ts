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
}

export interface PlantedChange {
  id: string;
  what: string;
  differences: { kind: "Added" | "Removed"; plan: "old" | "new"; boxMm: Box }[];
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
