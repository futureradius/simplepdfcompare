// Engine core: everything that touches MuPDF. Runs inside the worker (one per Plan,
// ADR 0004), or on the main thread as a fallback when workers are unavailable from
// file:// (clipper ADR 0010).
//
// A file is opened in two steps (clipper ADR 0014): openDocument() loads it as a
// *candidate* (thumbnails of its pages can be drawn), openPage() makes one of its pages
// the Plan. Until then the previous Plan stays usable, so the page picker can be cancelled.
// Later slices add the display list, overview and bands to openPage().

import type * as MuPDF from "mupdf";
import type { DocumentInfo, PageBoxName, PlanInfo, Preview, ThumbnailRequest } from "./protocol";

let mupdf: typeof MuPDF | undefined;
/** The Document the Plan comes from. */
let current: MuPDF.Document | undefined;
/** A Document just opened, whose page has not been chosen yet. */
let candidate: MuPDF.Document | undefined;

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
