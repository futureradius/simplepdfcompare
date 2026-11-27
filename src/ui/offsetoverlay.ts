// The picture of "Versatz": both Plans on top of each other in one zoomable view (ADR 0002).
// Ink both Plans draw is black, ink only the Old Plan draws is blue, ink only the New Plan
// draws is red. That falls out of multiplying two tinted Plans: blue times red is black.
// The drag that moves the New Plan, snapping to the candidates, is this view's editor.
// Ported from the alignment prototype (variant A: tint, the drag with its "eingerastet" pill).

import type { Axis, Box } from "../compare/objects";
import type { OffsetCandidate } from "../compare/offset";
import type { Engine } from "../engine/client";
import type { Point } from "../zones/model";
import { formatOffset, snapOffset, type OffsetSource } from "./offsetmodel";
import type { Editor, Partner, Subject, ViewPort } from "./planview";

/** Ink only in the Old Plan, and only in the New Plan. Multiplied they are black. */
export const OLD_INK = "#1478e6";
export const NEW_INK = "#e1003c";
const SNAP_COLOUR = "#f59e0b";

/**
 * The picture as grey ink in `colour`: coloured ink becomes grey first (only how dark it is
 * counts), then black ink takes the colour and white stays white (each channel: the larger of the two).
 */
export function tinted(draw: (ctx: CanvasRenderingContext2D) => void, width: number, height: number, colour: string): HTMLCanvasElement {
  const raw = document.createElement("canvas");
  raw.width = width;
  raw.height = height;
  draw(raw.getContext("2d")!);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d")!;
  ctx.filter = "grayscale(1)";
  ctx.drawImage(raw, 0, 0);
  ctx.filter = "none";
  ctx.globalCompositeOperation = "lighten";
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, width, height);
  return c;
}

/** A tinted copy of a Plan's overview picture. */
export const tintedOverview = (picture: HTMLCanvasElement, colour: string): HTMLCanvasElement =>
  tinted((ctx) => ctx.drawImage(picture, 0, 0), picture.width, picture.height, colour);

/** Renders a part of a Plan sharp and tints it. */
export async function renderTinted(engine: Engine, rect: Box, pxPerMm: number, colour: string): Promise<ImageBitmap> {
  const p = await engine.renderRegion({ rect, pxPerMm });
  const c = tinted((ctx) => ctx.putImageData(new ImageData(p.pixels as Uint8ClampedArray<ArrayBuffer>, p.widthPx, p.heightPx), 0, 0), p.widthPx, p.heightPx, colour);
  return createImageBitmap(c);
}

/** What the editor of the view needs from the tab. */
export interface OffsetHost {
  axis(): Axis;
  offset(): number;
  candidates(): readonly OffsetCandidate[];
  /** The Offset was dragged to this value. */
  set(offset: number, source: OffsetSource): void;
  /** The part of the Old frame that is compared (along the Time direction), mm. */
  window(): [number, number];
}

/** A left drag moves the New Plan along the Time direction; it snaps to the candidates, Alt drags free. */
export class OffsetEditor implements Editor {
  private drag: { t0: number; o0: number } | undefined;
  private snapped = false;

  constructor(private readonly host: OffsetHost) {}

  private t = (p: Point) => (this.host.axis() === "y" ? p.y : p.x);

  cursor(): string {
    return this.host.axis() === "y" ? "ns-resize" : "ew-resize";
  }

  down(mm: Point): boolean {
    this.drag = { t0: this.t(mm), o0: this.host.offset() };
    return true;
  }

  move(mm: Point, _screen: Point, e: PointerEvent, vp: ViewPort): void {
    const d = this.drag;
    if (!d) return;
    const s = snapOffset(d.o0 + this.t(mm) - d.t0, this.host.candidates(), vp.zoom, e.altKey);
    this.snapped = s.snapped;
    if (Math.abs(s.offset - this.host.offset()) > 1e-6) this.host.set(s.offset, s.source);
  }

  up(): void {
    this.drag = undefined;
    this.snapped = false;
  }

  draw(ctx: CanvasRenderingContext2D, vp: ViewPort): void {
    // The Overhang and the parts left out of the Body are veiled: they are not compared.
    const [w0, w1] = this.host.window();
    const y = this.host.axis() === "y";
    const a = y ? vp.toScreen(0, w0).y : vp.toScreen(w0, 0).x;
    const b = y ? vp.toScreen(0, w1).y : vp.toScreen(w1, 0).x;
    const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    if (y) {
      ctx.fillRect(0, 0, vp.cssW, clamp(a, vp.cssH));
      ctx.fillRect(0, clamp(b, vp.cssH), vp.cssW, vp.cssH - clamp(b, vp.cssH));
    } else {
      ctx.fillRect(0, 0, clamp(a, vp.cssW), vp.cssH);
      ctx.fillRect(clamp(b, vp.cssW), 0, vp.cssW - clamp(b, vp.cssW), vp.cssH);
    }
    if (this.snapped) {
      const text = `eingerastet: ${formatOffset(this.host.offset())} mm`;
      ctx.font = "600 13px 'Segoe UI', system-ui, sans-serif";
      const w = ctx.measureText(text).width + 24;
      ctx.fillStyle = SNAP_COLOUR;
      ctx.beginPath();
      ctx.roundRect(vp.cssW / 2 - w / 2, 12, w, 26, 13);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillText(text, vp.cssW / 2, 26);
    }
  }
}

export interface OverlayPlan {
  widthMm: number;
  heightMm: number;
  picture: HTMLCanvasElement;
}

/** The subject for the Plan view: the Old Plan in blue, the New Plan in red laid over it by the Offset. */
export function overlaySubject(old: OverlayPlan, nu: OverlayPlan, engines: { old: Engine; new: Engine }, editor: Editor, shift: () => Point): Subject {
  const partner: Partner = {
    widthMm: nu.widthMm,
    heightMm: nu.heightMm,
    overview: tintedOverview(nu.picture, NEW_INK),
    render: (rect, pxPerMm) => renderTinted(engines.new, rect, pxPerMm, NEW_INK),
    shift,
  };
  return {
    widthMm: old.widthMm,
    heightMm: old.heightMm,
    overview: tintedOverview(old.picture, OLD_INK),
    render: (rect, pxPerMm) => renderTinted(engines.old, rect, pxPerMm, OLD_INK),
    editor,
    partner,
  };
}
