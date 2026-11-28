// The "Vergleich" tab's Plan view (ADR 0003, ADR 0004, ADR 0009): one view of both Plans in
// the Old frame, the New Plan moved by the Offset, with every Difference marked. It draws
// whatever comparison it is given (`show`): the marks, the Places and the setup used.
//
// Smooth on a 14 m Plan (ADR 0004): every frame draws only cached pictures (each Plan's
// overview, rendered once at 0.5 px/mm, and up to two sharp layers per Plan) and the marks:
// zoomed out from cached tiles (ADR 0010), painted in short slices, the view's first (ADR
// 0011), zoomed in as vector shapes. 120 ms after the view rests, the visible area plus 25 %
// is rendered sharp by each Plan's worker through the bands it touches. Nothing renders while
// the view moves.
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
  RING_RADIUS_PX,
  rings,
  shiftOf,
  type NotCompared,
  type PageSizes,
  type PlaceSpot,
  type Shown,
  type ViewSettings,
} from "./compareframe";
import { AT_ONCE, Layers, MARK_COLOURS, paintMark, paintMarks, paintMarkSteps, paintNotCompared, paintNotComparedLabels, paintOutline, paintRings, pill, REMOVED_INK, type Pace, type PaintMark, type PaintOutline, type Viewport } from "./comparepaint";
import { Minimap, minimapShapes, type MinimapElements } from "./minimap";
import { levelFor, levelScale, MAX_TILED_S, metricScale, nearestFirst, pictureFor, tilesFor, TILE_PX, type Tile } from "./marktiles";
import { boxOutline, OUTLINE_MARGIN_MM, outlineGroups, outlineOf, type OutlineGroup } from "./outlines";
import type { Role, Sides } from "./openplans";
import { boxSelect, placeAt, type Pickable } from "./picking";
import { PX_PER_MM_100 } from "./planview";
import { BatchSizer, SliceRunner, type Lane } from "./slices";

/** CAD: a plain drag or click replaces, Shift adds, Ctrl removes. */
export type SelectMode = "replace" | "add" | "remove";

/** What the user did on the Plan with the left button (selecting Places, ADR 0003). */
export type PickEvent =
  /** A click: on a Place, or on empty Plan (no is null). */
  | { type: "click"; no: number | null; mode: SelectMode }
  /** A box: the Places it takes. */
  | { type: "box"; nos: number[]; mode: SelectMode };

/** A selection box being dragged (CSS px of the canvas), and what it will do. */
interface DragBox {
  from: { x: number; y: number };
  to: { x: number; y: number };
  mode: SelectMode;
}

const BOX_COLOURS = { remove: "#d0215f", crossing: "#16a34a", window: "#1d5fd6" } as const;
/** A press that moves less than this is a click, CSS px. */
const CLICK_PX = 4;
/** The selected Places are outlined in this blue. */
const SELECT_INK = "#1d5fd6";
const FLY_MS = 380;

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
/**
 * Tiles are painted in slices of about this (ADR 0011), each a task of its own, so that input
 * and frames come between; a slice is made of batches of marks of about BATCH_MS each.
 */
const SLICE_MS = 10;
const BATCH_MS = 5;
/** A tile in view makes the outlines it needs that are not made yet, for up to this; painted ahead, it takes the rough ones. */
const OUTLINE_TILE_MS = 150;
/** Tile canvases kept to be used again. */
const SPARE_CANVASES = 6;

/**
 * A canvas keeps what it is told to draw and rasterizes it only when its picture is used, all
 * at once. Reading a pixel makes it rasterize now: after each batch of a tile painted in
 * slices, so that the cost is spread over the slices, not paid by the first frame to draw it.
 */
const rasterize = (l: CanvasRenderingContext2D) => void l.getImageData(0, 0, 1, 1);
const inMemory = () => {
  const c = document.createElement("canvas");
  c.width = c.height = TILE_PX;
  return c.getContext("2d", { willReadFrequently: true })!;
};

/** A cached picture of the marks in one tile of one level (marktiles.ts). */
interface MarkTile {
  canvas: HTMLCanvasElement;
  /** What the tiles showed when it was painted (the shown marks, the display settings). */
  version: number;
  /** It shows the marks as they are now (its version is the view's), updated when looked at. */
  current: boolean;
  /** Painted with rough outlines (not all made yet): painted again once they are. */
  rough: boolean;
  /** Its outlines are all made now, or a sharp picture of a Plan came: still drawn, and painted again when the view rests. */
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
  /**
   * The marks zoomed out, by level and tile ("k:tx:ty"). When what they show changes they are
   * outdated: still drawn, where nothing up to date can stand in, until painted again.
   */
  private tiles = new Map<string, MarkTile>();
  /** Counts the changes of what the tiles show (the shown marks, the display settings). */
  private tileVersion = 0;
  /** Paints the tiles in slices: those in view first, then those painted ahead (ADR 0011). */
  private readonly painter = new SliceRunner(
    { now: () => performance.now(), later: (fn) => void setTimeout(fn, 0) },
    { sliceMs: SLICE_MS, may: (lane) => lane === "view" || !this.moving, onError: (e) => console.warn("tile not painted", e) },
  );
  /**
   * Each lane paints on its own canvases, so that a tile painted ahead may wait half done
   * while one in view is painted. They are in memory (rasterized on the CPU): a batch is read
   * back without waiting for the GPU. A tile painted is then copied once to a canvas of its own.
   */
  private readonly lanes: Record<Lane, { layers: Layers; work: CanvasRenderingContext2D }> = {
    view: { layers: new Layers({ willReadFrequently: true }), work: inMemory() },
    ahead: { layers: new Layers({ willReadFrequently: true }), work: inMemory() },
  };
  private readonly sizers = new Map<string, BatchSizer>();
  /** Tile canvases to use again (takeCanvas). */
  private readonly spare: HTMLCanvasElement[] = [];
  /** Batches that take about BATCH_MS each, rasterized one by one. */
  private readonly pace: Pace = (() => {
    let t0 = 0;
    const sizer = (phase: string) => {
      let b = this.sizers.get(phase);
      if (!b) this.sizers.set(phase, (b = new BatchSizer(BATCH_MS)));
      return b;
    };
    return {
      size: (phase) => {
        t0 = performance.now();
        return sizer(phase).size();
      },
      done: (phase, l, n) => {
        rasterize(l);
        sizer(phase).took(n, performance.now() - t0);
      },
      flush: rasterize,
    };
  })();
  private frameNo = 0;
  /** What the last frame drew from the tiles, for the tests. */
  private tileStats: { level: number; drawn: number; wanted: number; standIn: number; outdated: number } | null = null;
  private settings: ViewSettings = { ...DEFAULT_SETTINGS };
  /** The Places that are selected (the list and the Plan share one selection). */
  private selected: ReadonlySet<number> = new Set();
  private spotByNo = new Map<number, PlaceSpot>();
  /** The shown Places with their shown marks, for picking; made when first needed after a change. */
  private pickables: Pickable[] | undefined;
  private gesture: { x: number; y: number; mode: SelectMode } | undefined;
  private dragBox: DragBox | undefined;
  private hoverTimer: ReturnType<typeof setTimeout> | undefined;
  private pointer: { x: number; y: number } | undefined;
  private flight: number | undefined;
  private readonly thumbLayers = new Layers();
  /** Told what the left button did on the Plan. */
  onPick: ((e: PickEvent) => void) | undefined;
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
  /** The last frame showed the marks as they are: no tile in view still to paint (for measuring). */
  private marksReady = true;
  /** The tile version the last frame drew with. */
  private drawnVersion = -1;
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
  async show(result: ViewedComparison, shown?: Shown): Promise<void> {
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
    // Which Places and marks are shown (filter and hiding) comes with the result, so that no frame draws it with the wrong ones.
    if (shown) this.shown = shown;
    this.selected = new Set();
    this.frame = comparisonFrame(this.pages, axis, result.setup.offset);
    this.zones = notCompared(result.setup, result.comparison.window, this.pages);
    this.marks = result.comparison.marks.map((m, i) => paintMark(i, m));
    this.placeOf = new Map(result.places.flatMap((p) => p.marks.map((i) => [i, p.no] as const)));
    this.outlines.clear();
    this.roughOutlines.clear();
    this.tiles.clear();
    this.tilesChanged();
    this.pickables = undefined;
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

  /**
   * Which Places and marks are shown (filter and hiding). Nothing moves. The tiles in view are
   * painted again first, in slices; until then the old ones stand in.
   */
  setShown(shown: Shown): void {
    this.shown = shown;
    this.updateSpots();
    this.tilesChanged();
    this.scheduleOutlines();
    this.scheduleTiles();
    this.requestDraw();
  }

  /** The display settings: base Plan, fade, outline, x–x–x, rings, the marks on or off. */
  setSettings(patch: Partial<ViewSettings>): void {
    const changed = (Object.keys(patch) as (keyof ViewSettings)[]).filter((k) => patch[k] !== this.settings[k]);
    this.settings = { ...this.settings, ...patch };
    if (changed.includes("base")) this.updateMinimapPicture();
    // The tiles hold the marks as the settings draw them; the Plan under them, its fade, and whether the marks are on are not in them.
    if (changed.some((k) => k !== "base" && k !== "fade" && k !== "marks")) this.tilesChanged();
    if (changed.length) this.scheduleTiles();
    this.requestDraw();
  }

  /** What the tiles show changed: those painted are outdated, the painting under way stops. */
  private tilesChanged(): void {
    this.tileVersion++;
    this.painter.clear();
  }

  /** Key 1: both Plans whole. */
  fitFrame(): void {
    this.fitRect(this.frame, 0.02);
  }

  /** Key 2: the Plan's width fills the view, from the top of the frame. */
  fitWidth(): void {
    this.stopFlight();
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
    this.stopFlight();
    this.measure();
    const w = Math.max(1, r.x1 - r.x0),
      h = Math.max(1, r.y1 - r.y0);
    this.zoom = clamp(Math.min(this.cssW / (w * (1 + 2 * margin)), this.cssH / (h * (1 + 2 * margin))), MIN_ZOOM, MAX_ZOOM);
    this.cx = (r.x0 + r.x1) / 2;
    this.cy = (r.y0 + r.y1) / 2;
    this.viewUpdated();
  }

  centerOn(p: { x: number; y: number }): void {
    this.stopFlight();
    this.cx = p.x;
    this.cy = p.y;
    this.viewUpdated();
  }

  /** The selected Places, outlined on the Plan. Nothing moves. */
  setSelection(nos: Iterable<number>): void {
    this.selected = new Set(nos);
    this.requestDraw();
  }

  /** Where a Place is now (the box of its shown marks, Old frame mm), if it is shown. */
  placeBox(no: number): Box | null {
    return this.spotByNo.get(no)?.box ?? null;
  }

  /** Key F: the view flies to the selected Places, or fits the whole frame when none is selected. */
  fitSelection(): void {
    let box: Box | null = null;
    for (const no of this.selected) {
      const b = this.spotByNo.get(no)?.box;
      if (b) box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : { ...b };
    }
    if (box) this.flyTo(box);
    else this.fitFrame();
  }

  /**
   * Moves the view to show a box (a Place), in one smooth flight: the zoom changes as it
   * moves. A Place smaller than 50 mm is shown with room around it. Wheel, a drag or the
   * minimap stop it where it is. With reduced motion the view jumps.
   */
  flyTo(box: Box): void {
    this.measure();
    const MIN_MM = 50;
    const w = Math.max(MIN_MM, box.x1 - box.x0),
      h = Math.max(MIN_MM, box.y1 - box.y0);
    const to = {
      cx: (box.x0 + box.x1) / 2,
      cy: (box.y0 + box.y1) / 2,
      zoom: clamp(Math.min(this.cssW / (w * 1.5), this.cssH / (h * 1.5)), MIN_ZOOM, MAX_ZOOM),
    };
    this.stopFlight();
    const from = { cx: this.cx, cy: this.cy, zoom: this.zoom };
    if (!this.active || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      this.setView(to.cx, to.cy, to.zoom);
      return;
    }
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / FLY_MS);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this.zoom = from.zoom * Math.pow(to.zoom / from.zoom, e);
      this.cx = from.cx + (to.cx - from.cx) * e;
      this.cy = from.cy + (to.cy - from.cy) * e;
      this.viewUpdated();
      this.flight = t < 1 ? requestAnimationFrame(tick) : undefined;
    };
    this.flight = requestAnimationFrame(tick);
  }

  private stopFlight(): void {
    if (this.flight !== undefined) cancelAnimationFrame(this.flight);
    this.flight = undefined;
  }

  /** Moves the view without waiting: for measuring frame times. */
  setView(cx: number, cy: number, zoom: number): void {
    this.stopFlight();
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
      selected: [...this.selected],
      settings: { ...this.settings },
      flying: this.flight !== undefined,
      layers: this.pictures ? { old: this.pictures.old.layers.length, new: this.pictures.new.layers.length } : null,
      sharpRenders: this.sharpRenders,
      outlineMs: this.outlineMs,
      outlinesMade: this.outlines.size,
      tiles: this.tileStats,
      marksReady: this.marksReady && this.drawnVersion === this.tileVersion,
      tileVersion: this.tileVersion,
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

  /** Where a shown Place is on screen, CSS px of the canvas (for the tests). */
  placeOnScreen(no: number) {
    const b = this.spotByNo.get(no)?.box;
    if (!b) return null;
    const v = this.visible();
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
        this.fitSelection();
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
    this.stopFlight();
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
    this.stopFlight();
    const p = this.local(e);
    const lines = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * lines * 0.0015));
  }

  private onDown(e: PointerEvent): void {
    if (!this.result) return;
    this.stopFlight();
    // The keys (H, arrows) work after a click on the Plan, also when a field in the sidebar had the focus.
    (document.activeElement as HTMLElement | null)?.blur?.();
    const p = this.local(e);
    if (e.button === 0) {
      // The left button selects (CAD): a click, or a box dragged to the right (fully inside) or left (touching).
      this.gesture = { ...p, mode: e.ctrlKey || e.metaKey ? "remove" : e.shiftKey ? "add" : "replace" };
      this.el.canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 1 && e.button !== 2) return;
    this.pan = { ...p, cx: this.cx, cy: this.cy };
    this.el.canvas.setPointerCapture(e.pointerId);
    this.el.canvas.style.cursor = "grabbing";
    e.preventDefault();
  }

  private onMove(e: PointerEvent): void {
    const p = this.local(e);
    if (this.gesture) {
      const g = this.gesture;
      if (this.dragBox || Math.hypot(p.x - g.x, p.y - g.y) > CLICK_PX) {
        this.dragBox = { from: { x: g.x, y: g.y }, to: p, mode: g.mode };
        this.requestDraw();
      }
      return;
    }
    if (!this.pan) {
      this.hover(p);
      return;
    }
    this.cx = this.pan.cx - (p.x - this.pan.x) / this.zoom;
    this.cy = this.pan.cy - (p.y - this.pan.y) / this.zoom;
    this.viewUpdated();
  }

  private onUp(e: PointerEvent): void {
    if (this.gesture) {
      const g = this.gesture,
        box = this.dragBox;
      this.gesture = undefined;
      this.dragBox = undefined;
      if (this.el.canvas.hasPointerCapture(e.pointerId)) this.el.canvas.releasePointerCapture(e.pointerId);
      if (e.type === "pointercancel") {
        this.requestDraw();
        return;
      }
      if (!box) this.onPick?.({ type: "click", no: this.placeUnder(g.x, g.y), mode: g.mode });
      else {
        const a = this.toMm(box.from),
          b = this.toMm(box.to);
        const r = { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
        this.onPick?.({ type: "box", nos: boxSelect(this.pickList(), r, box.to.x < box.from.x), mode: g.mode });
      }
      this.requestDraw();
      return;
    }
    if (!this.pan) return;
    this.pan = undefined;
    if (this.el.canvas.hasPointerCapture(e.pointerId)) this.el.canvas.releasePointerCapture(e.pointerId);
    this.el.canvas.style.cursor = "";
  }

  /** A point of the canvas (CSS px) in the Old frame, mm. */
  private toMm(p: { x: number; y: number }): { x: number; y: number } {
    const v = this.visible();
    return { x: v.x0 + p.x / this.zoom, y: v.y0 + p.y / this.zoom };
  }

  /** The shown Places with their shown marks. */
  private pickList(): Pickable[] {
    if (!this.pickables && this.result) {
      const marks = this.result.comparison.marks;
      this.pickables = [];
      for (const p of this.result.places) {
        const spot = this.spotByNo.get(p.no);
        if (spot) this.pickables.push({ no: p.no, box: spot.box, marks: p.marks.filter((i) => this.isShown(i)).map((i) => marks[i]!) });
      }
    }
    return this.pickables ?? [];
  }

  /** The smallest Place under a point of the canvas (CSS px), or null. */
  private placeUnder(x: number, y: number): number | null {
    const p = this.toMm({ x, y });
    const tol = (Math.max(this.settings.outline, 3) + 3) / this.zoom;
    const ringed = this.settings.rings && this.settings.marks;
    return placeAt(this.pickList(), p, tol, ringed ? (pl) => this.ringHit(pl, x, y) : undefined);
  }

  /** The pointer is on the ring of a Place that is too small on screen to hit. */
  private ringHit(pl: Pickable, x: number, y: number): boolean {
    const b = pl.box;
    if (Math.max(b.x1 - b.x0, b.y1 - b.y0) * this.zoom >= RING_BELOW_PX) return false;
    const c = { x: ((b.x0 + b.x1) / 2 - this.visible().x0) * this.zoom, y: ((b.y0 + b.y1) / 2 - this.visible().y0) * this.zoom };
    return Math.hypot(c.x - x, c.y - y) <= 14;
  }

  /** The pointer is a hand over a Place, else a cross (looked up at most every 50 ms). */
  private hover(p: { x: number; y: number }): void {
    this.pointer = p;
    if (this.hoverTimer !== undefined || !this.result) return;
    this.hoverTimer = setTimeout(() => {
      this.hoverTimer = undefined;
      if (this.pan || this.gesture || !this.pointer) return;
      this.el.canvas.style.cursor = this.placeUnder(this.pointer.x, this.pointer.y) !== null ? "pointer" : "crosshair";
    }, 50);
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
    this.spotByNo = new Map(this.spots.map((p) => [p.no, p] as const));
    this.pickables = undefined;
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
    if (dpr !== this.dpr) {
      this.tiles.clear();
      this.tilesChanged();
    }
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
      this.painter.kick();
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
  private paintLive(
    ctx: CanvasRenderingContext2D,
    layers: Layers,
    vp: Viewport,
    until: number,
    metricS = vp.s,
    plan: (role: Role) => void = (role) => this.drawPlan(ctx, role, vp),
  ): { marks: number; outlines: number } {
    const { met, vis, groups } = this.liveParts(vp, metricS);
    this.outlinesMissing = false;
    const outs = groups.map(({ g, small }) => (small ? this.roughOutline(g) : this.outlineOf(g, until)));
    paintMarks(ctx, layers, vis, outs, vp, met, this.settings, plan);
    return { marks: vis.length, outlines: outs.length };
  }

  /**
   * What `vp` shows of the marks: the shown marks in it and the outline groups around it
   * (`small`: smaller than a ring on screen, drawn as its rounded box).
   */
  private liveParts(vp: Viewport, metricS: number) {
    // Sizes kept on screen (outline, x–x–x, thinnest line) as at metricS: a tile is drawn at other zooms too.
    const met = markMetrics(this.settings, metricS, vp.dpr);
    const pad = met.outlineMm + met.xxx.distanceMm + (8 * vp.dpr) / vp.s;
    const view = { x0: vp.x0 - pad, y0: vp.y0 - pad, x1: vp.x0 + vp.w / vp.s + pad, y1: vp.y0 + vp.h / vp.s + pad };
    const vis = this.marks.filter((pm) => touches(pm.mark.box, view) && this.isShown(pm.index));
    const m = OUTLINE_MARGIN_MM,
      around = { x0: view.x0 - m, y0: view.y0 - m, x1: view.x1 + m, y1: view.y1 + m };
    const groups: { g: OutlineGroup; small: boolean }[] = [];
    if (met.outlineMm > 0 || this.settings.removed === "xxx") {
      // Smaller than a ring on screen: no outline where the Place gets a ring, else its rounded box.
      const small = (RING_BELOW_PX * vp.dpr) / metricS,
        size = (b: Box) => Math.max(b.x1 - b.x0, b.y1 - b.y0);
      const ringed = new Set(this.settings.rings ? this.spots.filter((p) => size(p.box) < small).map((p) => p.no) : []);
      for (const g of this.groups) {
        if (!touches(g.box, around) || (g.place !== null && ringed.has(g.place))) continue;
        groups.push({ g, small: size(g.box) < small });
      }
    }
    return { met, vis, groups };
  }

  /**
   * A small picture of a Place for the list: both Plans (as the display settings say) around
   * the Place, faded, with the marks that are shown. The regions are rendered by the Plans'
   * workers now, so call it only for a row that is in view. Returns false when the comparison
   * changed meanwhile or the Place is unknown.
   */
  async drawThumbnail(canvas: HTMLCanvasElement, no: number, cssW: number, cssH: number): Promise<boolean> {
    const res = this.result,
      place = res?.places.find((p) => p.no === no);
    if (!res || !place) return false;
    const gen = this.generation,
      dpr = window.devicePixelRatio || 1;
    const W = Math.round(cssW * dpr),
      H = Math.round(cssH * dpr);
    const b = place.box;
    const mw = Math.max(b.x1 - b.x0, 30) * 1.3,
      mh = Math.max(b.y1 - b.y0, 30) * 1.3;
    const s = Math.min(W / mw, H / mh); // device px per mm
    const vp: Viewport = { x0: (b.x0 + b.x1) / 2 - W / 2 / s, y0: (b.y0 + b.y1) / 2 - H / 2 / s, s, w: W, h: H, dpr };
    const roles: Role[] = this.settings.base === "both" ? ["old", "new"] : [this.settings.base];
    const engines = this.deps.engines();
    const maps = new Map<Role, ImageBitmap>();
    try {
      // Both Plans' workers draw at once; with marks on, the changed words' ink comes from each Plan.
      const need: Role[] = this.settings.marks ? ROLES : roles;
      const got = await Promise.all(
        need.map(async (role) => {
          const sh = shiftOf(role, res.setup.axis, res.setup.offset);
          const rect = { x0: vp.x0 - sh.dx, y0: vp.y0 - sh.dy, x1: vp.x0 + W / s - sh.dx, y1: vp.y0 + H / s - sh.dy };
          return [role, await bitmapOf(await engines[role].renderRegion({ rect, pxPerMm: s }))] as const;
        }),
      );
      for (const [role, bm] of got) maps.set(role, bm);
      if (gen !== this.generation) return false;
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, W, H);
      ctx.imageSmoothingQuality = "high";
      const draw = (role: Role) => ctx.drawImage(maps.get(role)!, 0, 0, W, H);
      roles.forEach((role, i) => {
        ctx.globalCompositeOperation = i === 0 ? "source-over" : "darken";
        draw(role);
      });
      ctx.globalCompositeOperation = "source-over";
      if (this.settings.marks && this.settings.fade < 100) {
        ctx.fillStyle = `rgba(255,255,255,${1 - this.settings.fade / 100})`;
        ctx.fillRect(0, 0, W, H);
      }
      if (this.settings.marks) {
        // The changed words' own ink comes from the Plan that draws them.
        this.paintLive(ctx, this.thumbLayers, vp, performance.now() + 25, vp.s, (role) => ctx.drawImage(maps.get(role)!, 0, 0, W, H));
      }
      return true;
    } finally {
      for (const m of maps.values()) m.close();
    }
  }

  /**
   * Paints one tile of the marks at level k, in steps (a batch of marks each, as `pace` says),
   * and keeps it once painted. A tile in view makes the outlines it needs first, for up to
   * OUTLINE_TILE_MS; one painted ahead takes the rough ones for those not made yet. Stopped
   * (by the runner) when what the tiles show changes.
   */
  private *tileJob(k: number, t: Tile, lane: Lane, pace: Pace = this.pace): Generator<void> {
    const version = this.tileVersion;
    const { layers, work } = this.lanes[lane];
    work.setTransform(1, 0, 0, 1, 0, 0);
    work.globalCompositeOperation = "source-over";
    work.globalAlpha = 1;
    work.clearRect(0, 0, TILE_PX, TILE_PX);
    const vp: Viewport = { x0: t.rect.x0, y0: t.rect.y0, s: levelScale(k), w: TILE_PX, h: TILE_PX, dpr: this.dpr };
    layers.size(TILE_PX, TILE_PX);
    const { met, vis, groups } = this.liveParts(vp, metricScale(k));
    yield;
    if (lane === "view") {
      const until = performance.now() + OUTLINE_TILE_MS;
      for (const { g, small } of groups) {
        if (small || this.outlines.has(g.key)) continue;
        if (performance.now() >= until) break;
        this.outlineOf(g);
        yield;
      }
    }
    let rough = false;
    const outs = groups.map(({ g, small }) => {
      if (small) return this.roughOutline(g);
      const o = this.outlines.get(g.key);
      if (!o) rough = true;
      return o ?? this.roughOutline(g);
    });
    yield* paintMarkSteps(work, layers, vis, outs, vp, met, this.settings, (role) => this.drawPlan(work, role, vp), pace);
    if (version !== this.tileVersion) return;
    const canvas = this.takeCanvas();
    canvas.getContext("2d")!.drawImage(work.canvas, 0, 0);
    this.keepTile(`${k}:${t.tx}:${t.ty}`, { canvas, version, current: true, rough, used: this.frameNo });
    this.requestDraw();
  }

  /**
   * Tile canvases are used again rather than made anew: a new 4 MB canvas for every tile
   * painted, the old one dropped, cost pauses of a few hundred ms in the measurements.
   */
  private takeCanvas(): HTMLCanvasElement {
    const c = this.spare.pop();
    if (!c) {
      const n = document.createElement("canvas");
      n.width = n.height = TILE_PX;
      return n;
    }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, TILE_PX, TILE_PX);
    return c;
  }

  private spareCanvas(c: HTMLCanvasElement): void {
    if (this.spare.length < SPARE_CANVASES) this.spare.push(c);
  }

  /** Keeps a tile painted; the picture it replaces is used again. */
  private keepTile(key: string, tile: MarkTile): void {
    const was = this.tiles.get(key);
    if (was) this.spareCanvas(was.canvas);
    this.tiles.set(key, tile);
  }

  /** Drops a tile; its canvas is used again. */
  private dropTile(key: string): void {
    const was = this.tiles.get(key);
    if (!was) return;
    this.tiles.delete(key);
    this.spareCanvas(was.canvas);
  }

  /** A tile's picture, if painted; `current` says whether it is up to date. */
  private tileAt(k: number, tx: number, ty: number): MarkTile | undefined {
    const tile = this.tiles.get(`${k}:${tx}:${ty}`);
    if (tile) tile.current = tile.version === this.tileVersion;
    return tile;
  }

  /**
   * Paints the coarse levels of the whole frame ahead while the view rests, coarsest first,
   * in slices after the tiles in view, so that zooming out finds them there.
   */
  private scheduleTiles(): void {
    const jobs: { key: string; start: () => Generator<void> }[] = [];
    // Room is left for the tiles in view: painting ahead never pushes them out.
    if (this.result && this.settings.marks && this.tiles.size <= MAX_TILES - 12) {
      // From the level that shows the whole frame.
      const f = this.frame,
        fit = Math.min(this.el.canvas.width / (f.x1 - f.x0), this.el.canvas.height / (f.y1 - f.y0), MAX_TILED_S);
      for (let k = levelFor(fit) ?? 0; k >= 0; k--) {
        const ts = tilesFor(k, f, f);
        if (ts.length > AHEAD_TILES) break;
        for (const t of ts) {
          const tile = this.tileAt(k, t.tx, t.ty);
          if (!tile?.current || tile.stale) jobs.push({ key: `${k}:${t.tx}:${t.ty}`, start: () => this.tileJob(k, t, "ahead") });
        }
      }
    }
    this.painter.set("ahead", jobs);
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
      if (touches(t, r)) this.tiles.get(key)!.stale = true;
    }
    this.scheduleTiles();
  }

  /** The tiles the view opens with, painted now (inside the busy window). */
  private paintVisibleTiles(): void {
    if (!this.settings.marks) return;
    const vp = this.viewport(),
      k = levelFor(vp.s);
    if (k === null) return;
    for (const t of tilesFor(k, this.frame, this.visible())) {
      if (this.tiles.has(`${k}:${t.tx}:${t.ty}`)) continue;
      const steps = this.tileJob(k, t, "view", AT_ONCE);
      while (!steps.next().done);
    }
  }

  /**
   * Draws the marks from the tiles of level k. A tile not painted or not up to date is stood
   * in for (pictureFor) and asked of the painter, the middle of the view first: at rest, or
   * while the view moves when nothing up to date can stand in. Nothing waits for a tile.
   */
  private drawTiles(ctx: CanvasRenderingContext2D, vp: Viewport, k: number): void {
    const frameNo = ++this.frameNo;
    const stats = (this.tileStats = { level: k, drawn: 0, wanted: 0, standIn: 0, outdated: 0 });
    const want: Tile[] = [];
    let ready = true;
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
    const v = this.visible();
    const get = (kk: number, tx: number, ty: number) => this.tileAt(kk, tx, ty);
    for (const t of nearestFirst(tilesFor(k, this.frame, v), { x: (v.x0 + v.x1) / 2, y: (v.y0 + v.y1) / 2 })) {
      const pic = pictureFor(k, t, this.frame, get);
      if (pic.own && pic.current) {
        // Up to date; one with rough outlines is painted again at rest.
        if (pic.own.stale && !this.moving) want.push(t);
        place(pic.own, t.rect);
        stats.drawn++;
        continue;
      }
      ready = false;
      if (!this.moving || !pic.current) want.push(t);
      if (!pic.current) stats.outdated++;
      if (pic.own) place(pic.own, t.rect);
      else if (pic.cover) {
        stats.standIn++;
        ctx.save();
        ctx.beginPath();
        ctx.rect((t.rect.x0 - vp.x0) * vp.s, (t.rect.y0 - vp.y0) * vp.s, (t.rect.x1 - t.rect.x0) * vp.s, (t.rect.y1 - t.rect.y0) * vp.s);
        ctx.clip();
        for (const [u, rect] of pic.cover.tiles) place(u, rect);
        ctx.restore();
      }
    }
    ctx.restore();
    this.marksReady = ready;
    stats.wanted = want.length;
    this.painter.set(
      "view",
      want.map((t) => ({ key: `${k}:${t.tx}:${t.ty}`, start: () => this.tileJob(k, t, "view") })),
    );
    // Keep the most recently drawn.
    if (this.tiles.size > MAX_TILES) {
      const old = [...this.tiles].filter(([, t]) => t.used !== frameNo).sort((a, b) => a[1].used - b[1].used);
      for (const [key] of old.slice(0, this.tiles.size - MAX_TILES)) this.dropTile(key);
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

  /** The selected Places: a blue frame round each, at least a ring's size, drawn over the marks. */
  private paintSelection(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    if (!this.selected.size) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const pad = 4 * vp.dpr,
      min = 2 * RING_RADIUS_PX * vp.dpr;
    for (const no of this.selected) {
      const b = this.spotByNo.get(no)?.box;
      if (!b) continue;
      let x = (b.x0 - vp.x0) * vp.s - pad,
        y = (b.y0 - vp.y0) * vp.s - pad,
        w = (b.x1 - b.x0) * vp.s + 2 * pad,
        h = (b.y1 - b.y0) * vp.s + 2 * pad;
      if (x > vp.w || y > vp.h || x + w < 0 || y + h < 0) continue;
      if (w < min) (x -= (min - w) / 2), (w = min);
      if (h < min) (y -= (min - h) / 2), (h = min);
      const r = Math.min(8 * vp.dpr, w / 2, h / 2);
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.lineWidth = 4.5 * vp.dpr;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.stroke();
      ctx.lineWidth = 2.2 * vp.dpr;
      ctx.strokeStyle = SELECT_INK;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The selection box while it is dragged: solid blue to the right (fully inside), dashed green to the left (touching), red to remove. */
  private paintDragBox(ctx: CanvasRenderingContext2D): void {
    const b = this.dragBox;
    if (!b) return;
    const d = this.dpr,
      crossing = b.to.x < b.from.x;
    const colour = b.mode === "remove" ? BOX_COLOURS.remove : crossing ? BOX_COLOURS.crossing : BOX_COLOURS.window;
    const x = Math.min(b.from.x, b.to.x) * d,
      y = Math.min(b.from.y, b.to.y) * d,
      w = Math.abs(b.to.x - b.from.x) * d,
      h = Math.abs(b.to.y - b.from.y) * d;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = colour + "1f";
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.3 * d;
    ctx.setLineDash(crossing ? [6 * d, 4 * d] : []);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
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
    this.marksReady = true;
    this.drawnVersion = this.tileVersion;
    if (!marksOn) this.painter.set("view", []);
    if (marksOn) {
      const v = this.visible();
      const level = levelFor(vp.s);
      if (level === null) {
        // Zoomed in: few marks in view, painted live; no tile is wanted for the view.
        this.tileStats = null;
        this.painter.set("view", []);
        const n = this.paintLive(ctx, this.layers, vp, t0 + OUTLINE_FRAME_MS);
        this.marksReady = !this.outlinesMissing;
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
    if (!this.peek) {
      this.paintSelection(ctx, vp);
      this.paintDragBox(ctx);
    }
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
    /** A shown Place on screen, in the canvas's CSS px (null when it is not in view). */
    placeOnScreen: (no: number) => view.placeOnScreen(no),
    setShown: (places: number[] | null) => view.setShown(places ? { place: (no) => places.includes(no) } : {}),
  };
  return view;
}
