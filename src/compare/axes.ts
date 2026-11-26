// Reading a Plan's own axes (ADR 0006): dates and hours along time, km across. With axis
// zones only the texts inside them count (dates and hours in a Zeitachse, any number in a
// Wegachse); without, they are found by search: km in the Header (plain numbers, or km inside
// upright labels), dates inside the Body. In the Plan's own page mm.
//
// Ported from the comparison-view prototype (prototypes/comparison/naming.mjs: axesOf, kmAt,
// fitLine, monotone).

import type { DrawnObject } from "./objects";
import { indexText, type TextIndex } from "./labels";
import type { Axis, Box } from "./objects";
import type { AxisZones } from "./places";

/** A straight line v = c0 + c1 · pos. */
interface Line {
  c0: number;
  c1: number;
  pts: [number, number][];
}

export interface Axes {
  /** km across: on a straight line, or piece by piece between the marks where the scale changes. */
  km: { line: Line | null; pieces: [number, number][] | null } | null;
  /** Days since 1970-01-01 (UTC) along time: day = c0 + c1 · pos. */
  time: { c0: number; c1: number } | null;
  /** The hour labels read (in a Zeitachse zone), and the way they stand for their lines. */
  hours: { labels: number; way: string | null } | null;
}

export interface AxesInput {
  axis: Axis;
  /** The Body along the Time direction. */
  body: readonly [number, number];
  zones?: AxisZones;
  /** The Plan's text, if already read. */
  text?: TextIndex;
}

const MONTHS = ["jan", "feb", "mär", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "dez"];
const DAY = 86400000;
const dayNo = (y: number, m: number, d: number) => Date.UTC(y, m, d) / DAY;
const year4 = (y: number) => (y < 100 ? 2000 + y : y);
function isoMonday(year: number, week: number): number {
  const jan4 = new Date(Date.UTC(year, 0, 4)),
    wd = (jan4.getUTCDay() + 6) % 7;
  return jan4.getTime() / DAY - wd + (week - 1) * 7;
}
const inRects = (rs: readonly Box[], b: Box) => {
  const x = (b.x0 + b.x1) / 2,
    y = (b.y0 + b.y1) / 2;
  return rs.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
};

/** A robust straight line through points [pos, v]: the most inliers within `tol` (in pos), then least squares. */
function fitLine(pts: [number, number][], tol: number): Line | null {
  const n = pts.length;
  if (n < 3) return null;
  let best: [number, number][] | null = null;
  for (let i = 0; i < n; i++)
    for (const k of [1, 2, 3, 5, 8, 13, Math.floor(n / 2)]) {
      if (i + k >= n) continue;
      const [p0, v0] = pts[i]!,
        [p1, v1] = pts[i + k]!;
      if (Math.abs(p1 - p0) < 1e-6 || v1 === v0) continue;
      const c1 = (v1 - v0) / (p1 - p0),
        c0 = v0 - c1 * p0;
      const inl = pts.filter(([p, v]) => Math.abs((v - c0) / c1 - p) < tol);
      if (!best || inl.length > best.length) best = inl;
    }
  if (!best || best.length < 3) return null;
  const m = best.length,
    mp = best.reduce((a, [p]) => a + p, 0) / m,
    mv = best.reduce((a, [, v]) => a + v, 0) / m;
  let sxy = 0,
    sxx = 0;
  for (const [p, v] of best) {
    sxy += (p - mp) * (v - mv);
    sxx += (p - mp) ** 2;
  }
  if (!sxx) return null;
  const c1 = sxy / sxx;
  return { c0: mv - c1 * mp, c1, pts: best };
}

/** The longest run of marks whose km only rise (or only fall) across: the scale's own marks. */
function monotone(pts: [number, number][]): [number, number][] {
  const best = (sign: number) => {
    const n = pts.length,
      len = new Array<number>(n).fill(1),
      prev = new Array<number>(n).fill(-1);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < i; j++)
        if (pts[i]![0] - pts[j]![0] > 0.5 && sign * (pts[i]![1] - pts[j]![1]) > 0 && len[j]! + 1 > len[i]!) {
          len[i] = len[j]! + 1;
          prev[i] = j;
        }
    let k = len.indexOf(Math.max(...len));
    const out: [number, number][] = [];
    while (k >= 0) {
      out.push(pts[k]!);
      k = prev[k]!;
    }
    return out.reverse();
  };
  const up = best(1),
    down = best(-1);
  return up.length >= down.length ? up : down;
}

export function readAxes(objs: readonly DrawnObject[], input: AxesInput): Axes {
  const { axis, body } = input;
  const [b0, b1] = body;
  const z = { time: input.zones?.time ?? [], location: input.zones?.location ?? [] };
  const ix = input.text ?? indexText(objs);
  const t = axis === "y" ? 1 : 0;
  const lo = (b: Box) => (t ? b.y0 : b.x0),
    hi = (b: Box) => (t ? b.y1 : b.x1),
    aLo = (b: Box) => (t ? b.x0 : b.y0),
    aHi = (b: Box) => (t ? b.x1 : b.y1);
  const spans = [...ix.spans.values()].filter((s) => s.text);

  // ---- km across ----
  const kmPts: [number, number][] = [];
  for (const s of spans) {
    const a = (aLo(s.box) + aHi(s.box)) / 2;
    let m: RegExpExecArray | null;
    if (z.location.length) {
      if (!inRects(z.location, s.box)) continue;
      // Bahn-km as "12,4 + 70" (km 12,4 plus 70 m), or any number
      if ((m = /^(?:km\s*)?(\d{1,4}),(\d)\s*\+\s*(\d{1,3})$/i.exec(s.text))) kmPts.push([a, +m[1]! + +m[2]! / 10 + +m[3]! / 1000]);
      else if ((m = /^(?:km\s*)?(\d{1,4})(?:([,.+])(\d{1,3}))?$/i.exec(s.text))) kmPts.push([a, m[2] === "+" ? +m[1]! + +m[3]! / 1000 : +`${m[1]}.${m[3] ?? 0}`]);
      continue;
    }
    if ((lo(s.box) + hi(s.box)) / 2 >= b0) continue; // only in the Header
    if ((m = /^(\d{1,3})[,.+](\d{1,3})$/.exec(s.text))) {
      kmPts.push([a, s.text.includes("+") ? +m[1]! + +m[2]! / 1000 : +`${m[1]}.${m[2]}`]);
      continue;
    }
    // a km inside a longer label written along the time direction, so that it marks one place across
    if (aHi(s.box) - aLo(s.box) > 6) continue;
    if ((m = /km\s*(\d{1,4}),(\d{1,3})(?:\s*\+\s*(\d{1,3}))?/i.exec(s.text)))
      kmPts.push([a, m[3] !== undefined ? +m[1]! + +`0.${m[2]}` + +m[3] / 1000 : +`${m[1]}.${m[2]}`]);
  }
  kmPts.sort((p, q) => p[0] - q[0]);
  let km: Axes["km"] = null;
  const line = fitLine(kmPts, 3);
  if (line && line.pts.length >= 0.8 * kmPts.length) km = { line, pieces: null };
  else if (kmPts.length >= 3) {
    const uniq: [number, number][] = [];
    for (const p of kmPts) if (!uniq.some((q) => Math.abs(q[0] - p[0]) < 0.5 && Math.abs(q[1] - p[1]) < 0.0005)) uniq.push(p);
    const pw = monotone(uniq);
    if (pw.length >= 3) km = { line: null, pieces: pw };
    else if (line) km = { line, pieces: null };
  }

  // ---- dates along time ----
  const inTime = z.time.length
    ? (b: Box) => inRects(z.time, b)
    : (b: Box) => {
        const c = (lo(b) + hi(b)) / 2;
        return c >= b0 && c <= b1;
      };
  const dmy: [number, number][] = [],
    kw: [number, number, number | null][] = [],
    mon: [number, number][] = [],
    hrs: { lo: number; hi: number; h: number }[] = [];
  for (const s of spans) {
    if (!inTime(s.box)) continue;
    let m: RegExpExecArray | null;
    // hour labels only in a Zeitachse zone: elsewhere "17:30" is a time written at a bar
    if (z.time.length && (m = /^(\d{1,2})(?::(\d{2}))?(?:\s*Uhr)?$/i.exec(s.text)) && +m[1]! <= 24 && (!m[2] || +m[2] < 60)) {
      hrs.push({ lo: lo(s.box), hi: hi(s.box), h: +m[1]! + (m[2] ? +m[2] / 60 : 0) });
      continue;
    }
    if ((m = /^(?:[A-Za-z]{2}\.?\s+)?(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(s.text))) dmy.push([lo(s.box), dayNo(year4(+m[3]!), +m[2]! - 1, +m[1]!)]);
    else if ((m = /^KW\s*(\d{1,2})(?:\s*[/.]\s*(\d{2}|\d{4}))?$/i.exec(s.text))) kw.push([lo(s.box), +m[1]!, m[2] ? year4(+m[2]) : null]);
    else if ((m = /^([A-Za-zä]{3})[a-zä]*\.?\s+(\d{4})$/i.exec(s.text))) {
      const i = MONTHS.indexOf(m[1]!.toLowerCase().replace("mrz", "mär"));
      if (i >= 0) mon.push([lo(s.box), dayNo(+m[2]!, i, 1)]);
    }
  }
  const byPos = (p: [number, number], q: [number, number]) => p[0] - q[0];
  // a coarse fit first, to know the year of a KW
  const coarse = fitLine([...dmy, ...mon].sort(byPos), 80);
  const kwDays: [number, number][] = [];
  for (const [p, w, y] of kw) {
    if (y) {
      kwDays.push([p, isoMonday(y, w)]);
      continue;
    }
    if (!coarse) continue;
    const guess = coarse.c0 + coarse.c1 * p,
      gy = new Date(guess * DAY).getUTCFullYear();
    const best = [gy - 1, gy, gy + 1].map((yy) => isoMonday(yy, w)).sort((a, b) => Math.abs(a - guess) - Math.abs(b - guess))[0]!;
    if (Math.abs(best - guess) < 10) kwDays.push([p, best]);
  }
  // one point per date: the label nearest the start of its cell
  const first = new Map<number, number>();
  for (const [p, v] of [...dmy, ...kwDays]) if (!first.has(v) || first.get(v)! > p) first.set(v, p);
  const datePts = [...first].map(([v, p]) => [p, v] as [number, number]).sort(byPos);
  const fit = fitLine(datePts, 6);
  let time: Axes["time"] = null,
    hours: Axes["hours"] = hrs.length ? { labels: hrs.length, way: null } : null;
  if (fit) {
    let c0 = fit.c0;
    const c1 = fit.c1;
    // grid lines across time in the Body; each date label stands for the one at or before it
    const per = 1 / Math.abs(c1),
      pos: number[] = [];
    for (const o of objs) {
      if (o.kind !== "stroke" && o.kind !== "fill") continue;
      for (const p of o.polys)
        for (let i = 0; i + 3 < p.pts.length; i += 2) {
          const dt = Math.abs(p.pts[i + t]! - p.pts[i + 2 + t]!),
            da = Math.abs(p.pts[i + 1 - t]! - p.pts[i + 3 - t]!);
          if (dt < 0.05 && da >= 5 && p.pts[i + t]! > b0 && p.pts[i + t]! < b1) pos.push(p.pts[i + t]!);
        }
    }
    pos.sort((a, b) => a - b);
    if (pos.length > 3) {
      const at = (x: number) => {
        let l = 0,
          r = pos.length - 1,
          ans = -1;
        while (l <= r) {
          const m = (l + r) >> 1;
          if (pos[m]! <= x + 0.05) {
            ans = m;
            l = m + 1;
          } else r = m - 1;
        }
        return ans < 0 ? null : pos[ans]!;
      };
      const a = fit.pts
        .map(([p, v]) => {
          const g = at(p);
          return v - c1 * (g !== null && p - g < per * 0.8 ? g : p);
        })
        .sort((x, y) => x - y);
      c0 = a[Math.floor(a.length / 2)]!;
    }
    // Hour labels set the time of day; the dates only say which day it is. Each label stands
    // for a grid line: one through it (centred), the one before it (label after its tick), the
    // one after it (label above its line), or none (its middle). Plans differ, so each way is
    // tried; of the consistent ones, the one closest to what the dates say wins.
    if (hrs.length >= 3 && pos.length) {
      const near = (x: number) => {
        let l = 0,
          r = pos.length - 1;
        while (l < r) {
          const m = (l + r) >> 1;
          if (pos[m]! < x) l = m + 1;
          else r = m;
        }
        return l;
      };
      const hourMm = per / 24;
      const lineIn = (a: number, b: number) => {
        const i = near(a);
        return pos[i] !== undefined && pos[i]! >= a && pos[i]! <= b ? pos[i]! : null;
      };
      const ways: Record<string, (h: { lo: number; hi: number }) => number | null> = {
        through: (h) => lineIn(h.lo - 0.05, h.hi + 0.05),
        before: (h) => {
          const i = near(h.lo + 0.05) - 1;
          return i >= 0 && h.lo - pos[i]! < hourMm ? pos[i]! : null;
        },
        after: (h) => lineIn(h.hi - 0.05, h.hi + hourMm),
        middle: (h) => (h.lo + h.hi) / 2,
      };
      const tries: { way: string; R: number; c0: number; shift: number }[] = [];
      for (const [way, fn] of Object.entries(ways)) {
        let sx = 0,
          sy = 0,
          n = 0;
        for (const h of hrs) {
          const p = fn(h);
          if (p == null) continue;
          const f = h.h / 24 - c1 * p;
          sx += Math.cos(2 * Math.PI * f);
          sy += Math.sin(2 * Math.PI * f);
          n++;
        }
        if (n < Math.max(3, hrs.length * 0.6)) continue;
        const R = Math.hypot(sx, sy) / n,
          frac = (((Math.atan2(sy, sx) / (2 * Math.PI)) % 1) + 1) % 1;
        const cc = frac + Math.round(c0 - frac); // the day nearest to what the dates say
        tries.push({ way, R, c0: cc, shift: (cc - c0) * 24 });
      }
      const ok = tries.filter((x) => x.R > 0.95).sort((a, b) => Math.abs(a.shift) - Math.abs(b.shift));
      if (ok.length) {
        c0 = ok[0]!.c0;
        hours = { labels: hrs.length, way: ok[0]!.way };
      }
    }
    time = { c0, c1 };
  }
  return { km, time, hours };
}

/** km at a position across, or null without a km axis. */
export function kmAt(ax: Axes, a: number): number | null {
  const k = ax.km;
  if (!k) return null;
  if (k.line) return k.line.c0 + k.line.c1 * a;
  const p = k.pieces!;
  let i = 1;
  while (i < p.length - 1 && p[i]![0] < a) i++;
  const [x0, v0] = p[i - 1]!,
    [x1, v1] = p[i]!;
  return v0 + ((v1 - v0) * (a - x0)) / (x1 - x0);
}

/** The day (since 1970, with the time as a fraction) at a position along time, or null. */
export const dayAt = (ax: Axes, pos: number): number | null => (ax.time ? ax.time.c0 + ax.time.c1 * pos : null);
