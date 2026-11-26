// Engine: open a Document, then make one page the Plan (ADR 0004, clipper ADR 0014).
import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as core from "./core";
import { makeMultiPageDocument, MULTIPAGE_PAGES } from "../testing/multipage";
import { objectsOf, pair } from "../testing/groundtruth";

const PT_TO_MM = 25.4 / 72;
const bytes = makeMultiPageDocument();
const buffer = () => bytes.slice().buffer;
const fileBuffer = (path: string) => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const wasm = readFileSync(join(dirname(require.resolve("mupdf")), "mupdf-wasm.wasm"));
  await core.init(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
});

describe("engine core", () => {
  it("lists every page's size when a Document is opened", () => {
    const info = core.openDocument(buffer());
    expect(info.pages.map((p) => [Math.round(p.widthPt * PT_TO_MM), Math.round(p.heightPt * PT_TO_MM)])).toEqual(
      MULTIPAGE_PAGES.map((p) => [p.widthMm, p.heightMm]),
    );
  });

  it("makes the chosen page the Plan", () => {
    core.openDocument(buffer());
    const plan = core.openPage(1);
    expect(plan.pageCount).toBe(3);
    expect(plan.pageIndex).toBe(1);
    expect(Math.round(plan.widthPt * PT_TO_MM)).toBe(420);
  });

  it("rejects a page that does not exist", () => {
    core.openDocument(buffer());
    expect(() => core.openPage(3)).toThrow(/no page 4/);
  });

  it("switches the page of the open Plan without reopening the file", () => {
    core.openDocument(buffer());
    core.openPage(0);
    expect(core.openPage(2).pageIndex).toBe(2);
  });

  it("keeps the current Plan when a candidate is discarded", () => {
    core.openDocument(buffer());
    core.openPage(0);
    core.openDocument(buffer());
    core.discardDocument();
    expect(core.openPage(1).pageIndex).toBe(1);
  });

  it("draws a page as a picture fit into a box", () => {
    core.openDocument(buffer());
    core.openPage(0);
    const t = core.renderThumbnail({ page: 0, maxWidthPx: 100, maxHeightPx: 200 });
    expect(t.widthPx).toBe(100);
    expect(t.pixels.length).toBe(t.widthPx * t.heightPx * 4);
    expect(t.pixels.some((v, i) => i % 4 === 0 && v < 200)).toBe(true); // not blank
  });

  it.skipIf(!existsSync("samples/down-old.pdf"))("opens a synthetic Plan", () => {
    core.openDocument(readFileSync("samples/down-old.pdf").buffer as ArrayBuffer);
    expect(core.openPage(0).pageCount).toBe(1);
  });

  it("gives the Plan's drawn objects and its page size in mm", () => {
    const gt = pair("right");
    core.openDocument(fileBuffer(gt.old.file));
    core.openPage(0);
    const plan = core.planObjects();
    expect(plan.pageMm.map(Math.round)).toEqual(gt.old.pageMm);
    expect(plan.objects.length).toBe(objectsOf(gt.old.file).length);
  });

  it("forgets the objects when another page becomes the Plan", () => {
    core.openDocument(buffer());
    core.openPage(0);
    const first = core.planObjects().objects;
    core.openPage(1);
    expect(core.planObjects().objects).not.toBe(first);
    expect(core.planObjects().pageMm.map(Math.round)).toEqual([420, 297]);
  });

  it("compares the Plan, as the Old Plan, with the New Plan's objects in a first pass", () => {
    const gt = pair("right");
    core.openDocument(fileBuffer(gt.old.file));
    core.openPage(0);
    const r = core.firstPass({ objects: objectsOf(gt.new.file), pageMm: gt.new.pageMm }, "right");
    expect(r.offset.offset).toBeCloseTo(gt.offsetMm, 2);
    expect(r.comparison.marks.some((m) => m.kind === "Added")).toBe(true);
    expect(r.comparison.marks.some((m) => m.kind === "Removed")).toBe(true);
  });
});
