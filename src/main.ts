// simplepdfcompare: start page (open the Old and the New Plan) and the workspace shell.

import { startEngines, type Engine } from "./engine/client";
import { BUSY_TIMING, BusyWindow } from "./ui/busy";
import { setUpFirstComparison } from "./ui/firstcompare";
import { setUpCompareView } from "./ui/compareview";
import { setUpPlaces } from "./ui/placesui";
import { createExportBar } from "./ui/exportui";
import { ComparisonHandoff } from "./ui/handoff";
import { setUpOffsetTab } from "./ui/offsettab";
import { setUpSetupTabs, type SetupPlan } from "./ui/setuptabs";
import { renderShortcuts } from "./ui/shortcuts";
import { dropTargets, isPdf, needsPagePicker, swapped, type Role, type Sides } from "./ui/openplans";
import { PagePicker, type PageSize } from "./ui/pagepicker";
import { DIRECTION_LABEL, preselectedDirection, type Direction } from "./ui/direction";
import { panelKindFor, setUpPanelResize } from "./ui/sidebar";
import { confirmTab, initialReach, isTabEnabled, lockAfterOpen, signatureChanged, TABS, type OpenSignature, type TabId } from "./ui/tabs";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ROLES: Role[] = ["old", "new"];
const ROLE_NAME: Record<Role, string> = { old: "Alter Plan", new: "Neuer Plan" };
/** The picture of a Plan in the boxes and the view: the whole page, fit into this box. */
const PICTURE_MAX = { width: 1200, height: 1600 };

$("version").textContent = `Version ${__APP_VERSION__} vom ${__BUILD_DATE__.split("-").reverse().join(".")}`;

// ---- About -------------------------------------------------------------------
const about = $<HTMLDialogElement>("about");
renderShortcuts($<HTMLTableElement>("shortcuts"));
$("about-open").addEventListener("click", () => {
  about.showModal();
  about.querySelector(".body")!.scrollTop = 0;
});
$("about-close").addEventListener("click", () => about.close());

// ---- Busy window (clipper ADR 0012) ---------------------------------------------
// Tests set `__busyDelayMs` to see the window even for fast jobs.
const busyDelay = (window as unknown as { __busyDelayMs?: number }).__busyDelayMs;
const busyWindow = new BusyWindow(
  {
    dialog: $<HTMLDialogElement>("busy"),
    text: $("busy-text"),
    time: $("busy-time"),
    bar: $<HTMLProgressElement>("busy-bar"),
    cancel: $<HTMLButtonElement>("busy-cancel"),
  },
  busyDelay === undefined ? BUSY_TIMING : { ...BUSY_TIMING, delayMs: busyDelay },
);

// ---- Engines: one worker per Plan (ADR 0004) --------------------------------------
await busyWindow.start("PDF-Engine wird geladen…");
let engines: Sides<Engine>;
try {
  const [a, b] = await startEngines();
  engines = { old: a, new: b };
} catch (e) {
  await busyWindow.end();
  $("start-error").textContent = `Die PDF-Engine konnte nicht geladen werden: ${String(e)}`;
  throw e;
}
void busyWindow.end();
document.body.dataset.engine = "worker";

// ---- State ---------------------------------------------------------------------
/** One opened Plan: the Document's file, its pages and the chosen one (the Plan). */
interface Opened {
  fileName: string;
  pages: PageSize[];
  /** The chosen page, 0-based. */
  page: number;
  widthMm: number;
  heightMm: number;
  picture: HTMLCanvasElement;
  /** Unique per opened Plan: a new file or page is a new Plan even under the same name. */
  id: number;
}
let opened: Sides<Opened | undefined> = { old: undefined, new: undefined };
let working = false;
let planSeq = 0;
/** The Time direction; preselected from the Old Plan's page shape, then the user's to switch. */
let direction: Direction = "down";
/** The furthest tab that can be clicked (ADR 0002: confirmed tabs unlock the next one). */
let reach = initialReach();
let currentTab: TabId = "open";
let lastSignature: OpenSignature | undefined;
let lastOldPlan: string | undefined;
/** "Vergleichen" hands its result to the "Vergleich" tab through this (src/ui/handoff.ts). */
const handoff = new ComparisonHandoff();
const PT_TO_MM = 25.4 / 72;
const de = (v: number) => v.toLocaleString("de-DE", { maximumFractionDigits: 0 });

const picker = new PagePicker(
  { dialog: $<HTMLDialogElement>("pages"), info: $("pages-info"), grid: $("pages-grid"), cancel: $<HTMLButtonElement>("pages-cancel") },
  // Set per call below: the picker belongs to the box being filled.
  (page, w, h) => pickerEngine!.renderThumbnail({ page, maxWidthPx: w, maxHeightPx: h }),
);
let pickerEngine: Engine | undefined;

// ---- Opening a file into a box --------------------------------------------------
async function makePicture(engine: Engine, page: number): Promise<HTMLCanvasElement> {
  const t = await engine.renderThumbnail({ page, maxWidthPx: PICTURE_MAX.width, maxHeightPx: PICTURE_MAX.height });
  const canvas = document.createElement("canvas");
  canvas.width = t.widthPx;
  canvas.height = t.heightPx;
  canvas.getContext("2d")!.putImageData(new ImageData(t.pixels as Uint8ClampedArray<ArrayBuffer>, t.widthPx, t.heightPx), 0, 0);
  return canvas;
}

/** Makes a page of the box's Document the Plan, with the busy window running. */
async function showPage(role: Role, doc: { fileName: string; pages: PageSize[] }, index: number): Promise<void> {
  await busyWindow.start(doc.pages.length > 1 ? `Seite ${index + 1} wird geöffnet…` : "Plan wird geöffnet…");
  try {
    const info = await engines[role].openPage(index);
    const picture = await makePicture(engines[role], index);
    opened[role] = {
      fileName: doc.fileName,
      pages: doc.pages,
      page: index,
      widthMm: info.widthPt * PT_TO_MM,
      heightMm: info.heightPt * PT_TO_MM,
      picture,
      id: ++planSeq,
    };
    $("start-error").textContent = "";
  } catch (e) {
    $("start-error").textContent = `${doc.pages.length > 1 ? `Seite ${index + 1}` : "Der Plan"} konnte nicht geöffnet werden: ${String(e)}`;
  } finally {
    await busyWindow.end();
  }
  render();
}

/** Opens a file into a box: straight away if it has one page, else after the page picker. */
async function openFile(role: Role, file: File): Promise<void> {
  if (working) return;
  working = true;
  render();
  try {
    await busyWindow.start("Plan wird geöffnet…");
    $("start-error").textContent = "";
    let pages: PageSize[];
    try {
      pages = (await engines[role].openDocument(await file.arrayBuffer())).pages;
      if (pages.length === 0) throw new Error("keine Seiten");
    } catch (e) {
      await busyWindow.end();
      $("start-error").textContent = `„${file.name}“ konnte nicht geöffnet werden: ${String(e)}`;
      return;
    }
    const doc = { fileName: file.name, pages };
    if (!needsPagePicker(pages.length)) {
      await busyWindow.end();
      return await showPage(role, doc, 0);
    }
    await busyWindow.end();
    pickerEngine = engines[role];
    const index = await picker.pick(pages, file.name);
    if (index === undefined) {
      await engines[role].discardDocument();
      return;
    }
    await showPage(role, doc, index);
  } finally {
    working = false;
    render();
  }
}

async function changePage(role: Role, index: number): Promise<void> {
  const o = opened[role];
  if (!o || working || index < 0 || index >= o.pages.length) return;
  working = true;
  render();
  try {
    await showPage(role, o, index);
  } finally {
    working = false;
    render();
  }
}

async function pickPage(role: Role): Promise<void> {
  const o = opened[role];
  if (!o || working || picker.isOpen) return;
  pickerEngine = engines[role];
  const index = await picker.pick(o.pages, o.fileName, o.page);
  if (index !== undefined && index !== o.page) await changePage(role, index);
}

/** Opens several files in order, each into its box. */
async function openFiles(files: File[], targets: Role[]): Promise<void> {
  for (let i = 0; i < targets.length; i++) await openFile(targets[i]!, files[i]!);
}

function swap(): void {
  if (working) return;
  engines = swapped(engines);
  opened = swapped(opened);
  render();
}

// ---- Rendering the boxes, the cards and the view -----------------------------------
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

function copyPicture(src: HTMLCanvasElement, className: string): HTMLCanvasElement {
  const c = el("canvas", className);
  c.width = src.width;
  c.height = src.height;
  c.getContext("2d")!.drawImage(src, 0, 0);
  return c;
}

function button(label: string, onClick: () => void, opts: { title?: string; className?: string; disabled?: boolean } = {}): HTMLButtonElement {
  const b = el("button", `btn ${opts.className ?? ""}`.trim(), label);
  b.type = "button";
  if (opts.title) {
    b.title = opts.title;
    b.setAttribute("aria-label", opts.title);
  }
  b.disabled = !!opts.disabled;
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function pager(role: Role, o: Opened): HTMLElement {
  const p = el("div", "pager");
  p.dataset.pager = role;
  const pick = button("", () => void pickPage(role), { title: "Seite wählen", className: "pg-pick", disabled: working });
  pick.append("Seite ", Object.assign(el("b"), { textContent: String(o.page + 1) }), ` von ${o.pages.length}`);
  p.append(
    button("◀", () => void changePage(role, o.page - 1), { title: "Vorherige Seite", className: "pg-nav", disabled: working || o.page === 0 }),
    pick,
    button("▶", () => void changePage(role, o.page + 1), { title: "Nächste Seite", className: "pg-nav", disabled: working || o.page === o.pages.length - 1 }),
  );
  return p;
}

const planSize = (o: Opened) => `${de(o.widthMm)} × ${de(o.heightMm)} mm`;

function renderBox(role: Role): void {
  const box = $(`box-${role}`);
  const o = opened[role];
  box.classList.toggle("filled", !!o);
  box.replaceChildren();
  box.append(el("div", "role", ROLE_NAME[role]));
  if (!o) {
    const empty = el("div", "empty");
    empty.innerHTML =
      '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M12 18v-6" /><path d="m9 15 3-3 3 3" /></svg>';
    empty.append(el("h2", "", "PDF hierher ziehen"), el("p", "", "oder anklicken"));
    box.append(empty);
    return;
  }
  box.append(copyPicture(o.picture, "thumb-img"), el("div", "file-name", o.fileName), el("div", "muted", planSize(o)));
  if (o.pages.length > 1) box.append(pager(role, o));
  box.append(button("Andere Datei…", () => chooseFile(role), { className: "other ghost", disabled: working }));
}

function renderCard(role: Role): void {
  const card = $(`card-${role}`);
  const o = opened[role];
  card.dataset.role = role;
  card.replaceChildren(el("div", "role", ROLE_NAME[role]));
  if (!o) return;
  card.append(el("div", "file-name", o.fileName), el("div", "muted", planSize(o)));
  if (o.pages.length > 1) card.append(pager(role, o));
  card.append(button("Andere Datei…", () => chooseFile(role), { disabled: working }));
}

/** Which Plan the view shows: only a view choice, it locks nothing and changes no direction. */
let shown: Role = "old";

function renderView(): void {
  const sw = $("shown-switch");
  sw.dataset.pos = shown === "old" ? "0" : "1";
  for (const b of sw.querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-checked", String(b.dataset.value === shown));
  const o = opened[shown];
  if (!o) return;
  const canvas = $<HTMLCanvasElement>("plan");
  canvas.width = o.picture.width;
  canvas.height = o.picture.height;
  canvas.getContext("2d")!.drawImage(o.picture, 0, 0);
  $("sheet").style.setProperty("--ratio", String(o.widthMm / o.heightMm));
}

/**
 * Keeps the rules that follow from what "Öffnen" decided: a new Old Plan (file, page or
 * order) preselects the Time direction again, and any change to a file, a page, the order
 * or the direction locks the tabs after "Öffnen". Visiting without a change locks nothing.
 */
function syncOpenDecision(): void {
  const o = opened.old;
  const oldPlan = o ? `${o.fileName}#${o.page}` : undefined;
  if (o && oldPlan !== lastOldPlan) direction = preselectedDirection(o.widthMm, o.heightMm);
  lastOldPlan = oldPlan;
  const sig: OpenSignature = {
    old: opened.old && { file: opened.old.fileName, page: opened.old.page },
    new: opened.new && { file: opened.new.fileName, page: opened.new.page },
    direction,
  };
  if (lastSignature && signatureChanged(lastSignature, sig)) {
    reach = lockAfterOpen(reach);
    handoff.clear();
  }
  lastSignature = sig;
}

function renderDirection(): void {
  const sw = $("direction-switch");
  sw.dataset.pos = direction === "down" ? "0" : "1";
  for (const b of sw.querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-checked", String(b.dataset.value === direction));
  // The arrows slide to the new direction; with reduced motion they fade instead.
  const plans = $("plans");
  if (plans.dataset.dir === direction) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    plans.classList.add("fading");
    setTimeout(() => {
      plans.dataset.dir = direction;
      plans.classList.remove("fading");
    }, 160);
  } else {
    plans.dataset.dir = direction;
  }
}

function renderTabs(): void {
  for (const id of TABS) {
    const tab = $<HTMLButtonElement>(`tab-${id}`);
    tab.disabled = !isTabEnabled(id, reach);
    tab.setAttribute("aria-selected", String(id === currentTab));
    const body = document.getElementById(`body-${id}`);
    if (body) body.hidden = id !== currentTab;
  }
  $("workspace").dataset.tab = currentTab;
}

function render(): void {
  syncOpenDecision();
  renderDirection();
  renderTabs();
  for (const role of ROLES) {
    renderBox(role);
    renderCard(role);
  }
  renderView();
  $<HTMLButtonElement>("proceed").disabled = !(opened.old && opened.new) || working;
  $<HTMLButtonElement>("open-next").disabled = !(opened.old && opened.new) || working;
  for (const id of ["swap-start", "swap-open"]) $<HTMLButtonElement>(id).disabled = working;
}

// ---- File choosers, drag and drop --------------------------------------------------
function chooseFile(role: Role): void {
  if (working) return;
  $<HTMLInputElement>(`file-${role}`).click();
}
for (const role of ROLES) {
  const input = $<HTMLInputElement>(`file-${role}`);
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = ""; // allow re-opening the same file
    if (file) void openFile(role, file);
  });
  const box = $(`box-${role}`);
  box.addEventListener("click", () => {
    if (!opened[role]) chooseFile(role);
  });
  box.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target === box && !opened[role]) {
      e.preventDefault();
      chooseFile(role);
    }
  });
}

// A PDF over a file card in "Öffnen" highlights it: dropped there, it replaces that file.
document.addEventListener("dragover", (e) => {
  const over = (e.target as Element | null)?.closest<HTMLElement>(".file-card");
  for (const c of document.querySelectorAll(".file-card.over")) if (c !== over) c.classList.remove("over");
  over?.classList.add("over");
});
document.addEventListener("drop", () => document.querySelectorAll(".file-card.over").forEach((c) => c.classList.remove("over")));
window.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget) document.querySelectorAll(".file-card.over").forEach((c) => c.classList.remove("over"));
});

let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if (!e.dataTransfer?.types.includes("Files")) return;
  dragDepth++;
  document.body.classList.add("dragging");
});
window.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) document.body.classList.remove("dragging");
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");
  if (busyWindow.active || working || picker.isOpen) return;
  const files = [...(e.dataTransfer?.files ?? [])].filter(isPdf);
  if (files.length === 0) {
    if (!$("start").hidden) $("start-error").textContent = "Bitte eine PDF-Datei ablegen.";
    return;
  }
  const onBox = (e.target as Element | null)?.closest<HTMLElement>("[data-role]")?.dataset.role as Role | undefined;
  const targets = dropTargets({ old: !!opened.old, new: !!opened.new }, files.length, onBox);
  void openFiles(files, targets);
});

// ---- Swap, Weiter, tabs -------------------------------------------------------------
for (const id of ["swap-start", "swap-open"]) $(id).addEventListener("click", swap);

$("proceed").addEventListener("click", () => {
  if (!opened.old || !opened.new) return;
  // The start page is passed once and not shown again.
  $("start").hidden = true;
  $("workspace").hidden = false;
  render();
});

const panelResize = setUpPanelResize($("workspace"), $("panel-resize"));


// "Alter Plan" and "Neuer Plan": the zoomable views with Kopf, Fuß and the Bereiche.
const setupTabs = setUpSetupTabs({
  engines: () => engines,
  plans: () => opened,
  direction: () => direction,
  busy: busyWindow,
  next: (role) => {
    reach = confirmTab(reach, role);
    selectTab(role === "old" ? "new" : "offset");
  },
});
(window as unknown as { __spc: typeof setupTabs }).__spc = setupTabs;

// "Versatz": both Plans on top of each other; the search runs only while the tab is shown.
const offsetTab = setUpOffsetTab({
  engines: () => engines,
  plans: () => opened as Sides<SetupPlan | undefined>,
  direction: () => direction,
  view: setupTabs.view,
  setupOf: (role) => setupTabs.zonesOf(role),
  busy: busyWindow,
  handoff,
  confirmed: () => {
    reach = confirmTab(reach, "offset");
    selectTab("compare");
  },
});
(window as unknown as { __offset: typeof offsetTab }).__offset = offsetTab;

// "Vergleich": the smooth comparison view, fed by the hand-off; the sidebar keeps the temporary readout.
(window as unknown as { __handoff: ComparisonHandoff }).__handoff = handoff;
const compareView = setUpCompareView({ engines: () => engines, plans: () => opened });
const places = setUpPlaces({
  view: compareView,
  pair: () => handoff.pair,
  active: () => currentTab === "compare",
  el: {
    body: $("body-compare"),
    nav: $("cmp-nav"),
    prev: $<HTMLButtonElement>("cmp-prev"),
    next: $<HTMLButtonElement>("cmp-next"),
    navText: $<HTMLButtonElement>("cmp-nav-text"),
    minimaps: [$("cmp-minimap"), $("cmp-minimap-expand")],
  },
});
(window as unknown as { __places: typeof places }).__places = places;
// "Exportieren" at the top of "Vergleich" (ADR 0007).
const infoPlan = (o: Opened | undefined) => o && { fileName: o.fileName, page: o.page, pages: o.pages.length };
$("body-compare").prepend(
  createExportBar({ state: places.state, result: () => handoff.latest(), plans: () => ({ old: infoPlan(opened.old), new: infoPlan(opened.new) }), busy: busyWindow }),
);
const comparisonView = setUpFirstComparison({ busy: busyWindow, handoff, view: compareView, places });
comparisonView.listen();

function selectTab(id: TabId): void {
  if (!isTabEnabled(id, reach)) return;
  const left = currentTab;
  currentTab = id;
  panelResize.setKind(panelKindFor(id));
  renderTabs();
  if (left === "offset" && id !== "offset") offsetTab.leave();
  if (left === "compare" && id !== "compare") comparisonView.leave();
  // The view is visible now, so it can measure itself.
  if (id === "old" || id === "new") setupTabs.enter(id);
  else setupTabs.leave();
  if (id === "offset") offsetTab.enter();
  if (id === "compare") comparisonView.enter();
}
for (const id of TABS) $(`tab-${id}`).addEventListener("click", () => selectTab(id));

// "Weiter" confirms "Öffnen" and opens the next tab, once both Plans are read for Header and Footer.
$("open-next").addEventListener("click", async () => {
  if (!opened.old || !opened.new || working) return;
  working = true;
  render();
  try {
    await setupTabs.prepare();
  } finally {
    working = false;
    render();
  }
  reach = confirmTab(reach, "open");
  selectTab("old");
});

// Keys of the setup tabs: 1, 2, 3, F, Entf.
const typing = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest("input, textarea, select, dialog[open]");
document.addEventListener("keydown", (e) => {
  if (currentTab !== "old" && currentTab !== "new" && currentTab !== "offset") return;
  if (typing(e.target) || busyWindow.active || picker.isOpen) return;
  if (currentTab === "offset") offsetTab.key(e);
  else setupTabs.key(e);
});
$("zone-canvas").addEventListener("pointerdown", () => (document.activeElement as HTMLElement | null)?.blur?.());

for (const b of document.querySelectorAll<HTMLButtonElement>("#direction-switch button")) {
  b.textContent = DIRECTION_LABEL[b.dataset.value as Direction];
  b.addEventListener("click", () => {
    direction = b.dataset.value as Direction;
    render();
  });
}
for (const b of document.querySelectorAll<HTMLButtonElement>("#shown-switch button")) {
  b.addEventListener("click", () => {
    shown = b.dataset.value as Role;
    renderView();
  });
}

render();
document.body.dataset.ready = "1";
