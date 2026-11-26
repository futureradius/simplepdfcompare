// The minimap (ADR 0009): the whole Plan, small, floating over the bottom-right corner of the
// view. Shows the visible area (red frame) and the zones (blue boxes). Hidden while the whole
// Plan is in view, folds with ×; a click centres the view there, dragging pans. No Places in
// this slice. Adapted from simplepdfclipper's minimap.ts.

import type { Box } from "../compare/objects";

/** Largest share of the view's height and width the minimap may take. */
export const MINIMAP_SHARE = 1 / 3;

/** CSS size of the minimap for a Plan in a view of the given size: the whole Plan, within both limits. */
export function minimapSize(planW: number, planH: number, viewW: number, viewH: number): { width: number; height: number; scale: number } {
  const scale = Math.min((viewH * MINIMAP_SHARE) / planH, (viewW * MINIMAP_SHARE) / planW);
  return { width: planW * scale, height: planH * scale, scale };
}

/** True if the view shows the whole Plan (then the minimap would only repeat it). */
export function showsWholePlan(visible: Box, planW: number, planH: number): boolean {
  const tol = 1e-6 * Math.max(planW, planH); // float rounding only
  return visible.x0 <= tol && visible.y0 <= tol && visible.x1 >= planW - tol && visible.y1 >= planH - tol;
}

export interface MinimapElements {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  /** Holds one box per zone. */
  zones: HTMLElement;
  viewBox: HTMLElement;
  collapse: HTMLButtonElement;
  expand: HTMLButtonElement;
}

export class Minimap {
  private plan: { width: number; height: number } | undefined;
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

  /** Shows another Plan: its picture. The minimap starts expanded. */
  setPlan(widthMm: number, heightMm: number, picture: CanvasImageSource & { width: number; height: number }): void {
    this.plan = { width: widthMm, height: heightMm };
    this.collapsed = false;
    const c = this.el.canvas;
    c.width = picture.width;
    c.height = picture.height;
    c.getContext("2d")!.drawImage(picture, 0, 0);
    this.layout();
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
    if (this.plan) this.whole = showsWholePlan(visible, this.plan.width, this.plan.height);
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
  }

  private layout(): void {
    if (!this.plan) return;
    const s = minimapSize(this.plan.width, this.plan.height, this.area.clientWidth, this.area.clientHeight);
    this.scale = s.scale;
    this.el.canvas.style.width = `${s.width}px`;
    this.el.canvas.style.height = `${s.height}px`;
    this.placeBoxes();
  }

  private point(e: MouseEvent): { x: number; y: number } {
    const r = this.el.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.scale, y: (e.clientY - r.top) / this.scale };
  }

  private place(el: HTMLElement, r: Box): void {
    if (!this.plan) return;
    const s = this.scale,
      w = this.plan.width * s,
      h = this.plan.height * s;
    const x0 = Math.min(w, Math.max(0, r.x0 * s)),
      y0 = Math.min(h, Math.max(0, r.y0 * s));
    el.style.left = `${x0}px`;
    el.style.top = `${y0}px`;
    el.style.width = `${Math.max(3, Math.min(r.x1 * s, w) - x0)}px`;
    el.style.height = `${Math.max(3, Math.min(r.y1 * s, h) - y0)}px`;
  }

  private placeBoxes(): void {
    this.boxes.forEach((b, i) => this.place(this.el.zones.children[i] as HTMLElement, b));
    if (this.view) this.place(this.el.viewBox, this.view);
  }
}
