// The sidebar of "Alter Plan" and "Neuer Plan": Kopf, Fuß and the Bereiche as rows (the name
// is a dropdown that changes the zone's kind, then size, ×), what a new drag draws,
// "Zurücksetzen" and "Weiter". The view holds the same zones; this is the list beside it.

import type { Axis } from "../compare/objects";
import { effectiveBox, KIND_NAME, lengthOf, sizeText, zoneLabel, type PageMm, type PlanZones, type ZoneKind } from "../zones/model";
import { createKindMenu } from "./kindmenu";

export interface ZonePanelHandlers {
  select(id: number): void;
  removeZone(id: number): void;
  removeLine(which: "header" | "footer"): void;
  setZoneKind(id: number, kind: ZoneKind): void;
  setDrawKind(kind: ZoneKind): void;
  reset(): void;
  next(): void;
}

export interface ZonePanelState {
  pz: PlanZones;
  selected: number | undefined;
  axis: Axis;
  page: PageMm;
}

const KINDS: ZoneKind[] = ["area", "time", "path", "rows"];
const KIND_TITLE: Record<ZoneKind, string> = {
  area: "Ausgenommen: wird nicht verglichen",
  time: "Zeitachse: hier stehen die Daten und Uhrzeiten (wird nur gelesen)",
  path: "Wegachse: hier steht der Kilometer (wird nur gelesen)",
  rows: "Vorgänge: hier stehen die Zeilennamen (wird nur gelesen)",
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};
const mm = (v: number) => `${Math.round(v).toLocaleString("de-DE")} mm`;

export class ZonePanel {
  private readonly root = el("div", "zone-panel-inner");
  private readonly lines = el("div", "zone-rows");
  private readonly areas = el("div", "zone-rows");
  private readonly chips: HTMLButtonElement[] = [];
  private selected: number | undefined;
  /** After the next update: focus this zone's dropdown, or open it. */
  private after: { id: number; open: boolean } | undefined;

  constructor(
    role: "old" | "new",
    private readonly h: ZonePanelHandlers,
    private kind: ZoneKind,
  ) {
    const root = this.root;
    root.append(el("h2", "", role === "old" ? "Alter Plan" : "Neuer Plan"));
    root.append(
      el(
        "p",
        "",
        role === "old"
          ? "Was wird verglichen? Kopf und Fuß sind erkannt. Ziehen Sie die blauen Linien, oder ziehen Sie auf dem Plan einen Bereich auf. Was „Ausgenommen“ ist, wird nicht verglichen."
          : "Die Bereiche des alten Plans sind hierher kopiert. Schraffiert steht, wo sie im alten Plan lagen. Passen Sie sie an, falls nötig.",
      ),
    );
    root.append(el("h3", "", "Kopf und Fuß"), this.lines, el("h3", "", "Bereiche"), this.areas);
    // What a new drag draws: only the buttons.
    const chips = el("div", "kind-chips");
    chips.setAttribute("role", "radiogroup");
    chips.setAttribute("aria-label", "Art des nächsten Bereichs");
    for (const k of KINDS) {
      const b = el("button", "", KIND_NAME[k]);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.title = KIND_TITLE[k];
      b.dataset.kind = k;
      b.setAttribute("aria-checked", String(k === this.kind));
      b.addEventListener("click", () => {
        this.setDrawKind(k);
        h.setDrawKind(k);
      });
      this.chips.push(b);
      chips.append(b);
    }
    root.append(chips);
    const actions = el("div", "zone-actions");
    const reset = el("button", "btn", "Zurücksetzen");
    reset.type = "button";
    reset.dataset.action = "reset";
    reset.title = role === "old" ? "Zurück zu erkanntem Kopf und Fuß, ohne weitere Bereiche" : "Die Bereiche des alten Plans erneut übernehmen";
    reset.addEventListener("click", () => h.reset());
    const next = el("button", "btn primary", "Weiter");
    next.type = "button";
    next.dataset.action = "next";
    next.addEventListener("click", () => h.next());
    actions.append(reset, next);
    root.append(actions);
    root.append(
      el(
        "p",
        "zone-hint",
        "Mausrad: zoomen. Rechte oder mittlere Maustaste: verschieben. Alt: ohne Einrasten ziehen. Entf: gewählten Bereich löschen. Tasten 1, 2, 3 und F: Ganzer Plan, Planbreite, 1:1, gewählter Bereich.",
      ),
    );
  }

  /** Puts the panel into its sidebar section (replacing what another setup showed there). */
  mount(host: HTMLElement): void {
    host.replaceChildren(this.root);
  }

  /** What a new drag draws (the chosen button). */
  setDrawKind(kind: ZoneKind): void {
    this.kind = kind;
    for (const c of this.chips) c.setAttribute("aria-checked", String(c.dataset.kind === kind));
  }

  update(s: ZonePanelState): void {
    this.selected = s.selected;
    const len = lengthOf(s.page, s.axis);
    const lineRow = (name: string, which: "header" | "footer", size: number, deleted: boolean) => {
      const row = el("div", "zone-row");
      row.dataset.line = which;
      row.append(el("span", "name", name), el("span", "size", deleted ? "gelöscht" : mm(size)));
      const x = el("button", "x", "×");
      x.type = "button";
      x.title = `${name} löschen (die Linie bleibt am Rand)`;
      x.setAttribute("aria-label", x.title);
      x.disabled = deleted;
      x.addEventListener("click", () => this.h.removeLine(which));
      row.append(x);
      return row;
    };
    this.lines.replaceChildren(lineRow("Kopf", "header", s.pz.header, s.pz.header <= 0), lineRow("Fuß", "footer", len - s.pz.footer, s.pz.footer >= len));
    if (!s.pz.zones.length) {
      this.areas.replaceChildren(el("div", "muted", "Keine. Ziehen Sie auf dem Plan einen Bereich auf."));
      return;
    }
    this.areas.replaceChildren(
      ...s.pz.zones.map((z) => {
        const label = zoneLabel(s.pz.zones, z);
        const row = el("div", z.id === s.selected ? "zone-row selected" : "zone-row");
        row.dataset.zone = String(z.id);
        row.dataset.kind = z.kind;
        row.dataset.selectable = "";
        const menu = createKindMenu({
          label,
          kind: z.kind,
          onPick: (kind) => {
            this.after = { id: z.id, open: false };
            this.h.setZoneKind(z.id, kind);
          },
        });
        // Opening the dropdown of another zone selects it first; the list is rebuilt, so it opens afterwards.
        menu.button.addEventListener(
          "click",
          (e) => {
            if (this.selected === z.id) return;
            e.stopImmediatePropagation();
            this.after = { id: z.id, open: true };
            this.h.select(z.id);
          },
          true,
        );
        menu.button.dataset.zoneKind = z.kind;
        row.append(menu.el, el("span", "size", sizeText(effectiveBox(z, s.axis, s.page), s.axis) + (z.full ? " (ganze Länge)" : "")));
        const x = el("button", "x", "×");
        x.type = "button";
        x.title = "Bereich löschen";
        x.setAttribute("aria-label", `${label} löschen`);
        x.addEventListener("click", (e) => {
          e.stopPropagation();
          this.h.removeZone(z.id);
        });
        row.append(x);
        row.addEventListener("click", () => this.h.select(z.id));
        return row;
      }),
    );
    const after = this.after;
    this.after = undefined;
    if (after) {
      const b = this.areas.querySelector<HTMLButtonElement>(`[data-zone="${after.id}"] .kind-btn`);
      if (after.open) b?.click();
      else b?.focus();
    }
  }
}
