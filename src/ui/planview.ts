// The zoomable view of one Plan, for the setup tabs (ADR 0002, ADR 0009). Adapted from
// simplepdfclipper's viewer.ts: the wheel zooms around the pointer, the right or middle
// button pans, and a left press goes to the editor of the zones.
// This is the deliberate difference from the clipper, where a left drag pans (ADR 0002).
//
// Rendering works like a map: while zooming or panning, the pictures at hand are scaled (the
// overview as a base layer, plus recent sharp renders); once the view rests, the visible area
// is rendered sharp in one pass by the Plan's worker (ADR 0004).

import type { Box } from "../compare/objects";
import type { Point } from "../zones/model";

export interface ViewPort {
  zoom: number;
  cssW: number;
  cssH: number;
  visible(): Box;
  toScreen(x: number, y: number): Point;
}

/** What a left press does in the view: the zones' editor. */
export interface Editor {
  /** The CSS cursor over `mm`. */
  cursor(mm: Point, screen: Point, vp: ViewPort): string;
  /** A left press: true if the editor takes it (a drag follows until `up`). */
  down(mm: Point, screen: Point, e: PointerEvent, vp: ViewPort): boolean;
  move(mm: Point, screen: Point, e: PointerEvent, vp: ViewPort): void;
  up(mm: Point, screen: Point, e: PointerEvent, vp: ViewPort): void;
  /** Draws over the Plan; the context works in CSS px. */
  draw(ctx: CanvasRenderingContext2D, vp: ViewPort): void;
}

/** A picture of a Plan, and a way to render parts of it sharp. */
export interface Source {
  widthMm: number;
  heightMm: number;
  overview: CanvasImageSource & { width: number; height: number };
  render(rect: Box, pxPerMm: number): Promise<ImageBitmap>;
}

/**
 * A second Plan laid over the subject and multiplied with it (white stays white, ink stays ink),
 * so that both show at once: "Versatz" lays the New Plan over the Old one. `shift` is where its
 * page lies in the subject's frame, mm; it may change at any time (call PlanView.changed()).
 */
export interface Partner extends Source {
  shift(): Point;
}

/** One Plan to show: its overview picture, a way to render parts of it, and its editor. */
export interface Subject extends Source {
  editor: Editor;
  partner?: Partner;
}

interface Layer {
  bitmap: ImageBitmap;
  rect: Box;
  pxPerMm: number;
}

interface SubjectState {
  layers: Layer[];
  /** The partner's sharp pictures, each in the partner's own page mm. */
  partnerLayers: Layer[];
  view?: { cx: number; cy: number; zoom: number };
}

/** CSS pixels per mm at 100 % (96 dpi). */
export const PX_PER_MM_100 = 96 / 25.4;
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 64;
const RENDER_DELAY_MS = 120;
const MAX_RENDER_PIXELS = 12_000_000;
const KEEP_LAYERS = 4;
const KEEP_PIXELS = 3 * MAX_RENDER_PIXELS;
const BACKGROUND = "#e9e9ec";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const intersect = (a: Box, b: Box): Box | null => {
  const r = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
  return r.x0 < r.x1 && r.y0 < r.y1 ? r : null;
};
const covers = (o: Box, i: Box) => o.x0 <= i.x0 && o.y0 <= i.y0 && o.x1 >= i.x1 && o.y1 >= i.y1;
const area = (r: Box) => (r.x1 - r.x0) * (r.y1 - r.y0);
const grow = (r: Box, f: number): Box => {
  const dx = (r.x1 - r.x0) * f,
    dy = (r.y1 - r.y0) * f;
  return { x0: r.x0 - dx, y0: r.y0 - dy, x1: r.x1 + dx, y1: r.y1 + dy };
};

export class PlanView {
  private readonly ctx: CanvasRenderingContext2D;
  private subject: Subject | undefined;
  private readonly states = new Map<Subject, SubjectState>();
  private cx = 0;
  private cy = 0;
  private zoom = 1;
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private drag: { mode: "pan" | "edit"; screen: Point; cx: number; cy: number } | undefined;
  private renderTimer: ReturnType<typeof setTimeout> | undefined;
  private rendering = false;
  private renderAgain = false;
  private frame = 0;
  /** Called whenever the visible area changes (minimap, zoom label). */
  onView: (visible: Box) => void = () => {};

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
    canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener("pointerdown", (e) => this.onDown(e));
    canvas.addEventListener("pointermove", (e) => this.onMove(e));
    canvas.addEventListener("pointerup", (e) => this.onUp(e));
    canvas.addEventListener("pointercancel", (e) => this.onUp(e));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault()); // the right button pans
  }

  // ---- Public API -----------------------------------------------------------

  /** Shows a Plan; each Plan keeps its own view (the first time: all of it). Call while visible. */
  show(s: Subject): void {
    if (this.subject === s) {
      this.resize();
      return;
    }
    this.save();
    this.subject = s;
    this.drag = undefined;
    let st = this.states.get(s);
    if (!st) this.states.set(s, (st = { layers: [], partnerLayers: [] }));
    this.measure();
    if (st.view) ({ cx: this.cx, cy: this.cy, zoom: this.zoom } = st.view);
    else this.fitPlan();
    this.viewUpdated();
  }

  /** Forgets a Plan that is no longer shown (a new file was opened). */
  forget(s: Subject): void {
    const st = this.states.get(s);
    for (const l of [...(st?.layers ?? []), ...(st?.partnerLayers ?? [])]) l.bitmap.close();
    this.states.delete(s);
    if (this.subject === s) this.subject = undefined;
  }

  /** What the subject shows changed (the partner's shift): redraws, and renders what is now uncovered once the view rests. */
  changed(): void {
    this.viewUpdated();
  }

  /** Redraws on the next frame. */
  requestDraw(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  get port(): ViewPort {
    return { zoom: this.zoom, cssW: this.cssW, cssH: this.cssH, visible: () => this.visible(), toScreen: (x, y) => this.toScreen(x, y) };
  }

  visible(): Box {
    const hw = this.cssW / 2 / this.zoom,
      hh = this.cssH / 2 / this.zoom;
    return { x0: this.cx - hw, y0: this.cy - hh, x1: this.cx + hw, y1: this.cy + hh };
  }


  fitRect(r: Box, margin = 0.08): void {
    this.measure();
    const w = Math.max(1, r.x1 - r.x0),
      h = Math.max(1, r.y1 - r.y0);
    this.zoom = clamp(Math.min(this.cssW / (w * (1 + 2 * margin)), this.cssH / (h * (1 + 2 * margin))), MIN_ZOOM, MAX_ZOOM);
    this.cx = (r.x0 + r.x1) / 2;
    this.cy = (r.y0 + r.y1) / 2;
    this.viewUpdated();
  }

  /** Key 1: the whole Plan, centred. */
  fitPlan(): void {
    if (this.subject) this.fitRect({ x0: 0, y0: 0, x1: this.subject.widthMm, y1: this.subject.heightMm }, 0.02);
  }

  /** Key 2: the Plan's width fills the view, starting at the top. */
  fitWidth(): void {
    if (!this.subject) return;
    this.measure();
    this.zoom = clamp(this.cssW / (this.subject.widthMm * 1.02), MIN_ZOOM, MAX_ZOOM);
    this.cx = this.subject.widthMm / 2;
    this.cy = this.cssH / 2 / this.zoom;
    this.viewUpdated();
  }

  /** Key 3: 1 mm on paper is 1 mm on screen (at 96 dpi), around the centre of the view. */
  zoomTo100(): void {
    this.zoomAt(this.cssW / 2, this.cssH / 2, PX_PER_MM_100 / this.zoom);
  }

  centerOn(p: Point): void {
    this.cx = p.x;
    this.cy = p.y;
    this.viewUpdated();
  }

  // ---- Coordinates ----------------------------------------------------------

  private toMm(sx: number, sy: number): Point {
    const v = this.visible();
    return { x: v.x0 + sx / this.zoom, y: v.y0 + sy / this.zoom };
  }

  private toScreen(x: number, y: number): Point {
    const v = this.visible();
    return { x: (x - v.x0) * this.zoom, y: (y - v.y0) * this.zoom };
  }

  private local(e: MouseEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private save(): void {
    const st = this.subject && this.states.get(this.subject);
    if (st) st.view = { cx: this.cx, cy: this.cy, zoom: this.zoom };
  }

  // ---- Interaction ----------------------------------------------------------

  private zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.toMm(sx, sy);
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const after = this.toMm(sx, sy);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
    this.viewUpdated();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const p = this.local(e);
    const lines = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * lines * 0.0015));
  }

  private onDown(e: PointerEvent): void {
    if (!this.subject || (e.button !== 0 && e.button !== 1 && e.button !== 2)) return;
    const s = this.local(e);
    const base = { screen: s, cx: this.cx, cy: this.cy };
    if (e.button !== 0) {
      this.drag = { ...base, mode: "pan" };
      this.canvas.style.cursor = "grabbing";
    } else if (this.subject.editor.down(this.toMm(s.x, s.y), s, e, this.port)) {
      this.drag = { ...base, mode: "edit" };
    } else return;
    this.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    this.requestDraw();
  }

  private onMove(e: PointerEvent): void {
    if (!this.subject) return;
    const s = this.local(e);
    const d = this.drag;
    if (!d) {
      this.canvas.style.cursor = this.subject.editor.cursor(this.toMm(s.x, s.y), s, this.port);
      return;
    }
    if (d.mode === "pan") {
      this.cx = d.cx - (s.x - d.screen.x) / this.zoom;
      this.cy = d.cy - (s.y - d.screen.y) / this.zoom;
      this.viewUpdated();
      return;
    }
    this.subject.editor.move(this.toMm(s.x, s.y), s, e, this.port);
    this.requestDraw();
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d || !this.subject) return;
    this.drag = undefined;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    const s = this.local(e);
    if (d.mode === "edit") this.subject.editor.up(this.toMm(s.x, s.y), s, e, this.port);
    this.canvas.style.cursor = this.subject.editor.cursor(this.toMm(s.x, s.y), s, this.port);
    this.requestDraw();
  }

  // ---- Rendering ------------------------------------------------------------

  private resize(): void {
    this.measure();
    this.viewUpdated();
  }

  /** Reads the current size of the view (right after it is shown, the observer has not reported yet). */
  private measure(): void {
    const parent = this.canvas.parentElement!;
    this.dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, parent.clientWidth),
      h = Math.max(1, parent.clientHeight);
    if (w === this.cssW && h === this.cssH && this.canvas.width === Math.round(w * this.dpr)) return;
    this.cssW = w;
    this.cssH = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  private viewUpdated(): void {
    this.requestDraw();
    this.onView(this.visible());
    this.scheduleRender();
  }

  private scheduleRender(): void {
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => void this.renderSharp(), RENDER_DELAY_MS);
  }

  /** Renders the visible area (plus a margin) sharp, unless a sharp enough picture already covers it. */
  private async renderSharp(): Promise<void> {
    const subject = this.subject;
    const st = subject && this.states.get(subject);
    if (!subject || !st || this.cssW <= 1) return;
    if (this.rendering) {
      this.renderAgain = true;
      return;
    }
    this.rendering = true;
    try {
      await this.renderPlane(subject, subject, st.layers, { x: 0, y: 0 });
      const partner = subject.partner;
      if (partner && this.states.has(subject)) await this.renderPlane(subject, partner, st.partnerLayers, partner.shift());
    } finally {
      this.rendering = false;
    }
    if (this.renderAgain) {
      this.renderAgain = false;
      void this.renderSharp();
    }
  }

  /** Renders the part of one Plan that the view shows; the Plan's page lies at `shift` in the view's frame. */
  private async renderPlane(subject: Subject, src: Source, layers: Layer[], shift: Point): Promise<void> {
    const want = this.zoom * this.dpr;
    const overview = src.overview.width / src.widthMm;
    if (want <= overview * 1.01) return; // the overview is sharp enough
    const page: Box = { x0: 0, y0: 0, x1: src.widthMm, y1: src.heightMm };
    const vis = this.visible();
    const need = intersect({ x0: vis.x0 - shift.x, y0: vis.y0 - shift.y, x1: vis.x1 - shift.x, y1: vis.y1 - shift.y }, page);
    if (!need || layers.some((l) => l.pxPerMm >= want * 0.99 && covers(l.rect, need))) return;
    // A margin around the view keeps small pans sharp; shrink it if the picture would be huge.
    let margin = 0.25;
    let rect = intersect(grow(need, margin), page)!;
    while (margin > 0 && area(rect) * want * want > MAX_RENDER_PIXELS) {
      margin = Math.max(0, margin - 0.1);
      rect = intersect(grow(need, margin), page)!;
    }
    const pxPerMm = Math.min(want, Math.sqrt(MAX_RENDER_PIXELS / area(rect)));
    try {
      const bitmap = await src.render(rect, pxPerMm);
      if (!this.states.has(subject)) bitmap.close();
      else {
        // The actual picture size (pixel counts are rounded), so nothing shifts.
        layers.push({ bitmap, rect, pxPerMm: bitmap.width / (rect.x1 - rect.x0) });
        const pixels = () => layers.reduce((n, l) => n + l.bitmap.width * l.bitmap.height, 0);
        while (layers.length > KEEP_LAYERS && pixels() > KEEP_PIXELS) layers.shift()!.bitmap.close();
        this.requestDraw();
      }
    } catch (err) {
      console.warn("render failed", err);
    }
  }

  private draw(): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    const s = this.subject,
      st = s && this.states.get(s);
    if (!s || !st) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    this.drawPlane(ctx, s, st.layers, { x: 0, y: 0 });
    if (s.partner) {
      // The partner is drawn on its own (white page, ink), then multiplied onto the picture.
      const off = this.offscreen();
      const octx = off.getContext("2d")!;
      octx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      octx.clearRect(0, 0, this.cssW, this.cssH);
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = "high";
      this.drawPlane(octx, s.partner, st.partnerLayers, s.partner.shift());
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "multiply";
      ctx.drawImage(off, 0, 0);
      ctx.restore();
    }
    s.editor.draw(ctx, this.port);
  }

  private overlayCanvas: HTMLCanvasElement | undefined;

  /** A canvas of the view's size to draw the partner on. */
  private offscreen(): HTMLCanvasElement {
    const c = (this.overlayCanvas ??= document.createElement("canvas"));
    if (c.width !== this.canvas.width || c.height !== this.canvas.height) {
      c.width = this.canvas.width;
      c.height = this.canvas.height;
    }
    return c;
  }

  /** One Plan: its white page, its overview, and its sharper layers (older first, so the newest wins). */
  private drawPlane(ctx: CanvasRenderingContext2D, src: Source, layers: Layer[], shift: Point): void {
    const tl = this.toScreen(shift.x, shift.y);
    ctx.fillStyle = "#fff";
    ctx.fillRect(tl.x, tl.y, src.widthMm * this.zoom, src.heightMm * this.zoom);
    const vis = this.visible();
    const own: Box = { x0: vis.x0 - shift.x, y0: vis.y0 - shift.y, x1: vis.x1 - shift.x, y1: vis.y1 - shift.y };
    const base: Layer = { bitmap: src.overview as unknown as ImageBitmap, rect: { x0: 0, y0: 0, x1: src.widthMm, y1: src.heightMm }, pxPerMm: src.overview.width / src.widthMm };
    for (const l of [base, ...[...layers].sort((a, b) => a.pxPerMm - b.pxPerMm)]) this.drawLayer(ctx, l, own, shift);
  }

  /** `own`: the visible area in the Plan's own mm; `shift`: where the Plan's page lies in the view's frame. */
  private drawLayer(ctx: CanvasRenderingContext2D, l: Layer, own: Box, shift: Point): void {
    const part = intersect(l.rect, own);
    if (!part) return;
    const d = this.toScreen(part.x0 + shift.x, part.y0 + shift.y);
    ctx.drawImage(
      l.bitmap,
      (part.x0 - l.rect.x0) * l.pxPerMm,
      (part.y0 - l.rect.y0) * l.pxPerMm,
      (part.x1 - part.x0) * l.pxPerMm,
      (part.y1 - part.y0) * l.pxPerMm,
      d.x,
      d.y,
      (part.x1 - part.x0) * this.zoom,
      (part.y1 - part.y0) * this.zoom,
    );
  }
}
