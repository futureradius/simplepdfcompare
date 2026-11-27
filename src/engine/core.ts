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
import type { PlanObjects } from "../compare/firstpass";
import { guessBody, linesAcross } from "../compare/body";
import { compare, type Comparison, type ComparisonSetup } from "../compare/compare";
import type { Axis, Box } from "../compare/objects";
import { findOffsetAsync, type OffsetControl, type OffsetResult } from "../compare/offset";
import { findPlaces, type AxisZones, type Place } from "../compare/places";
import { buildSegments, type Segments } from "../zones/snap";
import { bandCount, bandEdges, bandsTouching, overviewScale } from "./bands";
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
    dropView();
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

/**
 * The display list cut into bands along the Time direction (ADR 0004): each band holds the
 * objects that reach into it, so a picture of a region walks only the bands it touches.
 * Built when the comparison view is shown. `edges` are in page pt along `axis`.
 */
let bands: { axis: Axis; lists: MuPDF.DisplayList[]; edges: number[] } | undefined;
/** The overview of the comparison view, kept for a second showing. */
let overview: { axis: Axis; view: ViewPrepared } | undefined;
let regionBands = 0;

export interface ViewPrepared {
  /** The whole Plan at `pxPerMm`. */
  overview: Preview;
  pxPerMm: number;
  /** How many bands the display list was cut into. */
  bands: number;
}

function displayList(): MuPDF.DisplayList {
  if (!current || planPage < 0) throw new Error("no Plan open");
  if (!list) {
    const page = current.loadPage(planPage);
    try {
      list = page.toDisplayList();
    } finally {
      page.destroy();
    }
  }
  return list;
}

function dropView(): void {
  for (const l of bands?.lists ?? []) l.destroy();
  bands = undefined;
  overview = undefined;
}

/** Cuts the display list into bands along `axis`, in one pass (research: worker.mjs, bands). */
function buildBands(axis: Axis): void {
  const m = lib();
  const dl = displayList();
  const b = dl.getBounds();
  const t = axis === "y" ? 1 : 0;
  const n = bandCount((b[t + 2]! - b[t]!) * PT_TO_MM);
  const edges = bandEdges(b[t]!, b[t + 2]!, n);
  const lists: MuPDF.DisplayList[] = [],
    devs: MuPDF.Device[] = [];
  for (let i = 0; i < n; i++) {
    const r: [number, number, number, number] = [b[0]!, b[1]!, b[2]!, b[3]!];
    r[t] = edges[i]!;
    r[t + 2] = edges[i + 1]!;
    const l = new m.DisplayList(r);
    lists.push(l);
    devs.push(new m.DisplayListDevice(l));
  }
  // Inside a hatch pattern's tile, everything goes where the tile goes: its cell is drawn in
  // the pattern's own space, not where it lands on the page.
  const tiles: MuPDF.Device[][] = [];
  const touching = (r: ArrayLike<number>) => bandsTouching(edges, r[t]! - 0.01, r[t + 2]! + 0.01).map((i) => devs[i]!);
  const each = (r: MuPDF.Rect, f: (d: MuPDF.Device) => void) => {
    for (const d of tiles.length ? tiles[tiles.length - 1]! : touching(r)) f(d);
  };
  // Clips, groups, masks and pictures go to every band (or the tile's), so nesting stays intact.
  const all =
    (fn: keyof MuPDF.Device) =>
    (...a: unknown[]): void => {
      for (const d of tiles.length ? tiles[tiles.length - 1]! : devs) (d[fn] as (...x: unknown[]) => unknown).apply(d, a);
    };
  /** Where a tile lands on the page: its area through its matrix. */
  const tileBands = (area: MuPDF.Rect, ctm: MuPDF.Matrix): MuPDF.Device[] => {
    const xs: number[] = [],
      ys: number[] = [];
    for (const [x, y] of [
      [area[0], area[1]],
      [area[2], area[1]],
      [area[0], area[3]],
      [area[2], area[3]],
    ] as [number, number][]) {
      xs.push(ctm[0] * x + ctm[2] * y + ctm[4]);
      ys.push(ctm[1] * x + ctm[3] * y + ctm[5]);
    }
    const r = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    return r.every(Number.isFinite) ? touching(r) : devs;
  };
  const NO_STROKE = null as unknown as MuPDF.StrokeState;
  const dev = new m.Device({
    fillPath: (path, eo, ctm, cs, color, alpha) => each(path.getBounds(NO_STROKE, ctm), (d) => d.fillPath(path, eo, ctm, cs, color as MuPDF.Color, alpha)),
    strokePath: (path, st, ctm, cs, color, alpha) => each(path.getBounds(st, ctm), (d) => d.strokePath(path, st, ctm, cs, color as MuPDF.Color, alpha)),
    fillText: (text, ctm, cs, color, alpha) => each(text.getBounds(NO_STROKE, ctm), (d) => d.fillText(text, ctm, cs, color as MuPDF.Color, alpha)),
    strokeText: (text, st, ctm, cs, color, alpha) => each(text.getBounds(st, ctm), (d) => d.strokeText(text, st, ctm, cs, color as MuPDF.Color, alpha)),
    clipPath: all("clipPath"),
    clipStrokePath: all("clipStrokePath"),
    clipText: all("clipText"),
    clipStrokeText: all("clipStrokeText"),
    ignoreText: all("ignoreText"),
    fillShade: all("fillShade"),
    fillImage: all("fillImage"),
    fillImageMask: all("fillImageMask"),
    clipImageMask: all("clipImageMask"),
    popClip: all("popClip"),
    beginMask: all("beginMask"),
    endMask: all("endMask"),
    beginGroup: all("beginGroup"),
    endGroup: all("endGroup"),
    beginTile: (area, view, xs, ys, ctm, id, docId) => {
      const to = tiles.length ? tiles[tiles.length - 1]! : tileBands(area, ctm);
      tiles.push(to);
      let r = 0;
      for (const d of to) r = d.beginTile(area, view, xs, ys, ctm, id, docId);
      return r;
    },
    endTile: () => {
      for (const d of tiles.pop() ?? []) d.endTile();
    },
    beginLayer: all("beginLayer"),
    endLayer: all("endLayer"),
  });
  try {
    dl.run(dev, m.Matrix.identity);
    dev.close();
  } finally {
    dev.destroy();
    for (const d of devs) {
      d.close();
      d.destroy();
    }
  }
  bands = { axis, lists, edges };
}

const copyView = (v: ViewPrepared): ViewPrepared => ({ ...v, overview: { ...v.overview, pixels: v.overview.pixels.slice() } });

/**
 * Makes the Plan ready for the comparison view (ADR 0004): cuts its display list into bands
 * along the Time direction and renders it whole at the overview scale. Kept until another
 * page becomes the Plan; a second call with the same axis costs only the copy.
 */
export function prepareView(axis: Axis): ViewPrepared {
  if (overview?.axis === axis) return copyView(overview.view);
  if (bands?.axis !== axis) {
    dropView();
    buildBands(axis);
  }
  const [x0, y0, x1, y1] = displayList().getBounds();
  const w = (x1 - x0) * PT_TO_MM,
    h = (y1 - y0) * PT_TO_MM;
  const pxPerMm = overviewScale(w, h);
  const view: ViewPrepared = { overview: renderRegion({ rect: { x0: 0, y0: 0, x1: w, y1: h }, pxPerMm }), pxPerMm, bands: bands!.lists.length };
  overview = { axis, view };
  return copyView(view);
}

/** How many bands the last region was drawn through (0: the whole display list). */
export const lastRegionBands = () => regionBands;

/** A part of the Plan (page mm) as a picture at `pxPerMm`: through the bands it touches, once they are built. */
export function renderRegion(r: RegionRequest): Preview {
  const m = lib();
  const dl = displayList();
  const { rect } = r;
  const widthPx = Math.max(1, Math.round((rect.x1 - rect.x0) * r.pxPerMm));
  const heightPx = Math.max(1, Math.round((rect.y1 - rect.y0) * r.pxPerMm));
  // px per pt, and the page's own origin (the bounds may not start at 0).
  const s = r.pxPerMm * PT_TO_MM;
  const [bx, by, bx1, by1] = dl.getBounds();
  const pix = new m.Pixmap(m.ColorSpace.DeviceRGB, [0, 0, widthPx, heightPx], true);
  pix.clear(255);
  const dev = new m.DrawDevice([s, 0, 0, s, -(bx! + rect.x0 / PT_TO_MM) * s, -(by! + rect.y0 / PT_TO_MM) * s], pix);
  try {
    if (!bands) {
      regionBands = 0;
      dl.run(dev, m.Matrix.identity);
    } else {
      // Each band inside a clip to itself, so an object in two bands is drawn once.
      const t = bands.axis === "y";
      const lo = t ? by! + rect.y0 / PT_TO_MM : bx! + rect.x0 / PT_TO_MM,
        hi = t ? by! + rect.y1 / PT_TO_MM : bx! + rect.x1 / PT_TO_MM;
      const used = bandsTouching(bands.edges, lo, hi);
      regionBands = used.length;
      for (const i of used) {
        const a = bands.edges[i]!,
          z = bands.edges[i + 1]!;
        const clip = new m.Path();
        if (t) clip.rect(bx! - 1, a, bx1! + 1, z);
        else clip.rect(a, by! - 1, z, by1! + 1);
        dev.clipPath(clip, false, m.Matrix.identity);
        bands.lists[i]!.run(dev, m.Matrix.identity);
        dev.popClip();
        clip.destroy();
      }
    }
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

/** What the Offset search needs from the New Plan and the setup (the Old Plan is this engine's own). */
export interface OffsetSearchInput {
  newPlan: PlanObjects;
  axis: Axis;
  /** Each Plan's Body along the Time direction, and the Ausgenommen boxes, in its own page mm. */
  bodyOld: [number, number];
  bodyNew: [number, number];
  ignoredOld?: Box[];
  ignoredNew?: Box[];
}

/** Searches the Offset of this engine's Plan, as the Old Plan, against the New Plan's objects. In pieces, so it can be stopped. */
export function findOffset(input: OffsetSearchInput, ctl: OffsetControl): Promise<OffsetResult> {
  const { newPlan, ...opts } = input;
  return findOffsetAsync(planObjects().objects, newPlan.objects, opts, ctl);
}

export interface ComparisonRunInput {
  newPlan: PlanObjects;
  setup: ComparisonSetup;
  axisZones: { old: AxisZones; new: AxisZones };
}

export interface ComparisonRunOutput {
  comparison: Comparison;
  places: Place[];
  ms: { compare: number; places: number };
}

/** Compares this engine's Plan, as the Old Plan, with the New Plan's objects under the user's setup, and forms the Places. */
export function runComparison(input: ComparisonRunInput): ComparisonRunOutput {
  const old = planObjects().objects;
  let t = performance.now();
  const comparison = compare(old, input.newPlan.objects, input.setup);
  const compareMs = performance.now() - t;
  t = performance.now();
  const places = findPlaces({ old, new: input.newPlan.objects, setup: input.setup, comparison, axisZones: input.axisZones });
  return { comparison, places, ms: { compare: compareMs, places: performance.now() - t } };
}
