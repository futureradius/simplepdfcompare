// The minimap (ADR 0009): the whole Plan, small, floating over the bottom-right corner of the
// view. Shows the visible area (red frame) and the zones (blue boxes). Hidden while the whole
// Plan is in view, folds with ×; a click centres the view there, dragging pans. In "Vergleich"
// it shows the comparison frame (both Plans) and the Places on a layer of their own.
// Adapted from simplepdfclipper's minimap.ts.

import type { Box } from "../compare/objects";
import { span } from "./spans";

/** Largest share of the view's height and width the minimap may take. */
export const MINIMAP_SHARE = 1 / 3;

/** CSS size of the minimap for a Plan in a view of the given size: the whole Plan, within both limits. */
export function minimapSize(planW: number, planH: number, viewW: number, viewH: number): { width: number; height: number; scale: number } {
  const scale = Math.min((viewH * MINIMAP_SHARE) / planH, (viewW * MINIMAP_SHARE) / planW);
  return { width: planW * scale, height: planH * scale, scale };
}

/** A point in mm, also the top left corner of what the minimap shows (the comparison frame may start before 0). */
export interface Origin {
  x: number;
  y: number;
}
const ZERO: Origin = { x: 0, y: 0 };

/** True if the view shows the whole Plan (then the minimap would only repeat it). */
export function showsWholePlan(visible: Box, planW: number, planH: number, origin: Origin = ZERO): boolean {
  const tol = 1e-6 * Math.max(planW, planH); // float rounding only
  const { x, y } = origin;
  return visible.x0 <= x + tol && visible.y0 <= y + tol && visible.x1 >= x + planW - tol && visible.y1 >= y + planH - tol;
}

/** Where a point of the minimap (CSS px from its top left) lies, in mm: a click centres the view there. */
export const minimapToMm = (p: { x: number; y: number }, scale: number, origin: Origin = ZERO) => ({ x: origin.x + p.x / scale, y: origin.y + p.y / scale });

/** Places on the minimap are at least this big in every direction, CSS px (ADR 0009). */
export const PLACE_MIN_PX = 3;

/**
 * A Place on the minimap (ADR 0009): its own shape (its marks, outlined `strokePx` wide so
 * that it is at least 3 px in every direction; `box` is how far that reaches), or a circle
 * 3 px across when it is too small for a shape. Red if it has any Added part, yellow if
 * only Removed. In CSS px from the minimap's top left.
 */
export type MinimapShape =
  | { type: "dot"; no: number; x: number; y: number; d: number; colour: "added" | "removed" }
  | { type: "shape"; no: number; box: Box; strokePx: number; colour: "added" | "removed" };

export function minimapShapes(
  spots: readonly { no: number; box: Box; added: boolean }[],
  scale: number,
  origin: Origin = ZERO,
): MinimapShape[] {
  return spots.map((p) => {
    const colour = p.added ? "added" : "removed";
    const b = { x0: (p.box.x0 - origin.x) * scale, y0: (p.box.y0 - origin.y) * scale, x1: (p.box.x1 - origin.x) * scale, y1: (p.box.y1 - origin.y) * scale };
    if (Math.max(b.x1 - b.x0, b.y1 - b.y0) < PLACE_MIN_PX) return { type: "dot", no: p.no, x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, d: PLACE_MIN_PX, colour };
    const r = PLACE_MIN_PX / 2;
    return { type: "shape", no: p.no, box: { x0: b.x0 - r, y0: b.y0 - r, x1: b.x1 + r, y1: b.y1 + r }, strokePx: PLACE_MIN_PX, colour };
  });
}

export interface MinimapElements {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  /** Holds one box per zone. */
  zones: HTMLElement;
  viewBox: HTMLElement;
  collapse: HTMLButtonElement;
  expand: HTMLButtonElement;
  /** A layer over the picture for the Places ("Vergleich"). */
  places?: HTMLCanvasElement;
}

/** Paints the Places layer; the context works in CSS px from the minimap's top left. */
export type MinimapPainter = (ctx: CanvasRenderingContext2D, scale: number, origin: Origin) => void;

export class Minimap {
  private plan: { width: number; height: number } | undefined;
  private origin: Origin = ZERO;
  private painter: MinimapPainter | undefined;
  /** The Places layer is to be painted again, once the minimap shows. */
  private placesDirty = false;
  private scale = 1;
  private collapsed = false;
  private whole = false;
  private boxes: Box[] = [];
  private view: Box | undefined;
  private dragging = false;

  constructor(
    private readonly el: MinimapElements,
    /** The view whose size limits the minimap. */
    private readonly area: HTMLElement,
    private readonly centerOn: (p: { x: number; y: number }) => void,
  ) {
    new ResizeObserver(() => this.layout()).observe(area);
    el.collapse.addEventListener("click", () => this.setCollapsed(true));
    el.expand.addEventListener("click", () => this.setCollapsed(false));
    const surface = el.canvas.parentElement!;
    surface.addEventListener("pointerdown", (e) => {
      if (!this.plan || e.button !== 0) return;
      this.dragging = true;
      surface.setPointerCapture(e.pointerId);
      this.centerOn(this.point(e));
      e.preventDefault();
    });
    surface.addEventListener("pointermove", (e) => {
      if (this.dragging) this.centerOn(this.point(e));
    });
    const stop = () => (this.dragging = false);
    surface.addEventListener("pointerup", stop);
    surface.addEventListener("pointercancel", stop);
  }

  /**
   * Shows another Plan: its picture. The minimap starts expanded. `origin` is the mm of the
   * picture's top left corner (the comparison frame can start before the Old Plan).
   */
  setPlan(widthMm: number, heightMm: number, picture: CanvasImageSource & { width: number; height: number }, origin: Origin = ZERO): void {
    this.plan = { width: widthMm, height: heightMm };
    this.origin = origin;
    this.collapsed = false;
    const c = this.el.canvas;
    c.width = picture.width;
    c.height = picture.height;
    c.getContext("2d")!.drawImage(picture, 0, 0);
    this.layout();
  }

  /**
   * Paints the Places layer again (or clears it), e.g. after the filter or hiding changed. Only
   * while the minimap shows: hidden, it is painted when it shows again.
   */
  setPlaces(painter: MinimapPainter | undefined): void {
    this.painter = painter;
    this.paintPlaces();
  }

  private paintPlaces(): void {
    const c = this.el.places;
    if (!c || !this.plan) return;
    if (this.el.root.hidden) {
      this.placesDirty = true;
      return;
    }
    this.placesDirty = false;
    const dpr = window.devicePixelRatio || 1;
    const w = this.plan.width * this.scale,
      h = this.plan.height * this.scale;
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    span("minimap Places", () => this.painter?.(ctx, this.scale, this.origin));
  }

  setZones(boxes: Box[]): void {
    this.boxes = boxes;
    const host = this.el.zones;
    while (host.children.length > boxes.length) host.lastElementChild!.remove();
    while (host.children.length < boxes.length) host.append(Object.assign(document.createElement("div"), { className: "region-box" }));
    this.placeBoxes();
  }

  setView(visible: Box): void {
    this.view = visible;
    if (this.plan) this.whole = showsWholePlan(visible, this.plan.width, this.plan.height, this.origin);
    this.updateVisibility();
    this.placeBoxes();
  }

  private setCollapsed(c: boolean): void {
    this.collapsed = c;
    this.updateVisibility();
  }

  private updateVisibility(): void {
    this.el.root.hidden = !this.plan || this.collapsed || this.whole;
    this.el.expand.hidden = !this.plan || !this.collapsed || this.whole;
    if (!this.el.root.hidden && this.placesDirty) this.paintPlaces();
  }

  private layout(): void {
    if (!this.plan) return;
    const s = minimapSize(this.plan.width, this.plan.height, this.area.clientWidth, this.area.clientHeight);
    this.scale = s.scale;
    this.el.canvas.style.width = `${s.width}px`;
    this.el.canvas.style.height = `${s.height}px`;
    this.placeBoxes();
    this.paintPlaces();
  }

  private point(e: MouseEvent): { x: number; y: number } {
    const r = this.el.canvas.getBoundingClientRect();
    return minimapToMm({ x: e.clientX - r.left, y: e.clientY - r.top }, this.scale, this.origin);
  }

  private place(el: HTMLElement, r: Box): void {
    if (!this.plan) return;
    const s = this.scale,
      w = this.plan.width * s,
      h = this.plan.height * s,
      { x: ox, y: oy } = this.origin;
    const x0 = Math.min(w, Math.max(0, (r.x0 - ox) * s)),
      y0 = Math.min(h, Math.max(0, (r.y0 - oy) * s));
    el.style.left = `${x0}px`;
    el.style.top = `${y0}px`;
    el.style.width = `${Math.max(3, Math.min((r.x1 - ox) * s, w) - x0)}px`;
    el.style.height = `${Math.max(3, Math.min((r.y1 - oy) * s, h) - y0)}px`;
  }

  private placeBoxes(): void {
    this.boxes.forEach((b, i) => this.place(this.el.zones.children[i] as HTMLElement, b));
    if (this.view) this.place(this.el.viewBox, this.view);
  }
}
