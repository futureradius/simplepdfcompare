// Messages between the UI and an engine (worker or in-thread fallback). One engine per Plan.

export type PageBoxName = "MediaBox" | "CropBox" | "BleedBox" | "TrimBox" | "ArtBox";

/** A Document as opened: its pages, before one is chosen as the Plan. */
export interface DocumentInfo {
  /** Displayed size of every page (CropBox, UserUnit and rotation applied). */
  pages: { widthPt: number; heightPt: number }[];
}

export interface PlanInfo {
  pageCount: number;
  /** The chosen page (0-based). */
  pageIndex: number;
  /** Size of the page as MuPDF displays it (CropBox, UserUnit and rotation applied). */
  widthPt: number;
  heightPt: number;
  /** Page boxes explicitly declared in the file, for diagnostics. */
  boxes: Partial<Record<PageBoxName, { widthPt: number; heightPt: number }>>;
  userUnit: number;
  rotate: number;
}

export interface Preview {
  /** RGBA pixels. */
  pixels: Uint8ClampedArray;
  widthPx: number;
  heightPx: number;
}

/** A page of the Document as a small picture, fit into maxWidthPx × maxHeightPx. */
export interface ThumbnailRequest {
  page: number;
  maxWidthPx: number;
  maxHeightPx: number;
}

export type Request =
  | { id: number; op: "init"; wasmBinary: ArrayBuffer }
  | { id: number; op: "openDocument"; bytes: ArrayBuffer }
  | { id: number; op: "discardDocument" }
  | { id: number; op: "openPage"; page: number }
  | { id: number; op: "renderThumbnail"; thumb: ThumbnailRequest };

/** A Request without its id (distributes over the union). */
export type RequestBody = Request extends infer R ? (R extends Request ? Omit<R, "id"> : never) : never;

export type Response = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
