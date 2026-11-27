// The "Vergleich" tab's Plan view (ADR 0003, ADR 0004, ADR 0009): one view of both Plans in
// the Old frame, the New Plan moved by the Offset, with every Difference marked. It draws
// whatever comparison it is given (`show`): the marks, the Places and the setup used.
//
// Smooth on a 14 m Plan (ADR 0004): every frame draws only cached pictures (each Plan's
// overview, rendered once at 0.5 px/mm, and up to two sharp layers per Plan) and the marks as
// vector shapes. 120 ms after the view rests, the visible area plus 25 % is rendered sharp by
// each Plan's worker through the bands it touches. Nothing renders while the view moves.
//
// The camera is simplepdfclipper's viewer (as in planview.ts): the wheel zooms around the
// pointer, the right or middle button pans. The left button is left for selecting Places (a
// later slice); Space does not pan: it shows the New Plan, Ctrl + Space the Old Plan.

import type { Comparison, ComparisonSetup } from "../compare/compare";
import type { Box } from "../compare/objects";
import type { Place } from "../compare/places";
import type { Engine } from "../engine/client";
import {
  comparisonFrame,
  DEFAULT_SETTINGS,
  markMetrics,
  notCompared,
  placeSpots,
  RING_BELOW_PX,
  rings,
  shiftOf,
  type NotCompared,
  type PageSizes,
  type PlaceSpot,
  type Shown,
  type ViewSettings,
} from "./compareframe";
import { Layers, MARK_COLOURS, paintMark, paintMarks, paintNotCompared, paintNotComparedLabels, paintOutline, paintRings, pill, REMOVED_INK, type PaintMark, type PaintOutline, type Viewport } from "./comparepaint";
import { Minimap, minimapShapes, type MinimapElements } from "./minimap";
import { levelFor, levelScale, MAX_TILED_S, metricScale, tilesFor, TILE_PX, type Tile } from "./marktiles";
import { boxOutline, OUTLINE_MARGIN_MM, outlineGroups, outlineOf, type OutlineGroup } from "./outlines";
import type { Role, Sides } from "./openplans";
import { PX_PER_MM_100 } from "./planview";

/**
 * What the view draws: a finished comparison. "Vergleichen" (the "Versatz" tab) hands over a
 * ComparisonResult (src/compare/result.ts) through the hand-off, which has these and more.
 */
export interface ViewedComparison {
  /** The setup the comparison used: the Time axis, the Offset, each Plan's Body and Ignored areas. */
  setup: ComparisonSetup;
  /** The Differences, as marks in the Old frame, and the window that was compared. */
  comparison: Comparison;
  places: readonly Place[];
}

export interface ComparedPlanSize {
  widthMm: number;
  heightMm: number;
}

export interface CompareViewDeps {
  engines: () => Sides<Engine>;
  plans: () => Sides<ComparedPlanSize | undefined>;
}

export interface CompareViewElements {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  minimap: MinimapElements;
}

interface Layer {
  bitmap: ImageBitmap;
  /** In the Plan's own page mm. */
  rect: Box;
  pxPerMm: number;
}

interface PlanPictures {
  widthMm: number;
  heightMm: number;
  overview: Layer;
  layers: Layer[];
  rendering: boolean;
  again: boolean;
}

const MIN_ZOOM = 0.01;
const MAX_ZOOM = 64;
const RENDER_DELAY_MS = 120;
/** Smoothing is "low" while the view moves and "high" once it rests (research §3). */
const MOVING_MS = 150;
const MAX_RENDER_PIXELS = 12_000_000;
/** Sharp layers kept per Plan (ADR 0004). */
const KEEP_LAYERS = 2;
const BACKGROUND = "#e9e9ec";
/**
 * Making the outlines (one per Place and colour): as many as fit in this while the busy
 * window is up, the rest in slices between frames, and a frame makes the ones it needs
 * within its budget (from its start), ms.
 */
const OUTLINE_SHOW_MS = 250;
const OUTLINE_SLICE_MS = 8;
const OUTLINE_PAUSE_MS = 16;
const OUTLINE_FRAME_MS = 6;
/** Mark tiles kept (4 MB each), the least recently drawn dropped first. */
const MAX_TILES = 40;
/** Levels with at most this many tiles for the whole frame are painted ahead, when idle. */
const AHEAD_TILES = 3;
const AHEAD_PAUSE_MS = 40;

/**
 * A canvas keeps what it is told to draw and rasterizes it only when its picture is used:
 * the first frame to draw a tile painted ahead would pay for it. Reading a pixel makes it
 * rasterize now, while idle (or inside the busy window).
 */
const rasterize = (t: MarkTile) => void t.canvas.getContext("2d")!.getImageData(0, 0, 1, 1);

/** A cached picture of the marks in one tile of one level (marktiles.ts). */
interface MarkTile {
  canvas: HTMLCanvasElement;
  /** Painted with rough outlines (not all made yet): painted again once they are. */
  rough: boolean;
  /** Its outlines are all made now: still drawn, and painted again when the view rests. */
  stale?: boolean;
  /** The frame that last drew it. */
  used: number;
}
const ROLES: Role[] = ["old", "new"];

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
const touches = (a: Box, b: Box) => a.x1 >= b.x0 && a.x0 <= b.x1 && a.y1 >= b.y0 && a.y0 <= b.y1;

const bitmapOf = (p: { pixels: Uint8ClampedArray; widthPx: number; heightPx: number }) =>
  createImageBitmap(new ImageData(p.pixels as Uint8ClampedArray<ArrayBuffer>, p.widthPx, p.heightPx));

const PEEK_LABEL: Sides<string> = { new: "Neuer Plan ohne Markierungen (Leertaste)", old: "Alter Plan ohne Markierungen (Strg + Leertaste)" };

export class CompareView {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layers = new Layers();
  private readonly minimap: Minimap;
  private result: ViewedComparison | undefined;
  private pictures: Sides<PlanPictures> | undefined;
  private pages: PageSizes | undefined;
  private frame: Box = { x0: 0, y0: 0, x1: 1, y1: 1 };
  private zones: NotCompared[] = [];
  private marks: PaintMark[] = [];
  /** The Place each mark belongs to. */
  private placeOf = new Map<number, number>();
  private spots: PlaceSpot[] = [];
  private shown: Shown = {};
  /** Per Place and colour, of the shown marks; their outlines are made once, by key. */
  private groups: OutlineGroup[] = [];
  private outlines = new Map<string, PaintOutline>();
  /** Rough outlines (the box around the marks) for groups whose outline is not made yet. */
  private roughOutlines = new Map<string, PaintOutline>();
  private outlineIdle: ReturnType<typeof setTimeout> | undefined;
  /** The marks zoomed out, by level and tile ("k:tx:ty"). Dropped when what they show changes. */
  private tiles = new Map<string, MarkTile>();
  private readonly tileLayers = new Layers();
  private frameNo = 0;
  /** What the last frame drew from the tiles, for the tests. */
  private tileStats: { level: number; drawn: number; painted: number; standIn: number } | null = null;
  private tilesIdle: ReturnType<typeof setTimeout> | undefined;
  private settings: ViewSettings = { ...DEFAULT_SETTINGS };
  private peek: Role | null = null;
  private space = false;
  private active = false;
  private cx = 0;
  private cy = 0;
  private zoom = 1;
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private pan: { x: number; y: number; cx: number; cy: number } | undefined;
  private renderTimer: ReturnType<typeof setTimeout> | undefined;
  private restTimer: ReturnType<typeof setTimeout> | undefined;
  private moving = false;
  private frameId = 0;
  private generation = 0;
  /** How long making the outlines took when shown (for measuring). */
  private outlineMs = 0;
  /** The last frame drew a rough outline. */
  private outlinesMissing = false;
  /** Sharp layers that arrived (for measuring). */
  private sharpRenders = 0;
  /** What the last frame drew, for the tests. */
  drawn: { notCompared: NotCompared[]; marks: number; outlines: number; rings: number; ms: number } = { notCompared: [], marks: 0, outlines: 0, rings: 0, ms: 0 };

  constructor(
    private readonly el: CompareViewElements,
    private readonly deps: CompareViewDeps,
  ) {
    this.ctx = el.canvas.getContext("2d")!;
    this.minimap = new Minimap(el.minimap, el.root, (p) => this.centerOn(p));
    new ResizeObserver(() => {
      if (this.active) this.viewUpdated();
    }).observe(el.root);
    const c = el.canvas;
    c.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    c.addEventListener("pointerdown", (e) => this.onDown(e));
    c.addEventListener("pointermove", (e) => this.onMove(e));
    c.addEventListener("pointerup", (e) => this.onUp(e));
    c.addEventListener("pointercancel", (e) => this.onUp(e));
    c.addEventListener("contextmenu", (e) => e.preventDefault()); // the right button pans
    document.addEventListener("keydown", (e) => this.onKey(e, true));
    document.addEventListener("keyup", (e) => this.onKey(e, false));
    window.addEventListener("blur", () => this.setPeek(false, false));
  }

  // ---- Public API -----------------------------------------------------------

  /**
   * Shows a comparison. Makes each Plan ready in its worker first (bands and overview, ADR
   * 0004), so call it inside the busy window. The view keeps its place when the frame is the
   * same (a comparison run again); otherwise it shows the whole frame.
   */
  async show(result: ViewedComparison): Promise<void> {
    const plans = this.deps.plans(),
      engines = this.deps.engines();
    const old = plans.old,
      nu = plans.new;
    if (!old || !nu) throw new Error("both Plans are needed");
    const gen = ++this.generation;
    const axis = result.setup.axis;
    const prepared = await Promise.all(ROLES.map((r) => engines[r].prepareView(axis)));
    const bitmaps = await Promise.all(prepared.map((p) => bitmapOf(p.overview)));
    if (gen !== this.generation) {
      for (const b of bitmaps) b.close();
      return;
    }
    this.dropPictures();
    const pic = (role: Role, i: number): PlanPictures => {
      const p = plans[role]!;
      return {
        widthMm: p.widthMm,
        heightMm: p.heightMm,
        overview: { bitmap: bitmaps[i]!, rect: { x0: 0, y0: 0, x1: p.widthMm, y1: p.heightMm }, pxPerMm: bitmaps[i]!.width / p.widthMm },
        layers: [],
        rendering: false,
        again: false,
      };
    };
    this.pictures = { old: pic("old", 0), new: pic("new", 1) };
    this.pages = { old: [old.widthMm, old.heightMm], new: [nu.widthMm, nu.heightMm] };
    const before = this.frame;
    this.result = result;
    this.frame = comparisonFrame(this.pages, axis, result.setup.offset);
    this.zones = notCompared(result.setup, result.comparison.window, this.pages);
    this.marks = result.comparison.marks.map((m, i) => paintMark(i, m));
    this.placeOf = new Map(result.places.flatMap((p) => p.marks.map((i) => [i, p.no] as const)));
    this.outlines.clear();
    this.roughOutlines.clear();
    this.tiles.clear();
    const sameFrame = Math.abs(before.x0 - this.frame.x0) + Math.abs(before.y0 - this.frame.y0) + Math.abs(before.x1 - this.frame.x1) + Math.abs(before.y1 - this.frame.y1) < 0.01;
    this.measure();
    if (!sameFrame) this.fitFrame();
    this.updateMinimapPicture();
    this.updateSpots();
    // The outlines, once: what fits while the busy window is still up, the rest when idle.
    const t = performance.now();
    this.makeOutlines(t + OUTLINE_SHOW_MS);
    this.outlineMs = performance.now() - t;
    // The marks' pictures for the view it opens with, also while the busy window is up.
    this.paintVisibleTiles();
    this.scheduleTiles();
    this.scheduleOutlines();
    this.viewUpdated();
  }

  /** The tab is shown: measure and draw. Call after it is visible. */
  enter(): void {
    this.active = true;
    this.measure();
    this.viewUpdated();
  }

  leave(): void {
    this.active = false;
    this.setPeek(false, false);
  }

  /** Which Places and marks are shown (filter and hiding, a later slice). Nothing moves. */
  setShown(shown: Shown): void {
    this.shown = shown;
    this.tiles.clear();
    this.scheduleTiles();
    this.updateSpots();
    this.scheduleOutlines();
    this.requestDraw();
  }

  /** The display settings (a later slice): base Plan, fade, outline, x–x–x. */
  setSettings(patch: Partial<ViewSettings>): void {
    const baseChanged = patch.base !== undefined && patch.base !== this.settings.base;
    this.settings = { ...this.settings, ...patch };
    if (baseChanged) this.updateMinimapPicture();
    // The tiles hold the marks as the settings draw them; the Plan under them and its fade are not in them.
    if (Object.keys(patch).some((k) => k !== "base" && k !== "fade")) {
      this.tiles.clear();
      this.scheduleTiles();
    }
    this.requestDraw();
  }

  /** Key 1: both Plans whole. */
  fitFrame(): void {
    this.fitRect(this.frame, 0.02);
  }

  /** Key 2: the Plan's width fills the view, from the top of the frame. */
  fitWidth(): void {
    this.measure();
    const f = this.frame;
    this.zoom = clamp(this.cssW / ((f.x1 - f.x0) * 1.02), MIN_ZOOM, MAX_ZOOM);
    this.cx = (f.x0 + f.x1) / 2;
    this.cy = f.y0 + this.cssH / 2 / this.zoom;
    this.viewUpdated();
  }

  /** Key 3: 1 mm on paper is 1 mm on screen (96 dpi), around the middle of the view. */
  zoomTo100(): void {
    this.zoomAt(this.cssW / 2, this.cssH / 2, PX_PER_MM_100 / this.zoom);
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

  centerOn(p: { x: number; y: number }): void {
    this.cx = p.x;
    this.cy = p.y;
    this.viewUpdated();
  }

  /** Moves the view without waiting: for measuring frame times. */
  setView(cx: number, cy: number, zoom: number): void {
    this.cx = cx;
    this.cy = cy;
    this.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    this.viewUpdated();
  }

  visible(): Box {
    const hw = this.cssW / 2 / this.zoom,
      hh = this.cssH / 2 / this.zoom;
    return { x0: this.cx - hw, y0: this.cy - hh, x1: this.cx + hw, y1: this.cy + hh };
  }

  /** For the tests. */
  inspect() {
    return {
      zoom: this.zoom,
      centre: { x: this.cx, y: this.cy },
      visible: this.visible(),
      frame: this.frame,
      cssW: this.cssW,
      cssH: this.cssH,
      peek: this.peek,
      layers: this.pictures ? { old: this.pictures.old.layers.length, new: this.pictures.new.layers.length } : null,
      sharpRenders: this.sharpRenders,
      outlineMs: this.outlineMs,
      outlinesMade: this.outlines.size,
      tiles: this.tileStats,
      outlineGroups: this.groups.length,
      drawn: { ...this.drawn, notCompared: this.drawn.notCompared.map((z) => ({ plan: z.plan, kind: z.kind, label: z.label })) },
    };
  }

  /** Where a not-compared part is on screen, client CSS px (for the tests). */
  notComparedOnScreen(plan: Role, kind: NotCompared["kind"]) {
    const z = this.zones.find((q) => q.plan === plan && q.kind === kind);
    if (!z) return null;
    const v = this.visible();
    const b = intersect(z.rect, v);
    if (!b) return null;
    return { x: (b.x0 - v.x0) * this.zoom, y: (b.y0 - v.y0) * this.zoom, w: (b.x1 - b.x0) * this.zoom, h: (b.y1 - b.y0) * this.zoom };
  }

  // ---- Keys -----------------------------------------------------------------

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (!this.active || !this.result) return;
    const t = e.target;
    if (t instanceof HTMLElement && t.closest("input, textarea, select, dialog[open]")) return;
    if (document.querySelector("dialog[open]")) return;
    if (e.key === " ") {
      e.preventDefault();
      if (!down || !e.repeat) this.setPeek(down, e.ctrlKey);
      return;
    }
    if (e.key === "Control") {
      if (this.space) this.setPeek(true, down);
      return;
    }
    if (!down || e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case "1":
        this.fitFrame();
        break;
      case "2":
        this.fitWidth();
        break;
      case "3":
        this.zoomTo100();
        break;
      case "f":
      case "F":
        // The selected Places (a later slice); with none selected, the whole frame.
        this.fitFrame();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  /** Space held: the New Plan alone; with Ctrl, the Old Plan. No render needed (ADR 0004). */
  private setPeek(space: boolean, ctrl: boolean): void {
    this.space = space;
    const peek: Role | null = space ? (ctrl ? "old" : "new") : null;
    if (peek === this.peek) return;
    this.peek = peek;
    this.requestDraw();
  }

  // ---- Mouse ----------------------------------------------------------------

  private local(e: MouseEvent) {
    const r = this.el.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private zoomAt(sx: number, sy: number, factor: number): void {
    const v = this.visible();
    const bx = v.x0 + sx / this.zoom,
      by = v.y0 + sy / this.zoom;
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const w = this.visible();
    this.cx += bx - (w.x0 + sx / this.zoom);
    this.cy += by - (w.y0 + sy / this.zoom);
    this.viewUpdated();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const p = this.local(e);
    const lines = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * lines * 0.0015));
  }

  private onDown(e: PointerEvent): void {
    if (!this.result || (e.button !== 1 && e.button !== 2)) return;
    const p = this.local(e);
    this.pan = { ...p, cx: this.cx, cy: this.cy };
    this.el.canvas.setPointerCapture(e.pointerId);
    this.el.canvas.style.cursor = "grabbing";
    e.preventDefault();
  }

  private onMove(e: PointerEvent): void {
    if (!this.pan) return;
    const p = this.local(e);
    this.cx = this.pan.cx - (p.x - this.pan.x) / this.zoom;
    this.cy = this.pan.cy - (p.y - this.pan.y) / this.zoom;
    this.viewUpdated();
  }

  private onUp(e: PointerEvent): void {
    if (!this.pan) return;
    this.pan = undefined;
    if (this.el.canvas.hasPointerCapture(e.pointerId)) this.el.canvas.releasePointerCapture(e.pointerId);
    this.el.canvas.style.cursor = "";
  }

  // ---- State that follows the comparison --------------------------------------

  private dropPictures(): void {
    for (const r of ROLES) {
      const p = this.pictures?.[r];
      if (!p) continue;
      p.overview.bitmap.close();
      for (const l of p.layers) l.bitmap.close();
    }
    this.pictures = undefined;
  }

  private isShown(i: number): boolean {
    const no = this.placeOf.get(i);
    if (no !== undefined && this.shown.place && !this.shown.place(no)) return false;
    return !this.shown.mark || this.shown.mark(i);
  }

  private updateSpots(): void {
    if (!this.result) return;
    this.spots = placeSpots(this.result.places, this.result.comparison.marks, this.shown);
    this.groups = outlineGroups(this.result.places, this.result.comparison.marks, (i) => this.isShown(i));
    const spots = this.spots,
      marks = this.marks;
    const byNo = new Map(this.result.places.map((p) => [p.no, p] as const));
    this.minimap.setPlaces((ctx, scale, origin) => {
      ctx.lineJoin = ctx.lineCap = "round";
      for (const shape of minimapShapes(spots, scale, origin)) {
        const colour = shape.colour === "added" ? MARK_COLOURS.Added : MARK_COLOURS.Removed;
        ctx.fillStyle = ctx.strokeStyle = colour;
        if (shape.type === "dot") {
          ctx.beginPath();
          ctx.arc(shape.x, shape.y, shape.d / 2, 0, 2 * Math.PI);
          ctx.fill();
          continue;
        }
        // Its own shape: its shown marks, outlined so that it is at least 3 px in every direction.
        ctx.save();
        ctx.setTransform(ctx.getTransform().scale(scale).translate(-origin.x, -origin.y));
        ctx.lineWidth = shape.strokePx / scale;
        for (const i of byNo.get(shape.no)!.marks) {
          if (!this.isShown(i)) continue;
          const pm = marks[i]!;
          ctx.stroke(pm.path);
          if (pm.closed) ctx.fill(pm.path);
        }
        ctx.restore();
      }
    });
  }

  /**
   * A group's outline, made the first time it is needed (and again when its shown marks
   * change). Past `until` (performance.now) it is not made now: the rough one stands in.
   */
  private outlineOf(g: OutlineGroup, until = Infinity): PaintOutline {
    let o = this.outlines.get(g.key);
    if (o) return o;
    if (performance.now() < until) {
      o = paintOutline(g.kind, outlineOf(g.marks.map((i) => this.marks[i]!.mark)));
      this.outlines.set(g.key, o);
      return o;
    }
    this.outlinesMissing = true;
    return this.roughOutline(g);
  }

  /** The box around a group's marks, rounded: for a group too small on screen to tell, or not made yet. */
  private roughOutline(g: OutlineGroup): PaintOutline {
    let o = this.outlines.get(g.key) ?? this.roughOutlines.get(g.key);
    if (!o) {
      o = paintOutline(g.kind, boxOutline(g.box));
      this.roughOutlines.set(g.key, o);
    }
    return o;
  }

  /** Makes the outlines not made yet until `until`; true when all are made. */
  private makeOutlines(until: number): boolean {
    for (const g of this.groups) {
      if (this.outlines.has(g.key)) continue;
      if (performance.now() >= until) return false;
      this.outlineOf(g);
    }
    return true;
  }

  /** Makes the missing outlines in short slices between frames, then draws once. */
  private scheduleOutlines(): void {
    if (this.outlineIdle !== undefined) clearTimeout(this.outlineIdle);
    const gen = this.generation;
    const slice = () => {
      this.outlineIdle = undefined;
      if (gen !== this.generation) return;
      // Not while the view moves: the frames come first.
      if (this.moving) {
        this.outlineIdle = setTimeout(slice, MOVING_MS);
        return;
      }
      if (this.makeOutlines(performance.now() + OUTLINE_SLICE_MS)) {
        // All made: tiles painted with rough outlines are painted again, at rest.
        let rough = false;
        for (const t of this.tiles.values()) {
          if (!t.rough) continue;
          t.stale = true;
          rough = true;
        }
        if (this.outlinesMissing || rough) this.requestDraw();
        if (rough) this.scheduleTiles();
      } else this.outlineIdle = setTimeout(slice, OUTLINE_PAUSE_MS);
    };
    this.outlineIdle = setTimeout(slice, OUTLINE_PAUSE_MS);
  }

  /** The minimap shows the frame with the Plan under the marks (both: the Old Plan). */
  private updateMinimapPicture(): void {
    const pics = this.pictures,
      res = this.result;
    if (!pics || !res) return;
    const f = this.frame;
    const s = pics.old.overview.pxPerMm;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round((f.x1 - f.x0) * s));
    c.height = Math.max(1, Math.round((f.y1 - f.y0) * s));
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    const roles: Role[] = this.settings.base === "both" ? ["old", "new"] : [this.settings.base];
    for (const r of roles) {
      const sh = shiftOf(r, res.setup.axis, res.setup.offset);
      const p = pics[r];
      ctx.globalCompositeOperation = r === roles[0] ? "source-over" : "darken";
      ctx.drawImage(p.overview.bitmap, (sh.dx - f.x0) * s, (sh.dy - f.y0) * s, p.widthMm * s, p.heightMm * s);
    }
    this.minimap.setPlan(f.x1 - f.x0, f.y1 - f.y0, c, { x: f.x0, y: f.y0 });
  }

  // ---- Rendering ------------------------------------------------------------

  private measure(): void {
    const parent = this.el.root;
    const dpr = window.devicePixelRatio || 1;
    if (dpr !== this.dpr) this.tiles.clear();
    this.dpr = dpr;
    const w = Math.max(1, parent.clientWidth),
      h = Math.max(1, parent.clientHeight);
    if (w === this.cssW && h === this.cssH && this.el.canvas.width === Math.round(w * this.dpr)) return;
    this.cssW = w;
    this.cssH = h;
    this.el.canvas.width = Math.round(w * this.dpr);
    this.el.canvas.height = Math.round(h * this.dpr);
    this.el.canvas.style.width = `${w}px`;
    this.el.canvas.style.height = `${h}px`;
  }

  private viewUpdated(): void {
    this.measure();
    this.moving = true;
    clearTimeout(this.restTimer);
    this.restTimer = setTimeout(() => {
      this.moving = false;
      this.requestDraw();
    }, MOVING_MS);
    this.requestDraw();
    if (this.result) this.minimap.setView(this.visible());
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => {
      for (const r of ROLES) void this.renderSharp(r);
    }, RENDER_DELAY_MS);
  }

  requestDraw(): void {
    if (this.frameId) return;
    this.frameId = requestAnimationFrame(() => {
      this.frameId = 0;
      this.draw();
    });
  }

  /** The visible area in a Plan's own page mm. */
  private visibleIn(role: Role): Box {
    const v = this.visible(),
      res = this.result!;
    const sh = shiftOf(role, res.setup.axis, res.setup.offset);
    return { x0: v.x0 - sh.dx, y0: v.y0 - sh.dy, x1: v.x1 - sh.dx, y1: v.y1 - sh.dy };
  }

  /** Renders a Plan's visible part (plus a margin) sharp, unless a sharp enough picture covers it. */
  private async renderSharp(role: Role): Promise<void> {
    const pics = this.pictures,
      p = pics?.[role];
    if (!p || !this.active || this.cssW <= 1) return;
    if (p.rendering) {
      p.again = true;
      return;
    }
    const want = this.zoom * this.dpr;
    if (want <= p.overview.pxPerMm * 1.01) return; // the overview is sharp enough
    const page: Box = { x0: 0, y0: 0, x1: p.widthMm, y1: p.heightMm };
    const need = intersect(this.visibleIn(role), page);
    if (!need || p.layers.some((l) => l.pxPerMm >= want * 0.99 && covers(l.rect, need))) return;
    let margin = 0.25;
    let rect = intersect(grow(need, margin), page)!;
    while (margin > 0 && area(rect) * want * want > MAX_RENDER_PIXELS) {
      margin = Math.max(0, margin - 0.1);
      rect = intersect(grow(need, margin), page)!;
    }
    const pxPerMm = Math.min(want, Math.sqrt(MAX_RENDER_PIXELS / area(rect)));
    p.rendering = true;
    try {
      const bitmap = await bitmapOf(await this.deps.engines()[role].renderRegion({ rect, pxPerMm }));
      if (this.pictures !== pics) bitmap.close();
      else {
        // The actual picture size (pixel counts are rounded), so nothing shifts.
        p.layers.push({ bitmap, rect, pxPerMm: bitmap.width / (rect.x1 - rect.x0) });
        this.sharpRenders++;
        this.dropBlurryTiles(role, rect, p.overview.pxPerMm);
        while (p.layers.length > KEEP_LAYERS) p.layers.shift()!.bitmap.close();
        this.requestDraw();
      }
    } catch (err) {
      console.warn("render failed", err);
    } finally {
      p.rendering = false;
    }
    if (p.again) {
      p.again = false;
      void this.renderSharp(role);
    }
  }

  private viewport(): Viewport {
    const v = this.visible(),
      s = this.zoom * this.dpr;
    return { x0: v.x0, y0: v.y0, s, w: this.el.canvas.width, h: this.el.canvas.height, dpr: this.dpr };
  }

  /**
   * Paints the marks that `vp` shows onto ctx, as they are: the objects, and the outlines with
   * the halos and the x–x–x. Outlines not made yet are made until `until`, else rough.
   */
  private paintLive(ctx: CanvasRenderingContext2D, layers: Layers, vp: Viewport, until: number, metricS = vp.s): { marks: number; outlines: number } {
    // Sizes kept on screen (outline, x–x–x, thinnest line) as at metricS: a tile is drawn at other zooms too.
    const met = markMetrics(this.settings, metricS, vp.dpr);
    const pad = met.outlineMm + met.xxx.distanceMm + (8 * vp.dpr) / vp.s;
    const view = { x0: vp.x0 - pad, y0: vp.y0 - pad, x1: vp.x0 + vp.w / vp.s + pad, y1: vp.y0 + vp.h / vp.s + pad };
    const vis = this.marks.filter((pm) => touches(pm.mark.box, view) && this.isShown(pm.index));
    const m = OUTLINE_MARGIN_MM,
      around = { x0: view.x0 - m, y0: view.y0 - m, x1: view.x1 + m, y1: view.y1 + m };
    this.outlinesMissing = false;
    const outs: PaintOutline[] = [];
    if (met.outlineMm > 0 || this.settings.removed === "xxx") {
      // Smaller than a ring on screen: no outline where the Place gets a ring, else its rounded box.
      const small = (RING_BELOW_PX * vp.dpr) / metricS,
        size = (b: Box) => Math.max(b.x1 - b.x0, b.y1 - b.y0);
      const ringed = new Set(this.settings.rings ? this.spots.filter((p) => size(p.box) < small).map((p) => p.no) : []);
      for (const g of this.groups) {
        if (!touches(g.box, around) || (g.place !== null && ringed.has(g.place))) continue;
        outs.push(size(g.box) < small ? this.roughOutline(g) : this.outlineOf(g, until));
      }
    }
    paintMarks(ctx, layers, vis, outs, vp, met, this.settings, (role) => this.drawPlan(ctx, role, vp));
    return { marks: vis.length, outlines: outs.length };
  }

  /** Paints one tile of the marks at level k. */
  private paintTile(k: number, t: Tile): MarkTile {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = TILE_PX;
    const tctx = canvas.getContext("2d")!;
    const vp: Viewport = { x0: t.rect.x0, y0: t.rect.y0, s: levelScale(k), w: TILE_PX, h: TILE_PX, dpr: this.dpr };
    this.tileLayers.size(TILE_PX, TILE_PX);
    this.paintLive(tctx, this.tileLayers, vp, performance.now() + OUTLINE_FRAME_MS, metricScale(k));
    const tile = { canvas, rough: this.outlinesMissing, used: this.frameNo };
    this.outlinesMissing = false;
    this.tiles.set(`${k}:${t.tx}:${t.ty}`, tile);
    return tile;
  }

  /**
   * Paints the coarse levels of the whole frame ahead, one tile at a time while the view
   * rests, coarsest first, so that zooming out finds them there.
   */
  private scheduleTiles(): void {
    if (this.tilesIdle !== undefined) clearTimeout(this.tilesIdle);
    const gen = this.generation;
    const next = () => {
      this.tilesIdle = undefined;
      // Room is left for the tiles in view: painting ahead never pushes them out.
      if (gen !== this.generation || !this.result || !this.settings.marks || this.tiles.size > MAX_TILES - 12) return;
      if (this.moving) {
        this.tilesIdle = setTimeout(next, MOVING_MS);
        return;
      }
      // From the level that shows the whole frame.
      const f = this.frame,
        fit = Math.min(this.el.canvas.width / (f.x1 - f.x0), this.el.canvas.height / (f.y1 - f.y0), MAX_TILED_S);
      for (let k = levelFor(fit) ?? 0; k >= 0; k--) {
        const ts = tilesFor(k, this.frame, this.frame);
        if (ts.length > AHEAD_TILES) break;
        const t = ts.find((u) => !this.tiles.get(`${k}:${u.tx}:${u.ty}`) || this.tiles.get(`${k}:${u.tx}:${u.ty}`)!.stale);
        if (!t) continue;
        rasterize(this.paintTile(k, t));
        this.tilesIdle = setTimeout(next, AHEAD_PAUSE_MS);
        return;
      }
    };
    this.tilesIdle = setTimeout(next, AHEAD_PAUSE_MS);
  }

  /**
   * A sharp picture of a Plan arrived: tiles under it that are sharper than the overview may
   * show changed words' ink from the overview, blurred. They are painted again.
   */
  private dropBlurryTiles(role: Role, rect: Box, overviewPxPerMm: number): void {
    const res = this.result;
    if (!res) return;
    const sh = shiftOf(role, res.setup.axis, res.setup.offset);
    const r = { x0: rect.x0 + sh.dx, y0: rect.y0 + sh.dy, x1: rect.x1 + sh.dx, y1: rect.y1 + sh.dy };
    const words = this.marks.some((pm) => pm.mark.shape === "word" && pm.mark.plan === role && touches(pm.mark.box, r));
    if (!words) return;
    for (const key of [...this.tiles.keys()]) {
      const [k, tx, ty] = key.split(":").map(Number) as [number, number, number];
      if (levelScale(k) <= overviewPxPerMm) continue;
      const mm = TILE_PX / levelScale(k),
        t = { x0: this.frame.x0 + tx * mm, y0: this.frame.y0 + ty * mm, x1: this.frame.x0 + (tx + 1) * mm, y1: this.frame.y0 + (ty + 1) * mm };
      if (touches(t, r)) this.tiles.delete(key);
    }
  }

  /** The tiles the view opens with, painted now (inside the busy window). */
  private paintVisibleTiles(): void {
    if (!this.settings.marks) return;
    const vp = this.viewport(),
      k = levelFor(vp.s);
    if (k === null) return;
    for (const t of tilesFor(k, this.frame, this.visible())) if (!this.tiles.has(`${k}:${t.tx}:${t.ty}`)) rasterize(this.paintTile(k, t));
  }

  /**
   * Draws the marks from the tiles of level k. A missing tile is painted when no other level's
   * tiles can stand in; else they stand in while the view moves, and at rest one missing tile
   * is painted a frame.
   */
  private drawTiles(ctx: CanvasRenderingContext2D, vp: Viewport, k: number): void {
    const frameNo = ++this.frameNo;
    this.tileStats = { level: k, drawn: 0, painted: 0, standIn: 0 };
    let missing = false,
      painted = 0;
    const place = (tile: MarkTile, rect: Box) => {
      tile.used = frameNo;
      const x0 = Math.round((rect.x0 - vp.x0) * vp.s),
        y0 = Math.round((rect.y0 - vp.y0) * vp.s),
        x1 = Math.round((rect.x1 - vp.x0) * vp.s),
        y1 = Math.round((rect.y1 - vp.y0) * vp.s);
      ctx.drawImage(tile.canvas, x0, y0, x1 - x0, y1 - y0);
    };
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // A tile is drawn at most a level step smaller: plain bilinear keeps its thin lines crisp.
    ctx.imageSmoothingQuality = "low";
    for (const t of tilesFor(k, this.frame, this.visible())) {
      let tile = this.tiles.get(`${k}:${t.tx}:${t.ty}`);
      if (tile?.stale) {
        if (this.moving || painted > 0) missing = true;
        else {
          tile = this.paintTile(k, t);
          painted++;
          this.tileStats.painted++;
        }
      }
      if (!tile) {
        // Another level's tiles over this one, all of them there: the nearest, coarser first.
        let cover: [MarkTile, Box][] | undefined;
        for (const kk of [k + 1, k - 1, k + 2, k - 2, k + 3, k - 3, ...Array.from({ length: 40 }, (_, i) => k + 4 + i)]) {
          if (kk < 0) continue;
          const under = tilesFor(kk, this.frame, t.rect).map((u) => [this.tiles.get(`${kk}:${u.tx}:${u.ty}`), u.rect] as const);
          if (under.length && under.every(([u]) => u)) {
            cover = under as [MarkTile, Box][];
            break;
          }
        }
        // While the view moves it stands in; at rest the tile is painted, one a frame.
        if (cover && (this.moving || painted > 0)) {
          missing = true;
          this.tileStats.standIn++;
          ctx.save();
          ctx.beginPath();
          ctx.rect((t.rect.x0 - vp.x0) * vp.s, (t.rect.y0 - vp.y0) * vp.s, (t.rect.x1 - t.rect.x0) * vp.s, (t.rect.y1 - t.rect.y0) * vp.s);
          ctx.clip();
          for (const [u, rect] of cover) place(u, rect);
          ctx.restore();
          continue;
        }
        tile = this.paintTile(k, t);
        painted++;
        this.tileStats.painted++;
      }
      place(tile, t.rect);
      this.tileStats.drawn++;
    }
    ctx.restore();
    if (missing) this.requestDraw();
    // Keep the most recently drawn.
    if (this.tiles.size > MAX_TILES) {
      const old = [...this.tiles].filter(([, t]) => t.used !== frameNo).sort((a, b) => a[1].used - b[1].used);
      for (const [key] of old.slice(0, this.tiles.size - MAX_TILES)) this.tiles.delete(key);
    }
  }

  /** Draws a Plan's pictures (overview, then sharper layers) at its place in the frame. */
  private drawPlan(ctx: CanvasRenderingContext2D, role: Role, vp: Viewport): void {
    const p = this.pictures![role],
      res = this.result!;
    const sh = shiftOf(role, res.setup.axis, res.setup.offset);
    // What vp shows, in the Plan's own page mm.
    const vis = { x0: vp.x0 - sh.dx, y0: vp.y0 - sh.dy, x1: vp.x0 + vp.w / vp.s - sh.dx, y1: vp.y0 + vp.h / vp.s - sh.dy };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const l of [p.overview, ...[...p.layers].sort((a, b) => a.pxPerMm - b.pxPerMm)]) {
      const part = intersect(l.rect, vis);
      if (!part) continue;
      ctx.drawImage(
        l.bitmap,
        (part.x0 - l.rect.x0) * l.pxPerMm,
        (part.y0 - l.rect.y0) * l.pxPerMm,
        (part.x1 - part.x0) * l.pxPerMm,
        (part.y1 - part.y0) * l.pxPerMm,
        (part.x0 + sh.dx - vp.x0) * vp.s,
        (part.y0 + sh.dy - vp.y0) * vp.s,
        (part.x1 - part.x0) * vp.s,
        (part.y1 - part.y0) * vp.s,
      );
    }
  }

  /** The Plans under the marks: one, or both with "darken" (each composed on its own first). */
  private drawPlans(ctx: CanvasRenderingContext2D, roles: Role[], vp: Viewport): void {
    if (roles.length === 1) return this.drawPlan(ctx, roles[0]!, vp);
    this.drawPlan(ctx, "old", vp);
    const scratch = this.layers.a;
    this.layers.size(vp.w, vp.h);
    scratch.setTransform(1, 0, 0, 1, 0, 0);
    scratch.globalCompositeOperation = "source-over";
    scratch.clearRect(0, 0, vp.w, vp.h);
    scratch.imageSmoothingQuality = ctx.imageSmoothingQuality;
    this.drawPlan(scratch, "new", vp);
    ctx.save();
    ctx.globalCompositeOperation = "darken";
    ctx.drawImage(scratch.canvas, 0, 0);
    ctx.restore();
  }

  private draw(): void {
    const t0 = performance.now();
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, this.el.canvas.width, this.el.canvas.height);
    const res = this.result;
    if (!res || !this.pictures || !this.pages) return;
    const vp = this.viewport();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = this.moving ? "low" : "high";
    // White under each Plan's page.
    ctx.fillStyle = "#fff";
    for (const r of ROLES) {
      const sh = shiftOf(r, res.setup.axis, res.setup.offset);
      ctx.fillRect((sh.dx - vp.x0) * vp.s, (sh.dy - vp.y0) * vp.s, this.pages[r][0] * vp.s, this.pages[r][1] * vp.s);
    }
    const marksOn = this.settings.marks && !this.peek;
    const roles: Role[] = this.peek ? [this.peek] : this.settings.base === "both" ? ["old", "new"] : [this.settings.base];
    this.drawPlans(ctx, roles, vp);
    if (marksOn && this.settings.fade < 100) {
      ctx.fillStyle = `rgba(255,255,255,${1 - this.settings.fade / 100})`;
      ctx.fillRect(0, 0, vp.w, vp.h);
    }
    const zones = this.zones.filter((z) => roles.includes(z.plan));
    paintNotCompared(ctx, zones, vp);
    let drawnMarks = 0,
      drawnOutlines = 0,
      drawnRings = 0;
    if (marksOn) {
      const v = this.visible();
      const level = levelFor(vp.s);
      if (level === null) {
        // Zoomed in: few marks in view, painted live.
        this.tileStats = null;
        const n = this.paintLive(ctx, this.layers, vp, t0 + OUTLINE_FRAME_MS);
        if (this.outlinesMissing) this.requestDraw();
        drawnMarks = n.marks;
        drawnOutlines = n.outlines;
      } else {
        this.drawTiles(ctx, vp, level);
        for (const pm of this.marks) if (touches(pm.mark.box, v) && this.isShown(pm.index)) drawnMarks++;
      }
      if (this.settings.rings) {
        const rs = rings(this.spots, this.zoom, v);
        drawnRings = rs.length;
        paintRings(ctx, rs, vp);
      }
    }
    paintNotComparedLabels(ctx, zones, vp);
    if (this.peek) {
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const text = PEEK_LABEL[this.peek];
      ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
      pill(ctx, this.cssW / 2 - (ctx.measureText(text).width + 16) / 2, 12, text);
      ctx.restore();
    }
    this.drawn = { notCompared: zones, marks: drawnMarks, outlines: drawnOutlines, rings: drawnRings, ms: performance.now() - t0 };
  }
}

/** Colours shared with the sidebar's legend. */
export const LEGEND_COLOURS = { added: MARK_COLOURS.Added, removed: MARK_COLOURS.Removed, removedInk: REMOVED_INK, unchanged: MARK_COLOURS.Unchanged };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Builds the "Vergleich" tab's view on its elements in index.html. */
export function setUpCompareView(deps: CompareViewDeps): CompareView {
  const view = new CompareView(
    {
      root: $("compare-view"),
      canvas: $<HTMLCanvasElement>("compare-canvas"),
      minimap: {
        root: $("cmp-minimap"),
        canvas: $<HTMLCanvasElement>("cmp-overview-canvas"),
        places: $<HTMLCanvasElement>("cmp-places-canvas"),
        zones: $("cmp-zone-boxes"),
        viewBox: $("cmp-view-box"),
        collapse: $<HTMLButtonElement>("cmp-minimap-collapse"),
        expand: $<HTMLButtonElement>("cmp-minimap-expand"),
      },
    },
    deps,
  );
  // For the e2e tests and the frame-time measurement.
  (window as unknown as { __spcCompare: unknown }).__spcCompare = {
    inspect: () => view.inspect(),
    centerOn: (x: number, y: number) => view.centerOn({ x, y }),
    setView: (cx: number, cy: number, zoom: number) => view.setView(cx, cy, zoom),
    notComparedOnScreen: (plan: Role, kind: NotCompared["kind"]) => view.notComparedOnScreen(plan, kind),
    setShown: (places: number[] | null) => view.setShown(places ? { place: (no) => places.includes(no) } : {}),
  };
  return view;
}
