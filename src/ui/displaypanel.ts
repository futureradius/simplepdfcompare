// "Darstellung": the display settings of the comparison view, folded away in the sidebar and
// remembered in this browser (ADR 0003). The controls only call `onChange` with what changed.
//
// Ported from the comparison-view prototype (common.mjs: baseSwitch, outlineSlider, removedSwitch,
// xSizeSlider, fadeSlider, check, legend), as plain controls in the app's look.

import type { ViewSettings } from "./compareframe";
import { LEGEND_COLOURS } from "./compareview";
import { SETTINGS_LIMITS } from "./displaysettings";
import { h } from "./dom";

export interface DisplayPanel {
  el: HTMLDetailsElement;
  /** Shows these settings in the controls (without calling onChange). */
  set(s: ViewSettings): void;
}

type Option<T extends string> = [T, string];

/** Words as radio buttons: the chosen one is highlighted. */
function wordSwitch<T extends string>(label: string, options: readonly Option<T>[], pick: (v: T) => void) {
  const buttons = options.map(([v, text]) => h("button", { class: "wsw-btn", type: "button", role: "radio", data: { value: v }, on: { click: () => pick(v) } }, text));
  const el = h("div", { class: "wsw", role: "radiogroup", aria: { label } }, ...buttons);
  return {
    el,
    set(v: T) {
      for (const b of buttons) b.setAttribute("aria-checked", String(b.dataset.value === v));
    },
  };
}

function slider(label: string, lim: { min: number; max: number; step: number }, unit: string, input: (v: number) => void, title = "") {
  const range = h("input", { type: "range" });
  range.min = String(lim.min);
  range.max = String(lim.max);
  range.step = String(lim.step);
  const value = h("span", { class: "num" });
  range.addEventListener("input", () => {
    value.textContent = `${range.value}${unit}`;
    input(Number(range.value));
  });
  const el = h("label", { class: "disp-row", title }, h("span", { class: "disp-name" }, label), range, value);
  return {
    el,
    set(v: number) {
      range.value = String(v);
      value.textContent = `${v}${unit}`;
    },
  };
}

function check(label: string, change: (v: boolean) => void, title = "") {
  const box = h("input", { type: "checkbox" });
  box.addEventListener("change", () => change(box.checked));
  return {
    el: h("label", { class: "disp-check", title }, box, label),
    set(v: boolean) {
      box.checked = v;
    },
  };
}

export function createDisplayPanel(initial: ViewSettings, onChange: (patch: Partial<ViewSettings>) => void): DisplayPanel {
  const base = wordSwitch<ViewSettings["base"]>("Plan unter den Markierungen", [["old", "Alt"], ["new", "Neu"], ["both", "Beide"]], (base) => onChange({ base }));
  const marks = check("Markierungen zeigen (M)", (marks) => onChange({ marks }));
  const outline = slider("Umriss", SETTINGS_LIMITS.outline, " px", (outline) => onChange({ outline }));
  const removed = wordSwitch<ViewSettings["removed"]>("Wie Weggefallenes umrandet wird", [["soft", "Schleier"], ["xxx", "x–x–x"]], (removed) => onChange({ removed }));
  const xSize = slider("Größe der x", SETTINGS_LIMITS.xSize, " %", (xSize) => onChange({ xSize }), "Größe und Abstand der x, Strichstärke");
  const fade = slider("Plan blass", SETTINGS_LIMITS.fade, " %", (fade) => onChange({ fade }), "Wie kräftig der Plan unter den Markierungen ist");
  const rings = check("Kleine Stellen mit Ring zeigen", (rings) => onChange({ rings }));
  const xRow = xSize.el;

  const swatch = (colour: string) => h("span", { class: "sw", style: `background:${colour}` });
  const legend = h(
    "ul",
    { class: "marks-legend" },
    h("li", {}, swatch(LEGEND_COLOURS.added), "Hinzugefügt: nur im neuen Plan"),
    h("li", {}, swatch(LEGEND_COLOURS.removed), "Entfernt: nur im alten Plan"),
    h("li", {}, swatch(LEGEND_COLOURS.unchanged), "Unverändert: Teil, den beide Pläne zeichnen"),
  );
  const el = h(
    "details",
    { class: "display", data: { part: "display" } },
    h("summary", {}, "Darstellung ", h("span", { class: "muted" }, "(bleibt in diesem Browser gespeichert)")),
    h(
      "div",
      { class: "display-body" },
      h("div", { class: "disp-row" }, h("span", { class: "disp-name" }, "Unter den Markierungen"), base.el),
      marks.el,
      outline.el,
      h("div", { class: "disp-row" }, h("span", { class: "disp-name" }, "Weggefallenes"), removed.el),
      xRow,
      fade.el,
      rings.el,
      h("p", { class: "note" }, "Leertaste halten: nur neuer Plan · Strg + Leertaste: nur alter Plan · M: Markierungen aus oder an"),
      legend,
    ),
  );
  const set = (s: ViewSettings) => {
    base.set(s.base);
    marks.set(s.marks);
    outline.set(s.outline);
    removed.set(s.removed);
    xSize.set(s.xSize);
    xRow.hidden = s.removed !== "xxx";
    fade.set(s.fade);
    rings.set(s.rings);
  };
  set(initial);
  return { el, set };
}
