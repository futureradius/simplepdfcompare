// Messages between the UI and an engine (worker or in-thread fallback). One engine per Plan.

import type { Axis } from "../compare/objects";
import type { ComparisonRunInput, OffsetSearchInput } from "./core";

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

/** A part of the Plan as a picture: `rect` in page mm, drawn at `pxPerMm`. */
export interface RegionRequest {
  rect: { x0: number; y0: number; x1: number; y1: number };
  pxPerMm: number;
}

export type Request =
  | { id: number; op: "init"; wasmBinary: ArrayBuffer }
  | { id: number; op: "openDocument"; bytes: ArrayBuffer }
  | { id: number; op: "discardDocument" }
  | { id: number; op: "openPage"; page: number }
  | { id: number; op: "renderThumbnail"; thumb: ThumbnailRequest }
  | { id: number; op: "renderRegion"; region: RegionRequest }
  | { id: number; op: "bodyHints"; axis: Axis }
  | { id: number; op: "snapSegments" }
  | { id: number; op: "extractObjects" }
  | { id: number; op: "planObjects" }
  | ({ id: number; op: "findOffset" } & OffsetSearchInput)
  | { id: number; op: "cancel"; target: number }
  | ({ id: number; op: "compare" } & ComparisonRunInput);

/** A Request without its id (distributes over the union). */
export type RequestBody = Request extends infer R ? (R extends Request ? Omit<R, "id"> : never) : never;

export type Response = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
