// The first thin pass through the comparison (slice "match objects and show the first
// Differences"), behind the URL flag `?vergleich`: the "Vergleich" tab compares the two
// Plans with the detected Offset, the default Header and Footer and the Time direction
// from the Old Plan's page shape, and shows both Plans in one picture with the marks.
// A temporary view: the setup tabs and the smooth comparison view replace it.

import { guessTimeDirection } from "../compare/body";
import type { ComparisonSetup, Mark } from "../compare/compare";
import type { TimeDirection } from "../compare/objects";
import type { Engine } from "../engine/client";
import type { BusyWindow } from "./busy";
import { markFrame, type MarkFrame } from "./markframe";
import { drawMarks, MARK_COLOURS } from "./marks";
import type { Role, Sides } from "./openplans";

export interface ComparedPlan {
  /** The page of the Document that is the Plan, 0-based. */
  page: number;
  widthMm: number;
  heightMm: number;
}

export interface FirstComparisonDeps {
  engines: () => Sides<Engine>;
  plans: () => Sides<ComparedPlan | undefined>;
  busy: BusyWindow;
  /** Until the "Öffnen" tab sets it: guessed from the Old Plan's page shape. */
  timeDirection?: () => TimeDirection;
}

export const FLAG = "vergleich";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const mm = (v: number) => v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const seconds = (ms: number) => `${(ms / 1000).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
const count = (n: number) => n.toLocaleString("de-DE");

/** Is the first pass switched on for this page? */
export const isOn = (search = location.search) => new URLSearchParams(search).has(FLAG);

async function picture(engine: Engine, plan: ComparedPlan, frame: MarkFrame): Promise<HTMLCanvasElement> {
  const t = await engine.renderThumbnail({
    page: plan.page,
    maxWidthPx: Math.max(1, Math.round(plan.widthMm * frame.pxPerMm)),
    maxHeightPx: Math.max(1, Math.round(plan.heightMm * frame.pxPerMm)),
  });
  const c = document.createElement("canvas");
  c.width = t.widthPx;
  c.height = t.heightPx;
  c.getContext("2d")!.putImageData(new ImageData(t.pixels as Uint8ClampedArray<ArrayBuffer>, t.widthPx, t.heightPx), 0, 0);
  return c;
}

function showFacts(rows: [string, string][], note: string): void {
  const body = $("body-compare");
  body.replaceChildren();
  const h = document.createElement("h2");
  h.textContent = "Vergleich (erster Durchgang)";
  const p = document.createElement("p");
  p.className = "placeholder";
  p.textContent = note;
  const dl = document.createElement("dl");
  dl.className = "marks-facts";
  for (const [k, v] of rows) {
    const dt = document.createElement("dt"),
      dd = document.createElement("dd");
    dt.textContent = k;
    dd.textContent = v;
    dl.append(dt, dd);
  }
  const legend = document.createElement("ul");
  legend.className = "marks-legend";
  for (const [colour, text] of [
    [MARK_COLOURS.Added, "Hinzugefügt: nur im neuen Plan"],
    [MARK_COLOURS.Removed, "Entfernt: nur im alten Plan"],
    [MARK_COLOURS.Unchanged, "Unverändert: Teil, den beide Pläne zeichnen"],
  ] as const) {
    const li = document.createElement("li"),
      sw = document.createElement("span");
    sw.className = "sw";
    sw.style.background = colour;
    li.append(sw, text);
    legend.append(li);
  }
  body.append(h, p, dl, legend);
}

export function setUpFirstComparison(deps: FirstComparisonDeps): void {
  if (!isOn()) return;
  const tab = $<HTMLButtonElement>("tab-compare");
  const view = $("marks-view"),
    canvas = $<HTMLCanvasElement>("marks-canvas"),
    plansView = $("plans");
  const unlock = () => (tab.disabled = false);
  unlock();
  $("proceed").addEventListener("click", unlock);
  let running = false;

  async function run(): Promise<void> {
    const plans = deps.plans(),
      engines = deps.engines();
    if (running || !plans.old || !plans.new) return;
    running = true;
    view.dataset.state = "running";
    await deps.busy.start("Vergleich wird berechnet…");
    try {
      const started = performance.now();
      const old = plans.old,
        nu = plans.new;
      const timeDirection = deps.timeDirection?.() ?? guessTimeDirection([old.widthMm, old.heightMm]);
      // Both Plans are read at the same time, each in its worker.
      const [newPlan] = await Promise.all([engines.new.planObjects(), engines.old.extractObjects()]);
      const read = performance.now();
      const r = await engines.old.firstPass({ objects: newPlan.objects, pageMm: newPlan.pageMm }, timeDirection);
      const compared = performance.now();
      const frame = markFrame({ old: [old.widthMm, old.heightMm], new: [nu.widthMm, nu.heightMm] }, r.setup.axis, r.setup.offset);
      const pictures = await Promise.all((["old", "new"] as Role[]).map((role) => picture(engines[role], plans[role]!, frame)));
      draw(frame, pictures as [HTMLCanvasElement, HTMLCanvasElement], r.comparison.marks, r.setup);
      const drawn = performance.now();
      const { counts } = r.comparison;
      Object.assign(view.dataset, {
        state: "done",
        added: String(counts.added),
        removed: String(counts.removed),
        offset: r.setup.offset.toFixed(3),
        timeDirection,
      });
      showFacts(
        [
          ["Zeitrichtung", timeDirection === "down" ? "senkrecht" : "waagerecht"],
          ["Versatz", `${mm(r.setup.offset)} mm`],
          ["Kandidaten", r.offset.candidates.map((c) => `${mm(c.offset)} mm (${count(c.votes)})`).join(", ") || "–"],
          ["Hinzugefügt", count(counts.added)],
          ["Entfernt", count(counts.removed)],
          ["Gleiche Objekte", `${count(counts.unchanged)} von ${count(counts.old)} / ${count(counts.new)}`],
          ["Objekte lesen", `${seconds(r.extractMs)} / ${seconds(newPlan.extractMs)} (zusammen ${seconds(read - started)})`],
          ["Versatz suchen", seconds(r.ms.offset)],
          ["Abgleich", seconds(r.ms.compare)],
          ["Übertragen", seconds(compared - read - r.ms.offset - r.ms.compare)],
          ["Bild zeichnen", seconds(drawn - compared)],
          ["Gesamt", seconds(drawn - started)],
        ],
        "Vorläufig: Kopf und Fuß geschätzt, Versatz automatisch gefunden, keine Bereiche ausgenommen.",
      );
    } catch (e) {
      view.dataset.state = "error";
      showFacts([], `Der Vergleich ist fehlgeschlagen: ${String(e)}`);
    } finally {
      running = false;
      await deps.busy.end();
    }
  }

  /** Draws the Old Plan whole and the New Plan's Body on it (its Header and Footer stay put). */
  function draw(frame: MarkFrame, [old, nu]: [HTMLCanvasElement, HTMLCanvasElement], marks: readonly Mark[], setup: ComparisonSetup): void {
    canvas.width = frame.widthPx;
    canvas.height = frame.heightPx;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, frame.widthPx, frame.heightPx);
    ctx.drawImage(old, ...frame.place.old);
    ctx.save();
    const s = frame.pxPerMm,
      [b0, b1] = setup.new.body.map((v) => v + setup.offset);
    const clip = new Path2D();
    if (setup.axis === "y") clip.rect(0, (b0! - frame.y0) * s, frame.widthPx, (b1! - b0!) * s);
    else clip.rect((b0! - frame.x0) * s, 0, (b1! - b0!) * s, frame.heightPx);
    ctx.clip(clip);
    ctx.globalCompositeOperation = "darken";
    ctx.drawImage(nu, ...frame.place.new);
    ctx.restore();
    // A white veil, so the marks stand out.
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillRect(0, 0, frame.widthPx, frame.heightPx);
    drawMarks(ctx, marks, frame);
    canvas.style.width = `${frame.widthPx}px`;
  }

  for (const t of document.querySelectorAll<HTMLButtonElement>(".tab")) {
    t.addEventListener("click", () => {
      const on = t === tab;
      view.hidden = !on;
      plansView.hidden = on;
      if (on) void run();
    });
  }
}
