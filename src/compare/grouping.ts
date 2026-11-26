// Differences into Places (ADR 0005): one Place per Activity, an Old and a New Activity
// joined when matched objects link them; Differences outside any Activity grouped by Plan,
// colour and touching; km markers and dimensions joined to the Activity they lie on. A pair
// whose Plans have no Activities drawn in one go keeps grouping by nearness. Finally a group
// that only lost drawing and one that only gained the same drawing elsewhere are one Place:
// something moved.
//
// Ported from the comparison-view prototype (prototypes/comparison/activities.mjs:
// groupByActivity, attachMarks, looseGroups; prototypes/detection/detect.mjs: groupItems;
// prototypes/comparison/common.mjs: derive).

import type { Activities } from "./activities";
import type { Mark } from "./compare";
import { BLACK, cellKey, cellsOf, cellXY, colourOf, touchUnion, unionFind } from "./drawing";
import type { Box, DrawnObject } from "./objects";

export interface Group {
  /** Mark numbers. */
  marks: number[];
  /** The Activities it is, as "old:3", "new:7". */
  activities: string[];
  /** Outside any Activity. */
  loose: boolean;
}

export interface GroupingInput {
  marks: readonly Mark[];
  links: readonly number[];
  objects: { old: readonly DrawnObject[]; new: readonly DrawnObject[] };
  activities: { old: Activities; new: Activities };
}

/** km markers and dimensions join an Activity whose Differences lie this near, mm. */
const MARKER_NEAR = 3;
/** Nearness, when there are no Activities: cells of this many mm, neighbours joined. */
const NEAR_CELL = 5;

/** Cells of a mark: its line pieces, a large area's box edges, else its box. */
function markCells(m: Mark, c: number, edges = true): Set<number> {
  const b = m.box,
    big = edges && (b.x1 - b.x0 > 20 || b.y1 - b.y0 > 20);
  const pieces = m.shape === "line" ? m.coords : big ? [b.x0, b.y0, b.x1, b.y0, b.x1, b.y0, b.x1, b.y1, b.x1, b.y1, b.x0, b.y1, b.x0, b.y1, b.x0, b.y0] : null;
  return cellsOf(pieces, b, c);
}

const colourOfMark = (m: Mark, objects: GroupingInput["objects"]) => colourOf(objects[m.plan][m.objects[0]!]!);

/** Places as groups of marks. */
export function groupMarks(input: GroupingInput): Group[] {
  const { marks, activities } = input;
  const groups = activities.old.list.length + activities.new.list.length ? byActivity(input) : byNearness(marks);
  return pairMoved(groups, input);
}

function byActivity({ marks, links, objects, activities }: GroupingInput): Group[] {
  // Old ↔ New: the New Activity most of an Old Activity's matched objects lie in.
  const votes = new Map<number, Map<number, number>>();
  for (let i = 0; i + 1 < links.length; i += 2) {
    const ao = activities.old.of[links[i]!]!,
      an = activities.new.of[links[i + 1]!]!;
    if (ao < 0 || an < 0) continue;
    let m = votes.get(ao);
    if (!m) votes.set(ao, (m = new Map()));
    m.set(an, (m.get(an) ?? 0) + 1);
  }
  const byKey = new Map<string, number[]>(),
    loose: number[] = [];
  marks.forEach((m, i) => {
    const a = activities[m.plan].of[m.objects[0]!] ?? -1;
    if (a < 0) return loose.push(i);
    const k = `${m.plan}:${a}`;
    let l = byKey.get(k);
    if (!l) byKey.set(k, (l = []));
    l.push(i);
  });
  const keys = [...byKey.keys()],
    idx = new Map(keys.map((k, i) => [k, i])),
    u = unionFind(keys.length);
  const twinOf = new Map<string, string>();
  for (const [ao, m] of votes) {
    let best = -1,
      bv = 0;
    for (const [an, v] of m)
      if (v > bv) {
        bv = v;
        best = an;
      }
    twinOf.set(`old:${ao}`, `new:${best}`);
    twinOf.set(`new:${best}`, `old:${ao}`);
    const a = idx.get(`old:${ao}`),
      b = idx.get(`new:${best}`);
    if (a !== undefined && b !== undefined) u.join(a, b);
  }
  const joined = new Map<number, Group>();
  keys.forEach((k, i) => {
    const r = u.find(i);
    let g = joined.get(r);
    if (!g) joined.set(r, (g = { marks: [], activities: [], loose: false }));
    g.marks.push(...byKey.get(k)!);
    g.activities.push(k);
  });
  // An Activity whose changes lie in one Plan only is still in both: its twin belongs to it too.
  for (const g of joined.values())
    for (const k of [...g.activities]) {
      const t = twinOf.get(k);
      if (t && !g.activities.includes(t)) g.activities.push(t);
    }
  return attachMarkers([...joined.values(), ...looseGroups(loose, marks, objects)], marks, objects);
}

/** Differences outside any Activity: one Plan, one colour, touching (1 mm cells). */
function looseGroups(list: number[], marks: readonly Mark[], objects: GroupingInput["objects"]): Group[] {
  const u = unionFind(list.length),
    layers = new Map<string, number>();
  const layerOf = (m: Mark) => {
    const k = `${m.plan}|${colourOfMark(m, objects)}`;
    if (!layers.has(k)) layers.set(k, layers.size);
    return layers.get(k)!;
  };
  touchUnion(list.length, (i) => markCells(marks[list[i]!]!, 1), u, (i) => layerOf(marks[list[i]!]!));
  return collect(list, u).map((l) => ({ marks: l, activities: [], loose: true }));
}

/**
 * km markers and dimensions (black, with text, drawn in their own pass) belong to the Activity
 * they mark: a loose black group with text joins the Activity Place of the same Plan whose
 * Differences lie within 3 mm (the one it touches most).
 */
function attachMarkers(groups: Group[], marks: readonly Mark[], objects: GroupingInput["objects"]): Group[] {
  const acts = groups.filter((g) => !g.loose),
    C = MARKER_NEAR / 2;
  const side = (m: Mark) => (m.plan === "old" ? 0 : 1e11);
  const grid = new Map<number, Set<number>>();
  acts.forEach((g, gi) => {
    for (const i of g.marks)
      for (const c of markCells(marks[i]!, C)) {
        const k = side(marks[i]!) + c;
        let s = grid.get(k);
        if (!s) grid.set(k, (s = new Set()));
        s.add(gi);
      }
  });
  const out: Group[] = [];
  for (const g of groups) {
    const ms = g.marks.map((i) => marks[i]!);
    const marker = g.loose && ms.some((m) => m.shape === "word") && ms.every((m) => colourOfMark(m, objects) === BLACK);
    if (!marker) {
      out.push(g);
      continue;
    }
    const votes = new Map<number, number>();
    for (const m of ms)
      for (const c of markCells(m, C)) {
        const [x, y] = cellXY(c);
        for (let dx = -2; dx <= 2; dx++)
          for (let dy = -2; dy <= 2; dy++) for (const gi of grid.get(side(m) + cellKey(x + dx, y + dy)) ?? []) votes.set(gi, (votes.get(gi) ?? 0) + 1);
      }
    if (!votes.size) {
      out.push(g);
      continue;
    }
    const best = [...votes].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    acts[best]!.marks.push(...g.marks);
  }
  return out;
}

/** Without Activities: everything within about 5 mm of each other, chained. */
function byNearness(marks: readonly Mark[]): Group[] {
  const all = marks.map((_, i) => i),
    u = unionFind(all.length);
  touchUnion(all.length, (i) => markCells(marks[i]!, NEAR_CELL, false), u);
  return collect(all, u).map((l) => ({ marks: l, activities: [], loose: true }));
}

function collect(list: number[], u: ReturnType<typeof unionFind>): number[][] {
  const by = new Map<number, number[]>();
  list.forEach((m, i) => {
    const r = u.find(i);
    let l = by.get(r);
    if (!l) by.set(r, (l = []));
    l.push(m);
  });
  return [...by.values()];
}

/** Two marks draw the same, wherever they are, when their relative coordinates agree this closely, mm. */
const SAME_SHAPE = 0.1;

/** What a mark is, without where: its kind, style and number of points, or its text. */
function signature(m: Mark, objects: GroupingInput["objects"]): string {
  if (m.shape === "word") return `w:${m.text}`;
  const o = objects[m.plan][m.objects[0]!]!;
  return `${o.kind}|${o.style}|${m.coords.length}`;
}

/** Do two marks of the same signature draw the same shape (relative to their boxes)? */
function sameShape(a: Mark, b: Mark): boolean {
  if (a.shape === "word") return true;
  for (let i = 0; i + 1 < a.coords.length; i += 2) {
    const ax = a.coords[i]!,
      bx = b.coords[i]!;
    if (Number.isNaN(ax) || Number.isNaN(bx)) {
      if (Number.isNaN(ax) !== Number.isNaN(bx)) return false;
      continue;
    }
    if (Math.abs(ax - a.box.x0 - (bx - b.box.x0)) > SAME_SHAPE || Math.abs(a.coords[i + 1]! - a.box.y0 - (b.coords[i + 1]! - b.box.y0)) > SAME_SHAPE) return false;
  }
  return true;
}

/** Does every mark of one group have its own twin of the same shape in the other? */
function sameDrawing(p: Group, q: Group, marks: readonly Mark[], objects: GroupingInput["objects"]): boolean {
  if (p.marks.length !== q.marks.length) return false;
  const used = new Set<number>();
  for (const i of p.marks) {
    const a = marks[i]!,
      s = signature(a, objects);
    const j = q.marks.find((j) => !used.has(j) && signature(marks[j]!, objects) === s && sameShape(a, marks[j]!));
    if (j === undefined) return false;
    used.add(j);
  }
  return true;
}

const boxOf = (g: Group, marks: readonly Mark[]): Box =>
  g.marks.map((i) => marks[i]!.box).reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));

/** A group that only lost drawing and the nearest that only gained the same drawing are one Place. */
function pairMoved(groups: Group[], { marks, objects }: GroupingInput): Group[] {
  const only = (g: Group, plan: Mark["plan"]) => g.marks.every((i) => marks[i]!.plan === plan && !marks[i]!.restyled);
  const sig = (g: Group) =>
    g.marks
      .map((i) => signature(marks[i]!, objects))
      .sort()
      .join("\n");
  const centre = (g: Group) => {
    const b = boxOf(g, marks);
    return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] as const;
  };
  const bySig = new Map<string, Group[]>();
  for (const g of groups.filter((g) => only(g, "new"))) {
    const s = sig(g);
    let l = bySig.get(s);
    if (!l) bySig.set(s, (l = []));
    l.push(g);
  }
  const gone = new Set<Group>(),
    merged: Group[] = [];
  for (const p of groups.filter((g) => only(g, "old"))) {
    const [px, py] = centre(p);
    const list = (bySig.get(sig(p)) ?? []).filter((q) => !gone.has(q) && sameDrawing(p, q, marks, objects));
    if (!list.length) continue;
    const dist = (q: Group) => {
      const [x, y] = centre(q);
      return Math.hypot(x - px, y - py);
    };
    const q = list.reduce((a, b) => (dist(b) < dist(a) ? b : a));
    gone.add(p);
    gone.add(q);
    merged.push({ marks: [...p.marks, ...q.marks], activities: [...p.activities, ...q.activities], loose: p.loose && q.loose });
  }
  return groups.filter((g) => !gone.has(g)).concat(merged);
}
