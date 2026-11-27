// The filter of the list (ADR 0003, ADR 0008): a button that opens a checkbox list of the kinds
// of change, like Excel's filter, and the Wann and Wo range panels that open from the funnels
// beside those column titles. It only changes the filter held by PlacesState.
//
// Ported from the comparison-view prototype (variant-a.mjs: drawFilter, drawFilterButton,
// rangeBtn, rangePanel).

import { KINDS, type KindOfChange } from "../compare/kinds";
import type { Place } from "../compare/places";
import { dateText, kindText } from "../compare/wording";
import { FUNNEL, h } from "./dom";
import { kindCounts, kindOn, parseDay, parseKm, setAllKinds, setKind, setRange, type PlaceFilter, type Range } from "./placefilter";
import type { PlacesState } from "./placesstate";

/** An open end of a range (the filter is plain data, which has no Infinity). */
export const OPEN_END = 1e9;

/** One line about each kind: what it means (shown under its checkbox). */
const KIND_HINT: Record<KindOfChange, string> = {
  later: "nach hinten verschoben, gleich lang",
  earlier: "vorgezogen, gleich lang",
  longer: "länger entlang der Zeit",
  shorter: "kürzer entlang der Zeit",
  movedAcross: "anderer Ort (quer zur Zeit), gleiche Zeit",
  textChanged: "Beschriftung neu, entfallen oder anders",
  new: "nur im neuen Plan",
  gone: "nur im alten Plan",
  recoloured: "gleiche Form, andere Farbe",
  lineWidth: "gleiche Form und Farbe, dickere oder dünnere Linien",
  labelMoved: "nur ein Text an anderer Stelle, gleicher Wortlaut",
  other: "Form geändert oder mehreres zugleich",
};

const deNum = (v: number) => v.toLocaleString("de-DE", { maximumFractionDigits: 3 });
const two = (n: number) => String(n).padStart(2, "0");

/** A day count as typed: "03.06.27", with the time when it is not a whole day; a closing end is the day before. */
export function dayText(d: number, end: boolean): string {
  const mins = Math.round(d * 1440);
  if (mins % 1440 === 0) return dateText(end ? mins / 1440 - 1 : mins / 1440);
  return `${dateText(Math.floor(mins / 1440))} ${two(Math.floor((mins % 1440) / 60))}:${two(mins % 60)}`;
}

type RangeKind = "when" | "where";

const RANGE = {
  where: {
    title: "Wo: nur Stellen in diesem km-Bereich",
    from: "von km",
    to: "bis km",
    placeholder: ["z. B. 12,4", "z. B. 14 + 500"],
    show: (v: number, _end: boolean) => deNum(v),
  },
  when: {
    title: "Wann: nur Stellen in dieser Zeit",
    from: "von",
    to: "bis",
    placeholder: ["TT.MM.JJ hh:mm", "TT.MM.JJ"],
    show: (v: number, end: boolean) => dayText(v, end),
  },
} as const;

/** "km 12,4 – …" / "03.06.27 – 10.06.27": a range as the filter button and the tooltips say it. */
export function rangeText(kind: RangeKind, r: Range): string {
  const U = RANGE[kind];
  return `${r[0] > -OPEN_END ? U.show(r[0], false) : "…"} – ${r[1] < OPEN_END ? U.show(r[1], true) : "…"}`;
}

export class FilterPanel {
  /** The button and its panel, to put into the sidebar. */
  readonly el: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private rangeOpen: { close(): void } | undefined;

  constructor(private readonly state: PlacesState) {
    this.button = h("button", { class: "btn filter-btn", type: "button", title: "Nach Art der Änderung filtern", aria: { haspopup: "true", expanded: "false" } });
    this.panel = h("div", { class: "filter-panel", hidden: true, role: "dialog", aria: { label: "Filter nach Art der Änderung" } });
    this.el = h("div", { class: "filter-wrap" }, this.button, this.panel);
    this.button.addEventListener("click", () => (this.panel.hidden ? this.open() : this.close()));
    document.addEventListener(
      "pointerdown",
      (e) => {
        const t = e.target as Node;
        if (!this.panel.hidden && !this.panel.contains(t) && !this.button.contains(t)) this.close();
      },
      true,
    );
    // Esc closes the list also when a click inside it has rebuilt the checkbox that had the focus.
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Escape" || this.panel.hidden) return;
        e.stopPropagation();
        this.close();
      },
      true,
    );
    this.panel.addEventListener("keydown", (e) => {
      e.stopPropagation(); // the view's keys do not apply while the list is open
      if (e.key === "Escape") {
        this.close();
        this.button.focus();
      }
    });
    this.draw();
  }

  open(): void {
    this.panel.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    this.drawPanel();
  }

  close(): void {
    this.panel.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
  }

  /** The filter changed or a new result came: draw the button, and the list when it is open. */
  draw(): void {
    const f = this.state.filter;
    const on = KINDS.filter((k) => kindOn(f, k)).length;
    const ranges = (["when", "where"] as const).flatMap((k) => (f[k] ? [`${k === "when" ? "Wann" : "Wo"} ${rangeText(k, f[k]!)}`] : []));
    const all = on === KINDS.length;
    this.button.replaceChildren(
      ...[
        FUNNEL(),
        h("span", { class: "grow" }, "Filter"),
        ranges.length ? h("span", { class: "filter-ranges" }, ranges.join(" · ")) : null,
        h("span", { class: all ? "muted" : "accent" }, `${all ? "alle" : `${on} von ${KINDS.length}`} ▾`),
      ].filter((n): n is NonNullable<typeof n> => n !== null),
    );
    if (!this.panel.hidden) this.drawPanel();
  }

  private drawPanel(): void {
    const places = this.state.places,
      f = this.state.filter;
    const counts = kindCounts(places);
    const multi = places.filter((p) => p.kinds.length > 1).length;
    const row = (checked: boolean, label: string, n: number, hint: string | null, onchange: (v: boolean) => void, bold = false, kind = "") => {
      const input = h("input", { type: "checkbox", data: kind ? { kind } : {} });
      input.checked = checked;
      input.addEventListener("change", () => onchange(input.checked));
      return h(
        "label",
        { class: `filter-row${n === 0 ? " zero" : ""}` },
        input,
        h("span", { class: bold ? "strong" : "" }, label),
        h("span", { class: "muted num" }, String(n)),
        hint ? h("span", { class: "note", style: "grid-column: 2 / 4" }, hint) : null,
      );
    };
    const allOn = KINDS.every((k) => kindOn(f, k)),
      noneOn = KINDS.every((k) => !kindOn(f, k));
    const all = row(allOn, "(Alle auswählen)", places.length, null, (v) => this.state.setFilter(setAllKinds(f, v)), true, "all");
    if (!allOn && !noneOn) all.querySelector("input")!.indeterminate = true;
    this.panel.replaceChildren(
      h("div", { class: "note filter-rule" }, `Eine Stelle kann mehrere Arten haben (${multi} hier). Sie erscheint, wenn eine davon angehakt ist; jede Markierung folgt ihrer Art. Die Zahlen können zusammen mehr ergeben als die Stellen.`),
      all,
      h("hr"),
      ...KINDS.map((k) => row(kindOn(f, k), kindText(k), counts[k], KIND_HINT[k], (v) => this.state.setFilter(setKind(this.state.filter, k, v)), false, k)),
      h("div", { class: "filter-foot" }, h("button", { class: "btn", type: "button", on: { click: () => this.close() } }, "OK")),
    );
  }

  /** The funnel beside a column title (Wann, Wo): opens the range panel; filled while a range is set. */
  rangeButton(kind: RangeKind): HTMLButtonElement {
    const r = this.state.filter[kind];
    const b = h("button", { class: `range-btn${r ? " on" : ""}`, type: "button", title: r ? `${RANGE[kind].title}: ${rangeText(kind, r)}` : RANGE[kind].title }, FUNNEL(12));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openRange(kind, b);
    });
    return b;
  }

  private openRange(kind: RangeKind, anchor: HTMLElement): void {
    this.rangeOpen?.close();
    const U = RANGE[kind],
      cur = this.state.filter[kind],
      box = anchor.getBoundingClientRect();
    const input = (v: string, placeholder: string) => {
      const i = h("input", { type: "text", style: "width:100%" });
      i.value = v;
      i.placeholder = placeholder;
      return i;
    };
    const a = input(cur && cur[0] > -OPEN_END ? U.show(cur[0], false) : "", U.placeholder[0]);
    const b = input(cur && cur[1] < OPEN_END ? U.show(cur[1], true) : "", U.placeholder[1]);
    const msg = h("div", { class: "note range-msg" });
    const year = yearOf(this.state.places);
    const apply = () => {
      const lo = a.value.trim() ? (kind === "where" ? parseKm(a.value) : parseDay(a.value, false, year)) : -OPEN_END;
      const hi = b.value.trim() ? (kind === "where" ? parseKm(b.value) : parseDay(b.value, true, year)) : OPEN_END;
      if (lo === null || hi === null) {
        msg.textContent = `Nicht verstanden. Beispiel: ${U.placeholder.join(" oder ")}`;
        return;
      }
      this.state.setFilter(setRange(this.state.filter, kind, lo === -OPEN_END && hi === OPEN_END ? null : [Math.min(lo, hi), Math.max(lo, hi)]));
      panel.close();
    };
    // The region marked on the Plan: the extent of the selected Places.
    const picked = this.state.places.filter((p) => this.state.selection.has(p.no) && (kind === "where" ? p.where : p.when));
    const fromSelection = picked.length
      ? h(
          "button",
          {
            class: "btn",
            type: "button",
            title: "Den Bereich der im Plan ausgewählten Stellen übernehmen",
            on: {
              click: () => {
                const lo = Math.min(...picked.map((p) => (kind === "where" ? p.where!.from : p.when!.from))),
                  hi = Math.max(...picked.map((p) => (kind === "where" ? p.where!.to : p.when!.to)));
                a.value = U.show(lo, false);
                b.value = U.show(hi, true);
              },
            },
          },
          `wie Auswahl (${picked.length})`,
        )
      : null;
    for (const x of [a, b])
      x.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") apply();
        if (e.key === "Escape") panel.close();
      });
    const outside = (e: PointerEvent) => {
      if (!panel.contains(e.target as Node) && !anchor.contains(e.target as Node)) panel.close();
    };
    const panel = Object.assign(
      h(
        "div",
        { class: "range-panel", role: "dialog", aria: { label: U.title }, style: `left:${Math.max(8, Math.min(box.left - 120, innerWidth - 268))}px;top:${box.bottom + 6}px` },
        h("b", {}, U.title),
        h("label", {}, U.from, a),
        h("label", {}, U.to, b),
        msg,
        h(
          "div",
          { class: "range-foot" },
          fromSelection,
          h("button", { class: "btn", type: "button", on: { click: () => (this.state.setFilter(setRange(this.state.filter, kind, null)), panel.close()) } }, "Leeren"),
          h("button", { class: "btn primary", type: "button", on: { click: apply } }, "OK"),
        ),
      ),
      {
        close: () => {
          panel.remove();
          document.removeEventListener("pointerdown", outside, true);
          if (this.rangeOpen === panel) this.rangeOpen = undefined;
        },
      },
    );
    document.body.append(panel);
    this.rangeOpen = panel;
    a.focus();
    setTimeout(() => document.addEventListener("pointerdown", outside, true));
  }
}

/** The year the Plan's dates are in: a typed day without a year gets it. */
function yearOf(places: readonly Place[]): number {
  const p = places.find((q) => q.when);
  return p?.when ? new Date(p.when.from * 86400000).getUTCFullYear() : new Date().getFullYear();
}

export type { PlaceFilter };
