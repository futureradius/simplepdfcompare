// Changed text, word by word (ADR 0001): letters are matched one by one, the result is
// reported per word. Ported from the detection prototype (textChanges), as the
// comparison-view prototype used it.
//
// Spans (label lines) with a letter left over are paired Old ↔ New when they overlap in the
// Old frame, and their words are compared (longest common subsequence):
//   - a word only in New, or a replaced word: Added (on the New Plan's word);
//   - a word only in Old, or a word that only lost letters: Removed (on the Old Plan's word).
// A span without a partner (moved with its Activity, deleted, new) marks its changed words.

import { boxesTouch, unionBox, type Box, type GlyphObject } from "./objects";
import type { Placed } from "./match";

export interface Word {
  text: string;
  /** Old frame. */
  box: Box;
  letters: Placed[];
}

export interface WordChange {
  kind: "Added" | "Removed";
  word: Word;
  why: "inserted" | "replaced" | "deleted" | "shortened" | "gone" | "new";
}

const glyph = (p: Placed) => p.o as GlyphObject;

/** The words of a span: runs of letters between spaces. */
export function wordsOf(letters: readonly Placed[]): Word[] {
  const words: Word[] = [];
  let cur: Word | null = null;
  for (const p of letters) {
    const ch = glyph(p).ch;
    if (ch === " ") {
      cur = null;
      continue;
    }
    if (!cur) words.push((cur = { text: "", box: { ...p.box }, letters: [] }));
    cur.text += ch;
    cur.box = unionBox(cur.box, p.box);
    cur.letters.push(p);
  }
  return words;
}

/** Placed letters by span, in order. */
export function spansOf(placed: readonly Placed[]): Map<number, Placed[]> {
  const m = new Map<number, Placed[]>();
  for (const p of placed) {
    if (p.o.kind !== "glyph") continue;
    let l = m.get(p.o.span);
    if (!l) m.set(p.o.span, (l = []));
    l.push(p);
  }
  for (const l of m.values()) l.sort((a, b) => glyph(a).index - glyph(b).index);
  return m;
}

/** Is `short` what is left of `long` after deleting letters? */
function isShortened(long: string, short: string): boolean {
  if (short.length >= long.length) return false;
  let i = 0;
  for (const c of long) if (c === short[i]) i++;
  return i === short.length;
}

interface TouchedSpan {
  letters: Placed[];
  box: Box;
  left: Set<Placed>;
}

function touched(left: readonly Placed[], spans: Map<number, Placed[]>): TouchedSpan[] {
  const bySpan = new Map<number, Set<Placed>>();
  for (const p of left) {
    if (p.o.kind !== "glyph") continue;
    let s = bySpan.get(p.o.span);
    if (!s) bySpan.set(p.o.span, (s = new Set()));
    s.add(p);
  }
  return [...bySpan].map(([id, set]) => {
    const letters = spans.get(id)!;
    return { letters, box: letters.map((g) => g.box).reduce(unionBox), left: set };
  });
}

const GRID = 20;
const cellsOf = (b: Box) => {
  const out: number[] = [];
  for (let cx = Math.floor(b.x0 / GRID); cx <= Math.floor(b.x1 / GRID); cx++)
    for (let cy = Math.floor(b.y0 / GRID); cy <= Math.floor(b.y1 / GRID); cy++) out.push(cx * 1e6 + cy);
  return out;
};

/**
 * The changed words, from the letters left over after matching (`oldLeft`, `newLeft`) and all
 * placed objects of both Plans (to read whole spans).
 */
export function textChanges(oldLeft: readonly Placed[], newLeft: readonly Placed[], oldPlaced: readonly Placed[], newPlaced: readonly Placed[]): WordChange[] {
  const to = touched(oldLeft, spansOf(oldPlaced)),
    tn = touched(newLeft, spansOf(newPlaced));
  const out: WordChange[] = [];
  const usedNew = new Set<TouchedSpan>();
  const grid = new Map<number, TouchedSpan[]>();
  for (const x of tn)
    for (const c of cellsOf(x.box)) {
      let l = grid.get(c);
      if (!l) grid.set(c, (l = []));
      l.push(x);
    }
  for (const a of to) {
    let b: TouchedSpan | undefined;
    for (const c of cellsOf(a.box)) {
      b = (grid.get(c) ?? []).find((x) => !usedNew.has(x) && boxesTouch(a.box, x.box, 0.3));
      if (b) break;
    }
    if (!b) {
      for (const w of wordsOf(a.letters)) if (w.letters.some((g) => a.left.has(g))) out.push({ kind: "Removed", word: w, why: "gone" });
      continue;
    }
    usedNew.add(b);
    const wo = wordsOf(a.letters),
      wn = wordsOf(b.letters);
    const L = Array.from({ length: wo.length + 1 }, () => new Int32Array(wn.length + 1));
    for (let i = wo.length - 1; i >= 0; i--)
      for (let j = wn.length - 1; j >= 0; j--)
        L[i]![j] = wo[i]!.text === wn[j]!.text ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
    const hunkOld: Word[] = [],
      hunkNew: Word[] = [];
    const flush = () => {
      for (let k = 0; k < Math.max(hunkOld.length, hunkNew.length); k++) {
        const o = hunkOld[k],
          n = hunkNew[k];
        if (o && n) {
          if (isShortened(o.text, n.text)) out.push({ kind: "Removed", word: o, why: "shortened" });
          else out.push({ kind: "Added", word: n, why: "replaced" });
        } else if (o) out.push({ kind: "Removed", word: o, why: "deleted" });
        else if (n) out.push({ kind: "Added", word: n, why: "inserted" });
      }
      hunkOld.length = 0;
      hunkNew.length = 0;
    };
    let i = 0,
      j = 0;
    while (i < wo.length || j < wn.length) {
      if (i < wo.length && j < wn.length && wo[i]!.text === wn[j]!.text) {
        flush();
        i++;
        j++;
      } else if (j >= wn.length || (i < wo.length && L[i + 1]![j]! >= L[i]![j + 1]!)) hunkOld.push(wo[i++]!);
      else hunkNew.push(wn[j++]!);
    }
    flush();
  }
  for (const b of tn)
    if (!usedNew.has(b)) for (const w of wordsOf(b.letters)) if (w.letters.some((g) => b.left.has(g))) out.push({ kind: "Added", word: w, why: "new" });
  return out;
}
