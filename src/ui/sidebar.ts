// The sidebar (ADR 0009): its width can be dragged at its right edge until the Plan view
// keeps a third of the window. Adapted from the clipper, whose cap is a fixed 560 px.
// Two remembered widths, one for the setup tabs and one for "Vergleich". Remembered in
// this browser; storage may be unavailable, so every access is guarded.

import type { TabId } from "./tabs";

export const PANEL_DEFAULT = 400;
/** The width the five tab names need. */
export const PANEL_MIN = 400;
/** Arrow keys on the focused handle change the width by this much. */
const KEY_STEP = 16;

/** One width shared by the setup tabs, one for "Vergleich" (its table is dense). */
export type PanelKind = "setup" | "compare";

const WIDTH_KEY: Record<PanelKind, string> = {
  setup: "simplepdfcompare.panelWidth",
  compare: "simplepdfcompare.panelWidthVergleich", // renamed when the default became wider, so an older remembered width does not hide it
};

export const panelKindFor = (tab: TabId): PanelKind => (tab === "compare" ? "compare" : "setup");

/** The width the sidebar may have in a window this wide: at least the tab names, at most two thirds. */
export function clampPanelWidth(width: number, windowWidth: number): number {
  const max = Math.max(PANEL_MIN, Math.floor((windowWidth * 2) / 3));
  if (!Number.isFinite(width)) return Math.min(PANEL_DEFAULT, max);
  return Math.round(Math.min(max, Math.max(PANEL_MIN, width)));
}

/** What the list of Places needs in "Vergleich" to show every column without scrolling sideways. */
export const COMPARE_TABLE_W = 780;

/**
 * Setup: the width the tab names need. "Vergleich": wide, for the table of Places: 60 % of the
 * window but at least what the table needs (both capped at two thirds). Double-click resets to this.
 */
export function defaultPanelWidth(kind: PanelKind, windowWidth: number): number {
  return kind === "setup" ? PANEL_DEFAULT : clampPanelWidth(Math.max(windowWidth * 0.6, COMPARE_TABLE_W), windowWidth);
}

/** A remembered width, or undefined if none (usable) is stored. */
export function readPanelWidth(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not remembered; the sidebar still works
  }
}

export interface PanelResize {
  /** Switches to the width of the other kind (the tab changed). */
  setKind(kind: PanelKind): void;
}

/**
 * Wires the resize handle: `app` holds the sidebar width in `--panel-w`. Dragging the
 * handle sets it, double-click resets it to the kind's default, arrow keys nudge it.
 */
export function setUpPanelResize(app: HTMLElement, handle: HTMLElement): PanelResize {
  let kind: PanelKind = "setup";
  const remembered = () => readPanelWidth(load(WIDTH_KEY[kind])) ?? defaultPanelWidth(kind, window.innerWidth);
  let width = clampPanelWidth(remembered(), window.innerWidth);
  const apply = (w: number, remember: boolean) => {
    width = clampPanelWidth(w, window.innerWidth);
    app.style.setProperty("--panel-w", `${width}px`);
    handle.setAttribute("aria-valuenow", String(width));
    if (remember) store(WIDTH_KEY[kind], String(width));
  };
  handle.setAttribute("aria-valuemin", String(PANEL_MIN));
  apply(width, false);

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = width;
    document.body.classList.add("resizing-panel");
    const move = (ev: PointerEvent) => apply(startW + ev.clientX - startX, false);
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      document.body.classList.remove("resizing-panel");
      apply(width, true);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
  handle.addEventListener("dblclick", () => apply(defaultPanelWidth(kind, window.innerWidth), true));
  handle.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowLeft" ? -KEY_STEP : e.key === "ArrowRight" ? KEY_STEP : 0;
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    apply(width + step, true);
  });
  window.addEventListener("resize", () => apply(remembered(), false));
  return {
    setKind(next) {
      if (next === kind) return;
      kind = next;
      apply(remembered(), false);
    },
  };
}
