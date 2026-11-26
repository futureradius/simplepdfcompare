// Engine core: everything that touches MuPDF. Runs inside the worker (one per Plan,
// ADR 0004), or on the main thread as a fallback when workers are unavailable from
// file:// (clipper ADR 0010).
//
// A file is opened in two steps (clipper ADR 0014): openDocument() loads it as a
// *candidate* (thumbnails of its pages can be drawn), openPage() makes one of its pages
// the Plan. Until then the previous Plan stays usable, so the page picker can be cancelled.
// Later slices add the display list, overview and bands to openPage().
//
// The Plan's drawn objects are extracted on first use (the comparison) and kept until
// another page becomes the Plan. The Old Plan's engine compares them with the New Plan's.

import type * as MuPDF from "mupdf";
import { firstPass as runFirstPass, type FirstPass, type PlanObjects } from "../compare/firstpass";
import { guessBody, linesAcross } from "../compare/body";
import type { Axis, TimeDirection } from "../compare/objects";
import { buildSegments, type Segments } from "../zones/snap";
import { extractObjects } from "./extract";
import type { DocumentInfo, PageBoxName, PlanInfo, Preview, RegionRequest, ThumbnailRequest } from "./protocol";

/** What the setup tabs need from a Plan's drawing, along the Time direction. */
export interface BodyHints {
  /** Where the Header ends and the Footer starts, as first guessed. */
  body: [number, number];
  /** Lines across half of the Plan or more: where the Header and Footer lines snap to. */
  across: number[];
}

const PT_TO_MM = 25.4 / 72;

let mupdf: typeof MuPDF | undefined;
/** The Document the Plan comes from. */
let current: MuPDF.Document | undefined;
/** A Document just opened, whose page has not been chosen yet. */
let candidate: MuPDF.Document | undefined;
/** The page of `current` that is the Plan. */
let planPage = -1;
/** The Plan's drawn objects, once extracted. */
let objects: PlanObjectsInfo | undefined;

export type PlanObjectsInfo = PlanObjects & { extractMs: number };

const BOXES: PageBoxName[] = ["MediaBox", "CropBox", "BleedBox", "TrimBox", "ArtBox"];

export async function init(wasmBinary: ArrayBuffer): Promise<void> {
  (globalThis as Record<string, unknown>)["$libmupdf_wasm_Module"] = { wasmBinary };
  mupdf = await import("mupdf");
}

function lib(): typeof MuPDF {
  if (!mupdf) throw new Error("engine not initialised");
  return mupdf;
}

function source(): MuPDF.Document {
  const doc = candidate ?? current;
  if (!doc) throw new Error("no Document open");
  return doc;
}

/** Opens a file as the candidate Document; the current Plan is untouched. */
export function openDocument(bytes: ArrayBuffer): DocumentInfo {
  discardDocument();
  const doc = lib().Document.openDocument(new Uint8Array(bytes), "application/pdf");
  candidate = doc;
  const pages: DocumentInfo["pages"] = [];
  for (let i = 0, n = doc.countPages(); i < n; i++) {
    const page = doc.loadPage(i);
    const [x0, y0, x1, y1] = page.getBounds();
    pages.push({ widthPt: x1 - x0, heightPt: y1 - y0 });
    page.destroy();
  }
  return { pages };
}

/** Drops the candidate Document (page picker cancelled). */
export function discardDocument(): void {
  candidate?.destroy();
  candidate = undefined;
}

/** Makes a page the Plan: of the candidate Document if there is one, else of the current one. */
export function openPage(index: number): PlanInfo {
  const from = source();
  const pageCount = from.countPages();
  if (!(index >= 0 && index < pageCount)) throw new Error(`no page ${index + 1}`);
  const page = from.loadPage(index);
  try {
    const [x0, y0, x1, y1] = page.getBounds();
    const boxes: PlanInfo["boxes"] = {};
    let userUnit = 1;
    let rotate = 0;
    const pdfPage = from.asPDF() ? (page as MuPDF.PDFPage) : undefined;
    if (pdfPage) {
      const obj = pdfPage.getObject();
      for (const name of BOXES) {
        if (obj.getInheritable(name).isNull()) continue;
        const [bx0, by0, bx1, by1] = pdfPage.getBounds(name);
        boxes[name] = { widthPt: bx1 - bx0, heightPt: by1 - by0 };
      }
      const uu = obj.get("UserUnit");
      if (uu.isNumber()) userUnit = uu.asNumber();
      const rot = obj.getInheritable("Rotate");
      if (rot.isNumber()) rotate = rot.asNumber();
    }
    // Only now, with the page ready, replace the previous Document.
    if (candidate) {
      if (current !== candidate) current?.destroy();
      current = candidate;
      candidate = undefined;
    }
    planPage = index;
    objects = undefined;
    list?.destroy();
    list = undefined;
    return { pageCount, pageIndex: index, widthPt: x1 - x0, heightPt: y1 - y0, boxes, userUnit, rotate };
  } finally {
    page.destroy();
  }
}

/** A page of the candidate (or current) Document as a small picture, fit into a box. */
export function renderThumbnail(t: ThumbnailRequest): Preview {
  const m = lib();
  const page = source().loadPage(t.page);
  try {
    const [x0, y0, x1, y1] = page.getBounds();
    const s = Math.min(t.maxWidthPx / (x1 - x0), t.maxHeightPx / (y1 - y0));
    const widthPx = Math.max(1, Math.round((x1 - x0) * s));
    const heightPx = Math.max(1, Math.round((y1 - y0) * s));
    const pix = new m.Pixmap(m.ColorSpace.DeviceRGB, [0, 0, widthPx, heightPx], true);
    pix.clear(255);
    const dev = new m.DrawDevice([s, 0, 0, s, -x0 * s, -y0 * s], pix);
    try {
      page.run(dev, m.Matrix.identity);
      dev.close();
    } finally {
      dev.destroy();
    }
    const pixels = pix.getPixels().slice();
    pix.destroy();
    return { pixels, widthPx, heightPx };
  } finally {
    page.destroy();
  }
}

/** The Plan's display list, kept so that every picture of a region is drawn from it (ADR 0004). */
let list: MuPDF.DisplayList | undefined;

/** A part of the Plan (page mm) as a picture at `pxPerMm`. */
export function renderRegion(r: RegionRequest): Preview {
  const m = lib();
  if (!current || planPage < 0) throw new Error("no Plan open");
  if (!list) {
    const page = current.loadPage(planPage);
    try {
      list = page.toDisplayList();
    } finally {
      page.destroy();
    }
  }
  const { rect } = r;
  const widthPx = Math.max(1, Math.round((rect.x1 - rect.x0) * r.pxPerMm));
  const heightPx = Math.max(1, Math.round((rect.y1 - rect.y0) * r.pxPerMm));
  // px per pt, and the page's own origin (the bounds may not start at 0).
  const s = r.pxPerMm * PT_TO_MM;
  const [bx, by] = list.getBounds();
  const pix = new m.Pixmap(m.ColorSpace.DeviceRGB, [0, 0, widthPx, heightPx], true);
  pix.clear(255);
  const dev = new m.DrawDevice([s, 0, 0, s, -(bx! + rect.x0 / PT_TO_MM) * s, -(by! + rect.y0 / PT_TO_MM) * s], pix);
  try {
    list.run(dev, m.Matrix.identity);
    dev.close();
  } finally {
    dev.destroy();
  }
  const pixels = pix.getPixels().slice();
  pix.destroy();
  return { pixels, widthPx, heightPx };
}

/**
 * The first guess for the Header and the Footer (lines across the whole Plan), and the
 * lines across half of it that Header and Footer lines snap to, along the Time direction.
 */
export function bodyHints(axis: Axis): BodyHints {
  const { objects: objs, pageMm } = planObjects();
  return { body: guessBody(objs, pageMm, axis), across: linesAcross(objs, pageMm, axis, 0.5) };
}

/** The straight lines of the drawing that zone edges snap to (built on first use). */
export function snapSegments(): Segments {
  return buildSegments(planObjects().objects);
}

/** The Plan's drawn objects in page mm, extracted on first use. */
export function planObjects(): PlanObjectsInfo {
  if (objects) return objects;
  if (!current || planPage < 0) throw new Error("no Plan open");
  const page = current.loadPage(planPage);
  try {
    const t = performance.now();
    const [x0, y0, x1, y1] = page.getBounds();
    const extracted = extractObjects(lib(), page);
    objects = { objects: extracted, pageMm: [(x1 - x0) * PT_TO_MM, (y1 - y0) * PT_TO_MM], extractMs: performance.now() - t };
    return objects;
  } finally {
    page.destroy();
  }
}

export type FirstPassInfo = FirstPass & { extractMs: number };

/** Compares this engine's Plan, as the Old Plan, with the New Plan's objects (first pass). */
export function firstPass(newPlan: PlanObjects, timeDirection: TimeDirection): FirstPassInfo {
  const old = planObjects();
  return { ...runFirstPass({ timeDirection, old, new: newPlan }), extractMs: old.extractMs };
}
