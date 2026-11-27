// "Versatz" (ADR 0002): the user confirms or corrects the Offset by eye. Both Plans lie on top
// of each other in the Plan view; the Offset search runs only while this tab is shown; the
// Offset is set by dragging the Plan (it snaps to the candidates), the buttons, the arrow
// keys or typing. "Vergleichen" runs the comparison with the user's setup and hands the
// result to the "Vergleich" tab (src/ui/handoff.ts).

import { comparisonInput, type PlanSetupZones } from "../compare/input";
import { axisOf, type Axis, type DrawnObject } from "../compare/objects";
import type { OffsetCandidate } from "../compare/offset";
import type { ComparisonResult } from "../compare/result";
import type { Engine } from "../engine/client";
import type { BusyWindow } from "./busy";
import type { Direction } from "./direction";
import type { ComparisonHandoff } from "./handoff";
import { formatOffset, isCandidateOn, nudgeFromKey, parseOffset, roundOffset, SOURCE_TEXT, type OffsetSource } from "./offsetmodel";
import { OffsetEditor, overlaySubject, type OffsetHost } from "./offsetoverlay";
import { OffsetSearch, type SearchState } from "./offsetsearch";
import type { Role, Sides } from "./openplans";
import type { PlanView, Subject } from "./planview";
import type { SetupPlan } from "./setuptabs";

export interface OffsetDeps {
  engines: () => Sides<Engine>;
  plans: () => Sides<SetupPlan | undefined>;
  direction: () => Direction;
  /** The Plan view, shared with the setup tabs. */
  view: PlanView;
  /** A Plan's setup in the current Time direction (its page and zones). */
  setupOf: (role: Role) => PlanSetupZones | undefined;
  busy: BusyWindow;
  handoff: ComparisonHandoff;
  /** "Vergleichen" finished and its result is handed over: open the "Vergleich" tab. */
  confirmed(): void;
}

/** What is kept of the Offset for one Time direction while the same two Plans are open. */
interface Kept {
  planIds: [number, number];
  offset: number;
  source: OffsetSource;
  /** The user set it: a search result does not replace it. */
  touched: boolean;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};
const count = (n: number) => n.toLocaleString("de-DE");
const NUDGES = [-10, -1, -0.1, 0.1, 1, 10];
const nudgeLabel = (d: number) => `${d < 0 ? "−" : "+"}${Math.abs(d).toLocaleString("de-DE")}`;

export function setUpOffsetTab(deps: OffsetDeps) {
  const root = document.getElementById("body-offset")!;
  const axis = (): Axis => axisOf(deps.direction());
  const kept: Partial<Record<Axis, Kept>> = {};
  let offset = 0;
  let source: OffsetSource = "auto";
  let touched = false;
  let candidates: readonly OffsetCandidate[] = [];
  let active = false;
  let subject: Subject | undefined;
  let subjectIds: [number, number] | undefined;
  /** The New Plan's drawn objects, read once per Plan. */
  let newObjects: { id: number; objects: readonly DrawnObject[]; pageMm: readonly [number, number] } | undefined;

  const ids = (): [number, number] => [deps.plans().old!.id, deps.plans().new!.id];

  // ---- The search ----------------------------------------------------------------
  async function newPlanObjects() {
    const id = deps.plans().new!.id;
    if (newObjects?.id !== id) {
      const p = await deps.engines().new.planObjects();
      newObjects = { id, objects: p.objects, pageMm: p.pageMm };
    }
    return newObjects;
  }

  /** The setup the search depends on: another one means another search. */
  function searchKey(): string {
    const o = deps.setupOf("old")!,
      n = deps.setupOf("new")!;
    const { setup } = comparisonInput(axis(), 0, o, n);
    return JSON.stringify({ ids: ids(), axis: setup.axis, old: setup.old, new: setup.new });
  }

  const search = new OffsetSearch(
    async (_key, signal) => {
      const { setup } = comparisonInput(axis(), 0, deps.setupOf("old")!, deps.setupOf("new")!);
      const nu = await newPlanObjects();
      // Tests set `__offsetSearchDelayMs` to watch a search that takes long.
      const slow = (window as unknown as { __offsetSearchDelayMs?: number }).__offsetSearchDelayMs;
      if (slow) await new Promise((r) => setTimeout(r, slow));
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      return deps.engines().old.findOffset(
        {
          newPlan: { objects: nu.objects, pageMm: nu.pageMm },
          axis: setup.axis,
          bodyOld: [...setup.old.body],
          bodyNew: [...setup.new.body],
          ignoredOld: [...setup.old.ignored],
          ignoredNew: [...setup.new.ignored],
        },
        signal,
      );
    },
    (state) => {
      if (state === "done" || state === "none") applyResult();
      renderPanel();
    },
  );

  /** A finished search sets the Offset, unless the user already set one. */
  function applyResult(): void {
    const r = search.result;
    candidates = r?.candidates ?? [];
    if (!r || !r.candidates.length || touched) return;
    setOffset(r.offset, "auto", false);
  }

  // ---- The Offset ------------------------------------------------------------------
  function remember(): void {
    if (deps.plans().old && deps.plans().new) kept[axis()] = { planIds: ids(), offset, source, touched };
  }

  function setOffset(v: number, from: OffsetSource, byUser = true): void {
    offset = v;
    source = from;
    if (byUser) touched = true;
    remember();
    deps.view.changed();
    renderPanel();
  }

  /** The part of the Old frame that is compared, along the Time direction. */
  function window_(): [number, number] {
    const o = deps.setupOf("old")!.zones,
      n = deps.setupOf("new")!.zones;
    return [Math.max(o.header, n.header + offset), Math.min(o.footer, n.footer + offset)];
  }

  const host: OffsetHost = { axis, offset: () => offset, candidates: () => candidates, set: (v, s) => setOffset(v, s), window: window_ };
  const editor = new OffsetEditor(host);

  // ---- The panel ---------------------------------------------------------------------
  const big = el("div", "offset-big");
  big.id = "offset-value";
  const from = el("div", "offset-from muted");
  from.id = "offset-from";
  const status = el("div", "offset-status muted");
  status.id = "offset-status";
  const candList = el("div", "offset-cands");
  candList.id = "offset-cands";
  const input = el("input");
  input.id = "offset-input";
  input.type = "text";
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Versatz in mm");
  const errorLine = el("p", "offset-error");
  errorLine.id = "offset-error";
  const compareBtn = el("button", "btn primary", "Vergleichen");
  compareBtn.id = "offset-compare";
  compareBtn.type = "button";

  const commitTyped = () => {
    const v = parseOffset(input.value, limit());
    if (v === undefined) input.value = formatOffset(offset);
    else if (v !== offset) setOffset(v, "hand");
    else input.value = formatOffset(v);
  };
  input.addEventListener("change", commitTyped);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitTyped();
    }
    if (e.key === "Escape") input.value = formatOffset(offset);
  });

  /** A typed Offset stays within the Plans' lengths. */
  const limit = (): number => {
    const a = axis(),
      p = deps.plans();
    const len = (r: Role) => (a === "y" ? p[r]!.heightMm : p[r]!.widthMm);
    return len("old") + len("new");
  };

  const nudges = el("div", "offset-nudges");
  for (const d of NUDGES) {
    const b = el("button", "btn", nudgeLabel(d));
    b.type = "button";
    b.dataset.nudge = String(d);
    b.title = `Neuen Plan um ${Math.abs(d).toLocaleString("de-DE")} mm ${d < 0 ? "zurück" : "vor"} schieben`;
    b.addEventListener("click", () => setOffset(roundOffset(offset + d), "hand"));
    nudges.append(b);
  }

  const jumps = el("div", "offset-jumps");
  for (const [label, act] of [
    ["Anfang", () => jump(window_()[0], 0.15)],
    ["Ende", () => jump(window_()[1], 0.85)],
    ["Ganzer Plan", () => deps.view.fitPlan()],
  ] as const) {
    const b = el("button", "btn", label);
    b.type = "button";
    b.addEventListener("click", act);
    jumps.append(b);
  }

  /** Puts the position `t` (Old frame, along the Time direction) at this fraction of the view. */
  function jump(t: number, fraction: number): void {
    const v = deps.view.visible();
    if (axis() === "y") deps.view.centerOn({ x: (v.x0 + v.x1) / 2, y: t + (0.5 - fraction) * (v.y1 - v.y0) });
    else deps.view.centerOn({ x: t + (0.5 - fraction) * (v.x1 - v.x0), y: (v.y0 + v.y1) / 2 });
  }

  const legend = el("ul", "marks-legend");
  for (const [colour, text] of [
    ["#111", "Schwarz: liegt in beiden Plänen gleich"],
    ["#1478e6", "Blau: nur im alten Plan"],
    ["#e1003c", "Rot: nur im neuen Plan"],
  ] as const) {
    const li = el("li"),
      sw = el("span", "sw");
    sw.style.background = colour;
    li.append(sw, text);
    legend.append(li);
  }

  const keyHint = (a: Axis) => (a === "y" ? ["↑", "↓"] : ["←", "→"]);
  const hint = el("p", "zone-hint");

  const actions = el("div", "zone-actions");
  actions.append(el("span"), compareBtn);

  root.replaceChildren(
    el("h2", "", "Versatz"),
    el("p", "", "So weit ist der neue Plan verschoben. Liegt der Versatz richtig, liegt alles Gleiche übereinander; sonst erscheint es doppelt."),
    big,
    from,
    status,
    el("h3", "", "Vorschläge"),
    candList,
    el("h3", "", "Von Hand"),
    el("p", "zone-hint", "Den Plan mit der Maus ziehen: er rastet an den Vorschlägen ein (Alt: frei). Oder eintippen:"),
    (() => {
      const row = el("label", "offset-typed");
      row.append(input, " mm");
      return row;
    })(),
    nudges,
    hint,
    el("h3", "", "Ansicht"),
    jumps,
    legend,
    errorLine,
    actions,
  );

  function renderPanel(): void {
    const state: SearchState = search.state;
    big.textContent = `${formatOffset(offset)} mm`;
    big.dataset.offset = String(offset);
    from.textContent = state === "searching" && !touched ? "wird gesucht…" : SOURCE_TEXT[source];
    status.dataset.state = state;
    status.classList.toggle("loading", state === "searching");
    status.textContent = { idle: "", searching: "Suche läuft. Sie können schon von Hand einstellen.", done: "", none: "Keine Vorschläge gefunden. Stellen Sie den Versatz von Hand ein.", failed: "Die Suche ist fehlgeschlagen. Stellen Sie den Versatz von Hand ein." }[state];
    if (document.activeElement !== input) input.value = formatOffset(offset);
    const max = Math.max(1, ...candidates.map((c) => c.votes));
    candList.replaceChildren(
      ...candidates.map((c, i) => {
        const b = el("button", isCandidateOn(c, offset) ? "cand on" : "cand");
        b.type = "button";
        b.dataset.cand = String(i);
        b.dataset.offset = String(c.offset);
        const bar = el("div", "bar");
        bar.style.width = `${(100 * c.votes) / max}%`;
        b.append(el("b", "", `${formatOffset(c.offset)} mm`), el("span", "muted", `${count(c.votes)} Treffer`), bar);
        b.addEventListener("click", () => setOffset(c.offset, i === 0 ? "auto" : "picked"));
        return b;
      }),
    );
    const [back, forth] = keyHint(axis());
    hint.textContent = `${back} ${forth}: 0,1 mm · mit Strg 1 mm · Bild auf, Bild ab: 10 mm`;
  }

  // ---- The comparison ----------------------------------------------------------------
  compareBtn.addEventListener("click", () => void compareNow());

  async function compareNow(): Promise<void> {
    const old = deps.setupOf("old"),
      nu = deps.setupOf("new");
    if (!old || !nu || !deps.plans().old || !deps.plans().new) return;
    search.leave(); // a search still running stops; the Offset shown is the one used
    errorLine.textContent = "";
    compareBtn.disabled = true;
    await deps.busy.start("Vergleich wird berechnet…");
    let result: ComparisonResult | undefined;
    try {
      const started = performance.now();
      const input = comparisonInput(axis(), offset, old, nu);
      const newPlan = await newPlanObjects();
      const out = await deps.engines().old.compare({ newPlan: { objects: newPlan.objects, pageMm: newPlan.pageMm }, ...input });
      result = {
        timeDirection: deps.direction(),
        setup: input.setup,
        axisZones: input.axisZones,
        comparison: out.comparison,
        places: out.places,
        offsetCandidates: [...candidates],
        ms: { ...out.ms, transfer: performance.now() - started - out.ms.compare - out.ms.places },
      };
      deps.handoff.publish(result);
    } catch (e) {
      errorLine.textContent = `Der Vergleich ist fehlgeschlagen: ${String(e)}`;
    } finally {
      compareBtn.disabled = false;
      await deps.busy.end();
    }
    if (result) deps.confirmed();
  }

  // ---- Entering and leaving ------------------------------------------------------------
  function ensureSubject(): Subject {
    const plans = deps.plans(),
      now = ids();
    if (subject && subjectIds && subjectIds[0] === now[0] && subjectIds[1] === now[1]) return subject;
    if (subject) deps.view.forget(subject);
    subjectIds = now;
    const o = plans.old!,
      n = plans.new!;
    subject = overlaySubject(o, n, deps.engines(), editor, () => (axis() === "y" ? { x: 0, y: offset } : { x: offset, y: 0 }));
    return subject;
  }

  /** The first view of this Plan: its width fills the view, at the start of the compared part (the whole Plan if it runs across). */
  function firstView(first: boolean): void {
    if (!first) return;
    const o = deps.plans().old!,
      v = deps.view.port;
    const [w0] = window_();
    if (axis() === "y") deps.view.fitRect({ x0: 0, y0: w0 - 20, x1: o.widthMm, y1: w0 - 20 + (o.widthMm * v.cssH) / v.cssW }, 0.02);
    else deps.view.fitRect({ x0: w0 - 20, y0: 0, x1: w0 - 20 + (o.heightMm * v.cssW) / v.cssH, y1: o.heightMm }, 0.02);
  }

  return {
    /** The tab is shown (after it is visible): shows the overlay and starts the search. */
    enter(): void {
      if (!deps.plans().old || !deps.plans().new || !deps.setupOf("old") || !deps.setupOf("new")) return;
      active = true;
      const k = kept[axis()];
      if (!k || k.planIds[0] !== ids()[0] || k.planIds[1] !== ids()[1]) {
        // Other Plans than last time: nothing is kept, not even a found result.
        search.reset();
        candidates = [];
        offset = 0;
        source = "auto";
        touched = false;
      } else {
        ({ offset, source, touched } = k);
      }
      const fresh = !subject || !subjectIds || subjectIds[0] !== ids()[0] || subjectIds[1] !== ids()[1];
      const s = ensureSubject();
      errorLine.textContent = "";
      deps.view.show(s);
      firstView(fresh);
      deps.view.changed();
      search.enter(searchKey());
      candidates = search.result?.candidates ?? [];
      renderPanel();
    },

    /** The tab is left: a running search stops. */
    leave(): void {
      if (!active) return;
      active = false;
      search.leave();
      renderPanel();
    },

    /** Arrow keys and Page up/down nudge the Offset. Returns true if it handled the key. */
    key(e: KeyboardEvent): boolean {
      if (!active) return false;
      const d = nudgeFromKey(e, axis());
      if (d !== undefined) {
        setOffset(roundOffset(offset + d), "hand");
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === "1") deps.view.fitPlan();
      else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === "2") deps.view.fitWidth();
      else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === "3") deps.view.zoomTo100();
      else return false;
      e.preventDefault();
      return true;
    },

    /** For the e2e tests. */
    inspect() {
      return { offset, source, touched, state: search.state, candidates: candidates.map((c) => ({ ...c })), window: active ? window_() : undefined };
    },
  };
}
