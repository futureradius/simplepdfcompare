// The display settings of the comparison view (ADR 0003: "folded away and remembered in the
// browser"): what is read back from storage is checked value by value, so a damaged or old
// entry never breaks the view.

import { DEFAULT_SETTINGS, type ViewSettings } from "./compareframe";

export const SETTINGS_LIMITS = {
  outline: { min: 0, max: 50, step: 1 },
  fade: { min: 10, max: 100, step: 5 },
  xSize: { min: 40, max: 160, step: 5 },
} as const;

const KEY = "simplepdfcompare.display";

const clamp = (v: unknown, lim: { min: number; max: number }, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(lim.max, Math.max(lim.min, Math.round(v))) : fallback);

export function parseSettings(raw: unknown): ViewSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SETTINGS;
  return {
    base: o.base === "old" || o.base === "new" || o.base === "both" ? o.base : d.base,
    marks: typeof o.marks === "boolean" ? o.marks : d.marks,
    fade: clamp(o.fade, SETTINGS_LIMITS.fade, d.fade),
    outline: clamp(o.outline, SETTINGS_LIMITS.outline, d.outline),
    removed: o.removed === "xxx" || o.removed === "soft" ? o.removed : d.removed,
    xSize: clamp(o.xSize, SETTINGS_LIMITS.xSize, d.xSize),
    rings: typeof o.rings === "boolean" ? o.rings : d.rings,
  };
}

export function loadSettings(): ViewSettings {
  try {
    return parseSettings(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return parseSettings(null);
  }
}

export function storeSettings(s: ViewSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // not remembered; the settings still work
  }
}
