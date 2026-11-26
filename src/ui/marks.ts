// Drawing the marks of a comparison as vector shapes (ADR 0003, ADR 0004): Added red,
// Removed yellow, and grey where a Removed and an Added mark cover the same place (the
// Unchanged part, such as the common stretch of a hatched stripe that was extended).

import type { Mark } from "../compare/compare";
import type { MarkFrame } from "./markframe";

export const MARK_COLOURS = { Added: "#dc2a1e", Removed: "#f0be00", Unchanged: "#4a4a4a" } as const;

/** Lines thinner than this on screen are drawn this wide, px. */
const MIN_LINE_PX = 1.5;
/** Words are marked by their box, this much larger, mm. */
const WORD_PAD = 0.2;

function pathOf(m: Mark): Path2D {
  const path = new Path2D(),
    k = m.coords;
  if (m.shape === "word") {
    const b = m.box;
    path.rect(b.x0 - WORD_PAD, b.y0 - WORD_PAD, b.x1 - b.x0 + 2 * WORD_PAD, b.y1 - b.y0 + 2 * WORD_PAD);
  } else if (m.shape === "line") {
    for (let q = 0; q + 3 < k.length; q += 4) {
      path.moveTo(k[q]!, k[q + 1]!);
      path.lineTo(k[q + 2]!, k[q + 3]!);
    }
  } else {
    let start = true;
    for (let q = 0; q + 1 < k.length; q += 2) {
      if (Number.isNaN(k[q]!)) {
        path.closePath();
        start = true;
      } else if (start) {
        path.moveTo(k[q]!, k[q + 1]!);
        start = false;
      } else path.lineTo(k[q]!, k[q + 1]!);
    }
  }
  return path;
}

function layer(width: number, height: number): CanvasRenderingContext2D {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c.getContext("2d")!;
}

/** Draws the marks of one kind, in its colour, onto a layer in the frame. */
function drawKind(ctx: CanvasRenderingContext2D, marks: readonly Mark[], kind: Mark["kind"], frame: MarkFrame): void {
  const s = frame.pxPerMm;
  ctx.setTransform(s, 0, 0, s, -frame.x0 * s, -frame.y0 * s);
  ctx.fillStyle = ctx.strokeStyle = MARK_COLOURS[kind];
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const m of marks) {
    if (m.kind !== kind) continue;
    const path = pathOf(m);
    if (m.shape === "line") {
      ctx.lineWidth = Math.max(m.lineWidth, MIN_LINE_PX / s);
      ctx.stroke(path);
    } else ctx.fill(path, "evenodd");
  }
}

/** Draws the marks on top of `ctx` (the frame's picture of both Plans). */
export function drawMarks(ctx: CanvasRenderingContext2D, marks: readonly Mark[], frame: MarkFrame): void {
  const { widthPx: w, heightPx: h } = frame;
  const removed = layer(w, h),
    added = layer(w, h);
  drawKind(removed, marks, "Removed", frame);
  drawKind(added, marks, "Added", frame);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(removed.canvas, 0, 0);
  ctx.drawImage(added.canvas, 0, 0);
  // Where both are drawn: the Unchanged part.
  removed.setTransform(1, 0, 0, 1, 0, 0);
  removed.globalCompositeOperation = "source-in";
  removed.drawImage(added.canvas, 0, 0);
  removed.fillStyle = MARK_COLOURS.Unchanged;
  removed.fillRect(0, 0, w, h);
  ctx.drawImage(removed.canvas, 0, 0);
  ctx.restore();
  removed.canvas.width = added.canvas.width = 0; // free the layers now
}
