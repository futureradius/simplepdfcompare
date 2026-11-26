// Extracting a Plan's drawn objects in page mm (ADR 0001), checked against the ground truth.
import { describe, expect, it } from "vitest";
import { boxesTouch, type GlyphObject } from "../compare/objects";
import { objectsOf, pair } from "../testing/groundtruth";

const textOf = (glyphs: GlyphObject[], span: number) =>
  glyphs
    .filter((g) => g.span === span)
    .sort((a, b) => a.index - b.index)
    .map((g) => g.ch)
    .join("");

describe("extracting drawn objects", () => {
  const right = pair("right");
  const objs = objectsOf(right.old.file);

  it("finds lines, areas, hatched areas and letters", () => {
    const kinds = new Set(objs.map((o) => o.kind));
    expect([...kinds].sort()).toEqual(["fill", "glyph", "hatch", "stroke"]);
  });

  it("reads text as letters of a span, in page mm where the ground truth puts it", () => {
    const glyphs = objs.filter((o): o is GlyphObject => o.kind === "glyph");
    const r2 = right.changes.find((c) => c.id === "R2")!.differences.find((d) => d.plan === "old")!.boxMm;
    const spans = new Set(glyphs.filter((g) => boxesTouch(g.box, r2)).map((g) => g.span));
    expect([...spans].map((s) => textOf(glyphs, s))).toContain("Abnahme 15 AT");
  });

  it("measures in mm on a Plan with a UserUnit (the 14 m pair)", () => {
    const down = pair("down");
    const big = objectsOf(down.old.file);
    const maxY = Math.max(...big.filter((o) => o.kind === "glyph").map((o) => (o as GlyphObject).origin[1]));
    expect(maxY).toBeGreaterThan(down.old.footerMm[0]);
    expect(maxY).toBeLessThanOrEqual(down.old.pageMm[1]);
  });
});
