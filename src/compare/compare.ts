// The comparison (ADR 0001): every drawn object of the Old Plan is matched with an
// identical object of the New Plan at the same place once the Offset is applied. Whatever
// is left over is a Difference: Removed when only the Old Plan draws it, Added when only the
// New Plan does. A recoloured or restyled object is Added. Text is compared letter by letter
// and marked per word. Header, Footer, the Overhang and Ignored areas are not compared.
// There is no sensitivity setting.
//
// Ported from the comparison-view prototype (prototype/comparison-view,
// prototypes/alignment/engine.mjs: quickCompare), without the Places (a later slice).

import { insideAny, middleOf } from "./ignored";
import { sameInk } from "./ink";
import { matchObjects, placeObjects, type Placed } from "./match";
import { unionBox, type Axis, type Box, type DrawnObject } from "./objects";
import { spansOf, textChanges, wordsOf, type WordChange } from "./text";

/** What is compared of one Plan, in its own page mm. */
export interface PlanSetup {
  /** The Body along the Time direction: from the Header line to the Footer line. */
  body: readonly [number, number];
  ignored: readonly Box[];
}

export interface ComparisonSetup {
  axis: Axis;
  /** oldPos = newPos + offset, mm along the Time direction. */
  offset: number;
  old: PlanSetup;
  new: PlanSetup;
}

/** One Difference, as it is drawn: the object itself (or the word), in the Old frame. */
export interface Mark {
  kind: "Added" | "Removed";
  shape: "line" | "area" | "word";
  /**
   * In the Old frame. A line: its segments as x0,y0,x1,y1, ... An area: its polygons, each
   * followed by NaN,NaN. A word: empty (its box is the mark).
   */
  coords: number[];
  /** Of a line, mm. */
  lineWidth: number;
  /** In the Old frame, with the line width. */
  box: Box;
  /** The same object, drawn in another colour or line width in the New Plan. */
  restyled: boolean;
  /** Of a word. */
  text?: string;
  /** The Plan that draws it: the Old Plan for Removed, the New Plan for Added. */
  plan: "old" | "new";
  /** Its objects by their number in their Plan's drawing order: one for a line or area, the letters of a word. */
  objects: number[];
  /** Of a restyled mark: its colour changed (else only its line width). */
  recoloured?: boolean;
  /** Of a line drawn in another width: Old and New width, mm. */
  widths?: [number, number];
  /** Of a changed word: how it changed. */
  why?: WordChange["why"];
}

export interface Comparison {
  /** What is compared along the Time direction, in the Old frame. */
  window: [number, number];
  marks: Mark[];
  /**
   * The objects matched one to one (identical, recoloured or drawn in another width), as
   * pairs of drawing-order numbers: Old, New, Old, New ...
   */
  links: number[];
  counts: {
    /** Objects compared in each Plan. */
    old: number;
    new: number;
    /** Objects found identical in both (not counting the same ink cut into other pieces). */
    unchanged: number;
    added: number;
    removed: number;
  };
}

/** A Body's border line is not comparable content: the window starts 0.5 mm inside. */
const EDGE_MARGIN = 0.5;
/** "At the edge" of the window, where each Plan clips a shape differently, mm. */
const EDGE = 1;

/** The overlap of both Bodies in the Old frame, 0.5 mm inside. */
export function comparedWindow(setup: ComparisonSetup): [number, number] {
  const o = setup.old.body,
    n = setup.new.body,
    d = setup.offset;
  return [Math.max(o[0], n[0] + d) + EDGE_MARGIN, Math.min(o[1], n[1] + d) - EDGE_MARGIN];
}

/**
 * Leaves out the objects in an Ignored area: those whose part inside the window has its middle
 * in one (the areas are in the Plan's own page mm, `shift` moves them into the Old frame).
 */
function withoutIgnored(placed: Placed[], ignored: readonly Box[], axis: Axis, shift: number): Placed[] {
  if (!ignored.length) return placed;
  const moved = ignored.map((b) => (axis === "y" ? { ...b, y0: b.y0 + shift, y1: b.y1 + shift } : { ...b, x0: b.x0 + shift, x1: b.x1 + shift }));
  return placed.filter((p) => {
    const [x, y] = p.o.kind === "glyph" ? [p.coords[0]!, p.coords[1]!] : middleOf(p.o, p.box);
    return !insideAny(x, y, moved);
  });
}

/** Drawing-order numbers of a Plan's objects. */
const numbered = (objs: readonly DrawnObject[]) => new Map(objs.map((o, i) => [o, i] as const));

/** How a restyled object changed: its colour, or only its line width. */
interface Restyle {
  recoloured: boolean;
  widths?: [number, number];
}

function shapeMark(p: Placed, kind: Mark["kind"], no: number, restyle?: Restyle): Mark {
  const o = p.o;
  return {
    kind,
    shape: o.kind === "stroke" ? "line" : "area",
    coords: p.coords,
    lineWidth: o.kind === "stroke" ? o.nums[0]! : 0,
    box: p.box,
    restyled: !!restyle,
    plan: kind === "Added" ? "new" : "old",
    objects: [no],
    ...(restyle ? { recoloured: restyle.recoloured, ...(restyle.widths ? { widths: restyle.widths } : {}) } : {}),
  };
}

const colourOf = (o: DrawnObject) => o.style.split("|")[o.kind === "glyph" ? 3 : 1];

export function compare(oldObjs: readonly DrawnObject[], newObjs: readonly DrawnObject[], setup: ComparisonSetup): Comparison {
  const { axis, offset } = setup;
  const window = comparedWindow(setup);
  const oldP = withoutIgnored(placeObjects(oldObjs, axis, 0, window), setup.old.ignored, axis, 0);
  const newP = withoutIgnored(placeObjects(newObjs, axis, offset, window), setup.new.ignored, axis, offset);

  // 1. Identical objects.
  const exact = matchObjects(oldP, newP);
  // 2. The same object in another colour: a recolour, Added (ADR 0001).
  const colour = matchObjects(exact.oldLeft, exact.newLeft, (p) => p.keyWithoutColour);
  // 3. A line at the same position, in another width (and often colour): restyled, Added (ADR 0005).
  const isLine = (p: Placed) => p.o.kind === "stroke";
  const width = matchObjects(colour.oldLeft.filter(isLine), colour.newLeft.filter(isLine), (p) => `${p.coords.length}`, false);
  let oldLeft = [...colour.oldLeft.filter((p) => !isLine(p)), ...width.oldLeft],
    newLeft = [...colour.newLeft.filter((p) => !isLine(p)), ...width.newLeft];
  const restyled = new Map<Placed, Restyle>([
    ...colour.pairs.map(([, b]) => [b, { recoloured: true }] as const),
    ...width.pairs.map(([a, b]) => [b, { recoloured: colourOf(a.o) !== colourOf(b.o), widths: [a.o.nums[0]!, b.o.nums[0]!] as [number, number] }] as const),
  ]);
  const noOld = numbered(oldObjs),
    noNew = numbered(newObjs);
  const links: number[] = [];
  for (const [a, b] of [...exact.pairs, ...colour.pairs, ...width.pairs]) links.push(noOld.get(a.o)!, noNew.get(b.o)!);

  // 4. The same ink, only cut into other pieces (ADR 0005): no change.
  const inkOld = sameInk(oldLeft, newP),
    inkNew = sameInk(newLeft, oldP);
  oldLeft = oldLeft.filter((p) => !inkOld.has(p));
  newLeft = newLeft.filter((p) => !inkNew.has(p));
  // 5. At the edge of the window each Plan clips a shape differently: the same lines in
  //    another colour are a recolour there. Only at the edge: elsewhere a moved Activity can
  //    land on lines of another colour, which says nothing.
  const t0 = axis === "y" ? "y0" : "x0",
    t1 = axis === "y" ? "y1" : "x1";
  const atEdge = (p: Placed) => p.box[t0] <= window[0] + EDGE || p.box[t1] >= window[1] - EDGE;
  const edgeOld = sameInk(oldLeft.filter(atEdge), newP, true),
    edgeNew = sameInk(newLeft.filter(atEdge), oldP, true);
  oldLeft = oldLeft.filter((p) => !edgeOld.has(p));
  for (const p of newLeft) if (edgeNew.has(p)) restyled.set(p, { recoloured: true });
  newLeft = newLeft.filter((p) => !edgeNew.has(p));

  const marks: Mark[] = [];
  // 6. Lines and areas left over.
  for (const p of oldLeft) if (p.o.kind !== "glyph") marks.push(shapeMark(p, "Removed", noOld.get(p.o)!));
  for (const p of newLeft) if (p.o.kind !== "glyph") marks.push(shapeMark(p, "Added", noNew.get(p.o)!));
  for (const [p, how] of restyled) if (p.o.kind !== "glyph") marks.push(shapeMark(p, "Added", noNew.get(p.o)!, how));
  // 7. Text, per word.
  for (const c of textChanges(oldLeft, newLeft, oldP, newP))
    marks.push({
      kind: c.kind,
      shape: "word",
      coords: [],
      lineWidth: 0,
      box: c.word.box,
      restyled: false,
      text: c.word.text,
      plan: c.kind === "Added" ? "new" : "old",
      objects: c.word.letters.map((g) => (c.kind === "Added" ? noNew : noOld).get(g.o)!),
      why: c.why,
    });
  // A recoloured word is Added as a whole word.
  const recolouredLetters = [...restyled.keys()].filter((p) => p.o.kind === "glyph");
  if (recolouredLetters.length) {
    const spans = spansOf(newP),
      done = new Set<number>();
    for (const p of recolouredLetters) {
      const span = p.o.kind === "glyph" ? p.o.span : -1;
      if (done.has(span)) continue;
      done.add(span);
      for (const w of wordsOf(spans.get(span) ?? [])) {
        if (!w.letters.some((g) => restyled.has(g))) continue;
        marks.push({
          kind: "Added",
          shape: "word",
          coords: [],
          lineWidth: 0,
          box: w.letters.map((g) => g.box).reduce(unionBox),
          restyled: true,
          text: w.text,
          plan: "new",
          objects: w.letters.map((g) => noNew.get(g.o)!),
          recoloured: w.letters.some((g) => restyled.get(g)?.recoloured !== false),
        });
      }
    }
  }
  return {
    window,
    marks,
    links,
    counts: {
      old: oldP.length,
      new: newP.length,
      unchanged: exact.pairs.length,
      added: marks.filter((m) => m.kind === "Added").length,
      removed: marks.filter((m) => m.kind === "Removed").length,
    },
  };
}
