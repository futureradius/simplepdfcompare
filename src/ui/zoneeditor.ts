// The editor of one Plan's zones in the view (ADR 0002): Header and Footer as thick blue lines
// with shaded bands, Bereiche and axis zones as shaded boxes with a name tag, their size in mm,
// a × bubble (delete) and a ⇕ bubble (over the whole length). The clipper's controls: white
// square handles on the selected zone, crosshair on empty Plan, move inside, resize arrows on
// edges, a press that moves under 4 px is a click, the amber Snap guide, Alt drags freely.
// A left drag edits; panning is the view's business (right or middle button).

import type { Axis, Box } from "../compare/objects";
import {
  bandBoxes,
  dragZone,
  effectiveBox,
  hitTest,
  isClick,
  lengthOf,
  newZone,
  sizeText,
  toggleFull,
  zoneLabel,
  type Handle,
  type PageMm,
  type PlanZones,
  type Point,
  type Zone,
  type ZoneKind,
} from "../zones/model";
import { snapBox, snapLine, type Guide, type SegmentIndex } from "../zones/snap";
import type { Editor, ViewPort } from "./planview";

const BLUE = "#2563eb";
const AMBER = "#f59e0b";
const RED = "#e5484d";
const GREY = "#6a7180";
/** The grab distance for edges and corners, CSS px (as in the clipper). */
const GRAB_PX = 8;
/** The grab distance for the Header and Footer lines, CSS px. */
const LINE_GRAB_PX = 7;
/** Snap reaches this far, CSS px. */
const SNAP_PX = 8;
const MIN_NEW_MM = 1;

const CURSOR: Record<Handle, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
  move: "move",
  new: "crosshair",
};

const HANDLE_POSITIONS: [Handle, number, number][] = [
  ["nw", 0, 0],
  ["n", 0.5, 0],
  ["ne", 1, 0],
  ["e", 1, 0.5],
  ["se", 1, 1],
  ["s", 0.5, 1],
  ["sw", 0, 1],
  ["w", 0, 0.5],
];

type Line = "header" | "footer";

type Drag =
  | { kind: "line"; which: Line }
  | { kind: "zone"; id: number; handle: Handle; start: Box; stored: Box; from: Point; screen: Point; pending: boolean }
  | { kind: "new"; from: Point; screen: Point; pending: boolean; zoneKind: ZoneKind };

interface Hot {
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  act: () => void;
}

export interface GhostZone {
  box: Box;
  label: string;
}

export interface ZoneEditorHost {
  axis(): Axis;
  page: PageMm;
  /** The Snap index if it is built; asks for it to be built (once) while undefined. */
  snapIndex(): SegmentIndex | undefined;
  /** Lines across the Plan that the Header and Footer lines snap to, along the Time direction. */
  across(): readonly number[];
  /** The kind a new zone gets. */
  drawKind(): ZoneKind;
  /** The Old Plan's zones, shown hatched on the New Plan. */
  ghosts(): GhostZone[];
  /** The zones changed (`committed` once a drag is over or a bubble was used) or the selection did. */
  changed(committed: boolean): void;
}

const num = (v: number) => Math.round(v).toLocaleString("de-DE");

export class ZoneEditor implements Editor {
  pz: PlanZones = { header: 0, footer: 0, zones: [] };
  selected: number | undefined;
  private drag: Drag | undefined;
  private temp: { box: Box; kind: ZoneKind } | undefined;
  private guides: { pos: number; line: boolean; g?: Guide }[] = [];
  private hot: Hot[] = [];
  private hatch: CanvasPattern | undefined;
  private nextId = 1;

  constructor(private readonly host: ZoneEditorHost) {}

  /** The bubbles drawn last time, in view px (for the e2e tests). */
  hotAreas(): { name: string; x: number; y: number; w: number; h: number }[] {
    return this.hot.map(({ name, x, y, w, h }) => ({ name, x, y, w, h }));
  }

  /** A fresh id for a zone. */
  newId(): number {
    return this.nextId++;
  }

  // ---- State ----------------------------------------------------------------

  set(pz: PlanZones): void {
    this.pz = pz;
    for (const z of pz.zones) this.nextId = Math.max(this.nextId, z.id + 1);
    if (this.selected !== undefined && !pz.zones.some((z) => z.id === this.selected)) this.selected = undefined;
  }

  select(id: number | undefined): void {
    this.selected = id;
    this.host.changed(false);
  }

  deleteSelected(): void {
    if (this.selected === undefined) return;
    this.removeZone(this.selected);
  }

  removeZone(id: number): void {
    this.pz = { ...this.pz, zones: this.pz.zones.filter((z) => z.id !== id) };
    if (this.selected === id) this.selected = undefined;
    this.host.changed(true);
  }

  private replace(id: number, f: (z: Zone) => Zone): void {
    this.pz = { ...this.pz, zones: this.pz.zones.map((z) => (z.id === id ? f(z) : z)) };
  }

  /** The area key `F` shows: the selected zone, else every zone (and none: the whole Plan). */
  focusBox(): Box | undefined {
    const axis = this.host.axis();
    const zs = this.selected === undefined ? this.pz.zones : this.pz.zones.filter((z) => z.id === this.selected);
    if (!zs.length) return undefined;
    const boxes = zs.map((z) => effectiveBox(z, axis, this.host.page));
    return {
      x0: Math.min(...boxes.map((b) => b.x0)),
      y0: Math.min(...boxes.map((b) => b.y0)),
      x1: Math.max(...boxes.map((b) => b.x1)),
      y1: Math.max(...boxes.map((b) => b.y1)),
    };
  }

  /** All zones as boxes, for the minimap. */
  boxes(): Box[] {
    const axis = this.host.axis();
    const [h, f] = bandBoxes(this.pz, axis, this.host.page);
    return [...(h ? [h] : []), ...(f ? [f] : []), ...this.pz.zones.map((z) => effectiveBox(z, axis, this.host.page))];
  }

  // ---- Geometry helpers -----------------------------------------------------

  private along(p: Point): number {
    return this.host.axis() === "y" ? p.y : p.x;
  }

  /** Handles a full-length zone cannot use: the ones along the Time direction. */
  private restrict(h: Handle, z: Zone): Handle {
    if (!z.full || h === "move" || h === "new") return h;
    const drop = this.host.axis() === "y" ? /[ns]/g : /[ew]/g;
    return (h.replace(drop, "") || "move") as Handle;
  }

  private lineScreen(which: Line, vp: ViewPort): number {
    const t = which === "header" ? this.pz.header : this.pz.footer;
    const p = this.host.axis() === "y" ? vp.toScreen(0, t) : vp.toScreen(t, 0);
    return this.host.axis() === "y" ? p.y : p.x;
  }

  private hit(mm: Point, screen: Point, vp: ViewPort): { t: "bubble"; hot: Hot } | { t: "line"; which: Line } | { t: "zone"; id: number; handle: Handle } | undefined {
    for (let i = this.hot.length - 1; i >= 0; i--) {
      const h = this.hot[i]!;
      if (screen.x >= h.x && screen.x <= h.x + h.w && screen.y >= h.y && screen.y <= h.y + h.h) return { t: "bubble", hot: h };
    }
    const axis = this.host.axis(),
      page = this.host.page,
      tol = GRAB_PX / vp.zoom;
    const sel = this.pz.zones.find((z) => z.id === this.selected);
    if (sel) {
      const h = this.restrict(hitTest(effectiveBox(sel, axis, page), mm, tol), sel);
      if (h !== "new" && h !== "move") return { t: "zone", id: sel.id, handle: h };
    }
    const cross = axis === "y" ? screen.y : screen.x;
    for (const which of ["header", "footer"] as const) if (Math.abs(this.lineScreen(which, vp) - cross) <= LINE_GRAB_PX) return { t: "line", which };
    const inside = (z: Zone) => {
      const b = effectiveBox(z, axis, page);
      return mm.x >= b.x0 && mm.x <= b.x1 && mm.y >= b.y0 && mm.y <= b.y1;
    };
    if (sel && inside(sel)) return { t: "zone", id: sel.id, handle: "move" };
    for (let i = this.pz.zones.length - 1; i >= 0; i--) if (inside(this.pz.zones[i]!)) return { t: "zone", id: this.pz.zones[i]!.id, handle: "move" };
    return undefined;
  }

  // ---- Editor ---------------------------------------------------------------

  cursor(mm: Point, screen: Point, vp: ViewPort): string {
    const h = this.hit(mm, screen, vp);
    if (!h) return "crosshair";
    if (h.t === "bubble") return "pointer";
    if (h.t === "line") return this.host.axis() === "y" ? "ns-resize" : "ew-resize";
    return CURSOR[h.handle];
  }

  down(mm: Point, screen: Point, _e: PointerEvent, vp: ViewPort): boolean {
    const h = this.hit(mm, screen, vp);
    if (h?.t === "bubble") {
      h.hot.act();
      return false;
    }
    if (h?.t === "line") {
      this.drag = { kind: "line", which: h.which };
      return true;
    }
    if (h?.t === "zone") {
      const z = this.pz.zones.find((o) => o.id === h.id)!;
      if (this.selected !== h.id) this.select(h.id);
      this.drag = { kind: "zone", id: h.id, handle: h.handle, start: effectiveBox(z, this.host.axis(), this.host.page), stored: z.box, from: mm, screen, pending: true };
      return true;
    }
    this.drag = { kind: "new", from: mm, screen, pending: true, zoneKind: this.host.drawKind() };
    return true;
  }

  move(mm: Point, screen: Point, e: PointerEvent, vp: ViewPort): void {
    const d = this.drag;
    if (!d) return;
    const axis = this.host.axis(),
      page = this.host.page;
    if (d.kind === "line") {
      const len = lengthOf(page, axis);
      let t = Math.min(len, Math.max(0, this.along(mm)));
      this.guides = [];
      if (!e.altKey) {
        const s = snapLine(this.host.across(), t, SNAP_PX / vp.zoom);
        if (s !== t) this.guides = [{ pos: s, line: true }];
        t = s;
      }
      t = Math.round(t * 100) / 100;
      this.pz = d.which === "header" ? { ...this.pz, header: Math.min(t, this.pz.footer) } : { ...this.pz, footer: Math.max(t, this.pz.header) };
      this.host.changed(false);
      return;
    }
    if (d.pending) {
      if (isClick(d.screen, screen)) return;
      d.pending = false;
      this.host.snapIndex(); // the Snap index is built on first use
    }
    const index = e.altKey ? undefined : this.host.snapIndex();
    const tol = SNAP_PX / vp.zoom;
    const keep = d.kind === "zone" ? this.keepOf(d.id, d.stored) : undefined;
    const raw = dragZone(d.kind === "zone" ? d.start : { x0: d.from.x, y0: d.from.y, x1: d.from.x, y1: d.from.y }, d.kind === "zone" ? d.handle : "new", d.from, mm, page, axis, keep);
    let box = raw;
    this.guides = [];
    if (index) {
      const handle: Handle = d.kind === "zone" ? this.restrictId(d.id, d.handle) : ((mm.y >= d.from.y ? "s" : "n") + (mm.x >= d.from.x ? "e" : "w")) as Handle;
      const r = snapBox(raw, handle, index, tol, vp.visible());
      box = {
        x0: Math.max(0, r.box.x0),
        y0: Math.max(0, r.box.y0),
        x1: Math.min(page.width, r.box.x1),
        y1: Math.min(page.height, r.box.y1),
      };
      if (keep) box = axis === "y" ? { ...box, y0: keep.y0, y1: keep.y1 } : { ...box, x0: keep.x0, x1: keep.x1 };
      this.guides = r.guides.map((g) => ({ pos: g.pos, line: false, g }));
    }
    if (d.kind === "zone") {
      // A full-length zone stores only its way across; its length stays remembered.
      this.replace(d.id, (z) => ({ ...z, box: z.full ? (axis === "y" ? { ...box, y0: z.box.y0, y1: z.box.y1 } : { ...box, x0: z.box.x0, x1: z.box.x1 }) : box }));
    } else this.temp = { box, kind: d.zoneKind };
    this.host.changed(false);
  }

  private keepOf(id: number, stored: Box): Box | undefined {
    return this.pz.zones.find((z) => z.id === id)?.full ? stored : undefined;
  }

  private restrictId(id: number, h: Handle): Handle {
    const z = this.pz.zones.find((o) => o.id === id);
    return z ? this.restrict(h, z) : h;
  }

  up(_mm: Point, _screen: Point, _e: PointerEvent, _vp: ViewPort): void {
    const d = this.drag;
    this.drag = undefined;
    this.guides = [];
    if (!d) return;
    if (d.kind === "line") return this.host.changed(true);
    if (d.kind === "zone") {
      if (!d.pending) this.host.changed(true);
      else this.host.changed(false);
      return;
    }
    const t = this.temp;
    this.temp = undefined;
    if (d.pending || !t || t.box.x1 - t.box.x0 < MIN_NEW_MM || t.box.y1 - t.box.y0 < MIN_NEW_MM) {
      // A click on empty Plan deselects.
      this.selected = undefined;
      return this.host.changed(false);
    }
    const z = newZone(this.newId(), t.kind, t.box);
    this.pz = { ...this.pz, zones: [...this.pz.zones, z] };
    this.selected = z.id;
    this.host.changed(true);
  }

  // ---- Drawing --------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, vp: ViewPort): void {
    this.hot = [];
    const axis = this.host.axis(),
      page = this.host.page;
    const rectOf = (b: Box) => {
      const a = vp.toScreen(b.x0, b.y0),
        c = vp.toScreen(b.x1, b.y1);
      return { x: a.x, y: a.y, w: c.x - a.x, h: c.y - a.y };
    };
    const onScreen = (r: { x: number; y: number; w: number; h: number }) => r.x + r.w >= 0 && r.y + r.h >= 0 && r.x <= vp.cssW && r.y <= vp.cssH;
    ctx.save();
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = "middle";

    // The Old Plan's zones, hatched, on the New Plan.
    for (const g of this.host.ghosts()) this.drawGhost(ctx, rectOf(g.box), g.label, onScreen);

    // Header and Footer bands.
    const [hb, fb] = bandBoxes(this.pz, axis, page);
    for (const b of [hb, fb]) {
      if (!b) continue;
      const r = rectOf(b);
      if (!onScreen(r)) continue;
      ctx.fillStyle = "rgba(37, 99, 235, 0.16)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }

    // Zones: the selected one last, on top.
    const order = [...this.pz.zones.filter((z) => z.id !== this.selected), ...this.pz.zones.filter((z) => z.id === this.selected)];
    for (const z of order) this.drawZone(ctx, vp, z, rectOf(effectiveBox(z, axis, page)), onScreen);
    if (this.temp) {
      const r = rectOf(this.temp.box);
      ctx.fillStyle = "rgba(245, 158, 11, 0.2)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([]);
    }

    // The two lines are always shown, even when their zone is deleted.
    for (const which of ["header", "footer"] as const) this.drawLine(ctx, vp, which);
    this.drawGuides(ctx, vp);
    ctx.restore();
  }

  private drawLine(ctx: CanvasRenderingContext2D, vp: ViewPort, which: Line): void {
    const axis = this.host.axis(),
      page = this.host.page;
    const t = which === "header" ? this.pz.header : this.pz.footer;
    const len = lengthOf(page, axis);
    const across = axis === "y" ? page.width : page.height;
    const a = axis === "y" ? vp.toScreen(-0.02 * across, t) : vp.toScreen(t, -0.02 * across);
    const b = axis === "y" ? vp.toScreen(1.02 * across, t) : vp.toScreen(t, 1.02 * across);
    const snapped = this.guides.some((g) => g.line) && this.drag?.kind === "line" && this.drag.which === which;
    ctx.strokeStyle = snapped ? AMBER : BLUE;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    // The name tag, with its × bubble while the zone exists.
    const deleted = which === "header" ? t <= 0 : t >= len;
    const size = which === "header" ? t : len - t;
    const text = deleted ? (which === "header" ? "Kopf" : "Fuß") : `${which === "header" ? "Kopf" : "Fuß"} · ${num(size)} mm`;
    // The tag sits on the zone's side of the line, and only while the zone (or the edge line) is in view.
    const pos = axis === "y" ? a.y : a.x,
      extent = axis === "y" ? vp.cssH : vp.cssW;
    const shown = deleted ? pos >= 0 && pos <= extent : which === "header" ? pos >= 0 : pos <= extent;
    if (!shown) return;
    const inside = (which === "header") !== deleted;
    const w = ctx.measureText(text).width + 10 + (deleted ? 0 : 24);
    // The tag sits at the Plan's own edge, in view.
    const edge = vp.toScreen(0, 0);
    let x = Math.max(axis === "y" ? edge.x : 0, 0) + 8,
      y = Math.max(axis === "y" ? 0 : edge.y, 0) + 8;
    if (axis === "y") y = Math.min(Math.max(inside ? pos - 26 : pos + 6, 6), vp.cssH - 26);
    else x = Math.min(Math.max(inside ? pos - w - 6 : pos + 6, 6), vp.cssW - w - 6);
    this.drawTag(ctx, text, x, y, snapped ? AMBER : BLUE, deleted ? undefined : { glyph: "×", title: which === "header" ? "Kopf löschen" : "Fuß löschen", act: () => this.removeLine(which) });
  }

  removeLine(which: Line): void {
    const len = lengthOf(this.host.page, this.host.axis());
    this.pz = which === "header" ? { ...this.pz, header: 0 } : { ...this.pz, footer: len };
    this.host.changed(true);
  }

  private drawZone(ctx: CanvasRenderingContext2D, vp: ViewPort, z: Zone, r: { x: number; y: number; w: number; h: number }, onScreen: (r: { x: number; y: number; w: number; h: number }) => boolean): void {
    if (!onScreen(r)) return;
    const sel = z.id === this.selected;
    const axisZone = z.kind !== "area";
    ctx.fillStyle = axisZone ? "rgba(229, 72, 77, 0.16)" : "rgba(37, 99, 235, 0.16)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = axisZone ? RED : BLUE;
    ctx.lineWidth = sel ? 2 : 1.5;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    if (sel) {
      ctx.fillStyle = "#fff";
      ctx.lineWidth = 1.5;
      for (const [h, fx, fy] of HANDLE_POSITIONS) {
        if (this.restrict(h, z) !== h) continue; // a full-length zone has no handles along its length
        const x = r.x + fx * r.w,
          y = r.y + fy * r.h;
        ctx.fillRect(x - 5, y - 5, 10, 10);
        ctx.strokeRect(x - 5, y - 5, 10, 10);
      }
    }
    // The name tag stays in view at the top-left of the part that is visible.
    const label = `${zoneLabel(this.pz.zones, z)} · ${sizeText(effectiveBox(z, this.host.axis(), this.host.page), this.host.axis())}`;
    const x = Math.max(r.x, 0) + 4,
      y = Math.max(r.y, 0) + 4;
    if (y > r.y + r.h - 6 || x > r.x + r.w - 6) return;
    this.drawTag(ctx, label, x, y, axisZone ? RED : BLUE, { glyph: "×", title: "Bereich löschen", act: () => this.removeZone(z.id) }, { glyph: "⇕", title: "Über die ganze Länge", act: () => this.toggleFull(z.id), on: z.full });
    void vp;
  }

  private toggleFull(id: number): void {
    this.replace(id, toggleFull);
    this.host.changed(true);
  }

  /** A tag with the name and size, and bubbles after the text. Registers the bubbles as hot areas. */
  private drawTag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string, ...bubbles: ({ glyph: string; title: string; act: () => void; on?: boolean } | undefined)[]): void {
    const real = bubbles.filter((b): b is NonNullable<typeof b> => !!b);
    const w = ctx.measureText(text).width + 10 + real.length * 24;
    const h = 20;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 4);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(text, x + 5, y + h / 2 + 0.5);
    let bx = x + 5 + ctx.measureText(text).width + 6;
    for (const b of real) {
      ctx.fillStyle = b.on ? AMBER : "#fff";
      ctx.beginPath();
      ctx.arc(bx + 8, y + h / 2, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = colour;
      ctx.font = '700 12px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = "center";
      ctx.fillText(b.glyph, bx + 8, y + h / 2 + 0.5);
      ctx.textAlign = "start";
      ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
      this.hot.push({ x: bx, y: y + 2, w: 16, h: 16, name: b.title, act: b.act });
      bx += 24;
    }
  }

  private drawGhost(ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }, label: string, onScreen: (r: { x: number; y: number; w: number; h: number }) => boolean): void {
    if (!onScreen(r)) return;
    this.hatch ??= hatchPattern(ctx);
    if (this.hatch) {
      ctx.fillStyle = this.hatch;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = GREY;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.setLineDash([]);
    const x = Math.max(r.x, 0) + 4,
      bottom = Math.min(r.y + r.h, Number.POSITIVE_INFINITY);
    const y = Math.max(bottom - 24, Math.max(r.y, 0) + 4);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    const w = ctx.measureText(label).width + 10;
    ctx.fillRect(x, y, w, 18);
    ctx.fillStyle = GREY;
    ctx.fillText(label, x + 5, y + 9.5);
  }

  private drawGuides(ctx: CanvasRenderingContext2D, vp: ViewPort): void {
    if (!this.guides.length) return;
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    const axis = this.host.axis();
    for (const g of this.guides) {
      ctx.beginPath();
      // A line across the whole view: for a Header or Footer line, and for an edge snapped to a drawn line.
      const vertical = g.line ? axis === "x" : g.g!.vertical;
      if (vertical) {
        const x = vp.toScreen(g.pos, 0).x;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, vp.cssH);
      } else {
        const y = vp.toScreen(0, g.pos).y;
        ctx.moveTo(0, y);
        ctx.lineTo(vp.cssW, y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
}

/** Diagonal hatching on a transparent ground, the sign for "where it lay in the Old Plan". */
function hatchPattern(ctx: CanvasRenderingContext2D): CanvasPattern | undefined {
  const c = document.createElement("canvas");
  c.width = c.height = 10;
  const g = c.getContext("2d")!;
  g.strokeStyle = "rgba(106, 113, 128, 0.55)";
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(-1, 11);
  g.lineTo(11, -1);
  g.moveTo(-1, 1);
  g.lineTo(1, -1);
  g.moveTo(9, 11);
  g.lineTo(11, 9);
  g.stroke();
  return ctx.createPattern(c, "repeat") ?? undefined;
}
