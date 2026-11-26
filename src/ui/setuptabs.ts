// "Alter Plan" and "Neuer Plan" (ADR 0002): one zoomable view per tab with Kopf, Fuß and the
// Bereiche, and the list beside it. The Old Plan starts from the remembered setup or the
// detected Header and Footer; the New Plan gets the Old Plan's zones copied (until it is edited
// by hand). Wires the view, the editor, the minimap, the keys and the sidebar to the engines.

import { axisOf, type Box } from "../compare/objects";
import type { BodyHints } from "../engine/core";
import type { Engine } from "../engine/client";
import { bandBoxes, copyToNewPlan, effectiveBox, lengthOf, zoneLabel, type PageMm, type PlanZones, type ZoneKind } from "../zones/model";
import { applyRemembered, loadRemembered, storeRemembered, toRemembered } from "../zones/remember";
import { SegmentIndex } from "../zones/snap";
import { SetupStore } from "../zones/setupstore";
import type { BusyWindow } from "./busy";
import type { Direction } from "./direction";
import { Minimap } from "./minimap";
import type { Role, Sides } from "./openplans";
import { PlanView, type Subject } from "./planview";
import { ZoneEditor, type GhostZone } from "./zoneeditor";
import { ZonePanel } from "./zonepanel";

export interface SetupPlan {
  /** Unique per opened Plan: a new file or page is a new Plan even under the same name. */
  id: number;
  widthMm: number;
  heightMm: number;
  picture: HTMLCanvasElement;
}

export interface SetupDeps {
  engines: () => Sides<Engine>;
  plans: () => Sides<SetupPlan | undefined>;
  direction: () => Direction;
  busy: BusyWindow;
  /** "Weiter" on a setup tab: confirm it and open the next. */
  next(role: Role): void;
}

interface RoleSetup {
  page: PageMm;
  hints: BodyHints;
  editor: ZoneEditor;
  panel: ZonePanel;
  subject: Subject;
  index: SegmentIndex | undefined;
  indexLoading: boolean;
  /** New Plan only: its zones were changed by hand, so they are no longer copied from the Old Plan. */
  edited: boolean;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function setUpSetupTabs(deps: SetupDeps) {
  // One set of setups per Time direction (ADR 0002); `setups` is the one of the direction that is on.
  const store = new SetupStore<RoleSetup>();
  const setups: Sides<RoleSetup | undefined> = {
    get old() {
      return store.get(axis(), "old");
    },
    set old(v) {
      store.put(axis(), "old", v!);
    },
    get new() {
      return store.get(axis(), "new");
    },
    set new(v) {
      store.put(axis(), "new", v!);
    },
  };
  const view = new PlanView($<HTMLCanvasElement>("zone-canvas"));
  const minimap = new Minimap(
    {
      root: $("minimap"),
      canvas: $<HTMLCanvasElement>("overview-canvas"),
      zones: $("zone-boxes"),
      viewBox: $("view-box"),
      collapse: $<HTMLButtonElement>("minimap-collapse"),
      expand: $<HTMLButtonElement>("minimap-expand"),
    },
    $("zone-view"),
    (p) => view.centerOn(p),
  );
  view.onView = (v) => minimap.setView(v);
  const snapStatus = $("snap-status");
  let current: Role | undefined;
  let drawKind: ZoneKind = "area";

  const axis = () => axisOf(deps.direction());

  /** The Old Plan's zones as hatched ghosts on the New Plan: those that lie elsewhere there. */
  function ghosts(): GhostZone[] {
    const o = setups.old,
      n = setups.new;
    if (!o || !n) return [];
    const ax = axis();
    const out: GhostZone[] = o.editor.pz.zones.map((z) => ({ box: effectiveBox(z, ax, o.page), label: `alter Plan · ${zoneLabel(o.editor.pz.zones, z)}` }));
    // The Header and Footer bands only where they differ from the New Plan's, else they only add noise.
    const [oh, of] = bandBoxes(o.editor.pz, ax, o.page);
    const differs = (a: number, b: number) => Math.abs(a - b) > 0.5;
    if (oh && differs(o.editor.pz.header, n.editor.pz.header)) out.push({ box: oh, label: "alter Plan · Kopf" });
    if (of && differs(lengthOf(o.page, ax) - o.editor.pz.footer, lengthOf(n.page, ax) - n.editor.pz.footer)) out.push({ box: of, label: "alter Plan · Fuß" });
    return out;
  }

  function refresh(role: Role): void {
    const s = setups[role];
    if (!s) return;
    if (current === role) {
      view.requestDraw();
      minimap.setZones(s.editor.boxes());
    }
    s.panel.update({ pz: s.editor.pz, selected: s.editor.selected, axis: axis(), page: s.page });
  }

  function committed(role: Role): void {
    const s = setups[role]!;
    if (role === "old") storeRemembered(toRemembered(s.editor.pz, axis(), lengthOf(s.page, axis())));
    else s.edited = true;
    refresh(role);
  }

  /** Builds a Plan's setup (editor, sidebar, view subject) around its detected Header and Footer. */
  function build(role: Role, hints: BodyHints): RoleSetup {
    const plan = deps.plans()[role]!;
    const page: PageMm = { width: plan.widthMm, height: plan.heightMm };
    const ref: { s?: RoleSetup } = {};
    const editor = new ZoneEditor({
      axis,
      page,
      snapIndex: () => {
        const s = ref.s!;
        if (!s.index && !s.indexLoading) {
          // The Snap index is built on first use, in the Plan's worker.
          s.indexLoading = true;
          snapStatus.textContent = "Einrasten wird vorbereitet…";
          snapStatus.classList.add("loading");
          deps.engines()[role].snapSegments().then(
            (seg) => {
              s.index = SegmentIndex.from(seg);
              snapStatus.textContent = "";
              snapStatus.classList.remove("loading");
              view.requestDraw();
            },
            () => {
              snapStatus.textContent = "";
              snapStatus.classList.remove("loading");
            },
          );
        }
        return s.index;
      },
      across: () => hints.across,
      drawKind: () => drawKind,
      ghosts: () => (role === "new" ? ghosts() : []),
      changed: (isCommitted) => (isCommitted ? committed(role) : refresh(role)),
    });
    const panel = new ZonePanel(role, {
      select: (id) => editor.select(id),
      removeZone: (id) => editor.removeZone(id),
      removeLine: (which) => editor.removeLine(which),
      setZoneKind: (id, k) => editor.setZoneKind(id, k),
      setDrawKind: (k) => (drawKind = k),
      reset: () => reset(role),
      next: () => deps.next(role),
    }, drawKind);
    const subject: Subject = {
      widthMm: plan.widthMm,
      heightMm: plan.heightMm,
      overview: plan.picture,
      editor,
      render: async (rect: Box, pxPerMm) => {
        const p = await deps.engines()[role].renderRegion({ rect, pxPerMm });
        return createImageBitmap(new ImageData(p.pixels as Uint8ClampedArray<ArrayBuffer>, p.widthPx, p.heightPx));
      },
    };
    const s: RoleSetup = { page, hints, editor, panel, subject, index: undefined, indexLoading: false, edited: false };
    ref.s = s;
    return s;
  }

  /** The Old Plan's first setup: the remembered one if it fits, else the detected Header and Footer. */
  function initialZones(s: RoleSetup): PlanZones {
    const r = loadRemembered(axis());
    const remembered = r && applyRemembered(r, axis(), s.page, () => s.editor.newId());
    if (remembered) return remembered;
    return { header: s.hints.body[0], footer: s.hints.body[1], zones: [] };
  }

  function reset(role: Role): void {
    const s = setups[role]!;
    if (role === "old") {
      s.editor.set({ header: s.hints.body[0], footer: s.hints.body[1], zones: [] });
      s.editor.selected = undefined;
      committed("old");
    } else {
      copyFromOld();
      s.edited = false;
      refresh("new");
    }
  }

  function copyFromOld(): void {
    const o = setups.old!,
      n = setups.new!;
    const copy = copyToNewPlan(o.editor.pz, lengthOf(o.page, axis()), n.page, axis());
    n.editor.selected = undefined;
    n.editor.set({ ...copy, zones: copy.zones.map((z) => ({ ...z, id: n.editor.newId() })) });
  }

  return {
    drawKind: () => drawKind,

    /**
     * Makes both Plans ready (reads their drawing for Header and Footer, with the busy window).
     * A Plan that did not change keeps its setup; a changed Old Plan starts again.
     */
    async prepare(): Promise<void> {
      // A Plan that is another file or page than before loses its setups in both directions.
      const changed = (["old", "new"] as Role[]).filter((r) => {
        const gone = (["x", "y"] as const).map((a) => store.get(a, r));
        const isNew = store.syncPlan(r, deps.plans()[r]!.id);
        if (isNew) for (const g of gone) if (g) view.forget(g.subject);
        return isNew;
      });
      // Only a direction without a setup yet needs its Header and Footer read.
      const stale = (["old", "new"] as Role[]).filter((r) => !setups[r]);
      if (stale.length) {
        await deps.busy.start("Kopf und Fuß werden gesucht…");
        try {
          const hints = await Promise.all(
            stale.map((r) =>
              deps
                .engines()
                [r].bodyHints(axis())
                .catch((e: unknown): BodyHints => {
                  console.warn("Kopf und Fuß konnten nicht gesucht werden", e);
                  return { body: [0, lengthOf({ width: deps.plans()[r]!.widthMm, height: deps.plans()[r]!.heightMm }, axis())], across: [] };
                }),
            ),
          );
          stale.forEach((r, i) => {
            const old = setups[r];
            if (old) view.forget(old.subject);
            const s = build(r, hints[i]!);
            if (r === "old") s.editor.set(initialZones(s));
            setups[r] = s;
          });
          if (changed.includes("old") && setups.new) setups.new.edited = false;
        } finally {
          await deps.busy.end();
        }
      }
      if (!setups.new!.edited) copyFromOld();
      refresh("old");
      refresh("new");
    },

    /** A setup tab is shown: the view shows this Plan, with its own zoom. Call after the tab is visible. */
    enter(role: Role): void {
      const s = setups[role];
      if (!s) return;
      current = role;
      s.panel.setDrawKind(drawKind);
      s.panel.mount($(`body-${role}`));
      if (role === "new" && !s.edited) copyFromOld();
      const plan = deps.plans()[role]!;
      minimap.setPlan(plan.widthMm, plan.heightMm, plan.picture);
      minimap.setZones(s.editor.boxes());
      view.show(s.subject);
      refresh(role);
    },

    leave(): void {
      current = undefined;
    },

    /** Keys 1, 2, 3, F, Entf in a setup tab. Returns true if it handled the key. */
    key(e: KeyboardEvent): boolean {
      const s = current && setups[current];
      if (!s || e.ctrlKey || e.metaKey || e.altKey) return false;
      switch (e.key) {
        case "1":
          view.fitPlan();
          break;
        case "2":
          view.fitWidth();
          break;
        case "3":
          view.zoomTo100();
          break;
        case "f":
        case "F": {
          const b = s.editor.focusBox();
          if (b) view.fitRect(b);
          else view.fitPlan();
          break;
        }
        case "Delete":
          s.editor.deleteSelected();
          break;
        default:
          return false;
      }
      e.preventDefault();
      return true;
    },


    /** For the e2e tests: where a point of the Plan lies on the page, and what the setup is. */
    inspect(role: Role) {
      const s = setups[role]!;
      const ax = axis();
      return {
        header: s.editor.pz.header,
        footer: s.editor.pz.footer,
        length: lengthOf(s.page, ax),
        selected: s.editor.selected,
        zones: s.editor.pz.zones.map((z) => ({ id: z.id, kind: z.kind, full: z.full, box: effectiveBox(z, ax, s.page) })),
        indexReady: !!s.index,
      };
    },
    toClient(x: number, y: number) {
      const r = $<HTMLCanvasElement>("zone-canvas").getBoundingClientRect();
      const p = view.port.toScreen(x, y);
      return { x: r.left + p.x, y: r.top + p.y };
    },
    /** The bubbles (× and ⇕) on screen, in client px. */
    bubbles(role: Role) {
      const r = $<HTMLCanvasElement>("zone-canvas").getBoundingClientRect();
      return setups[role]!.editor.hotAreas().map((h) => ({ ...h, x: h.x + r.left + h.w / 2, y: h.y + r.top + h.h / 2 }));
    },
    centerOn: (x: number, y: number) => view.centerOn({ x, y }),
    visible: () => view.visible(),
    zoom: () => view.port.zoom,
  };
}
