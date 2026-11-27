// The temporary "Vergleich" view (until the smooth comparison view replaces it): it listens
// for the ComparisonResult that "Vergleichen" hands over (src/ui/handoff.ts) and shows both
// Plans in one picture with the marks, and the facts and the Places in the sidebar.

import type { Place } from "../compare/places";
import { kindText, umText, wannText, wasText, woText } from "../compare/wording";
import type { ComparisonSetup, Mark } from "../compare/compare";
import type { ComparisonResult } from "../compare/result";
import type { Engine } from "../engine/client";
import type { BusyWindow } from "./busy";
import { markFrame, type MarkFrame } from "./markframe";
import { drawMarks, MARK_COLOURS } from "./marks";
import type { ComparisonHandoff } from "./handoff";
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
  handoff: ComparisonHandoff;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const mm = (v: number) => v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const seconds = (ms: number) => `${(ms / 1000).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
const count = (n: number) => n.toLocaleString("de-DE");

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

/**
 * A temporary readout of the Places (until the list of Places replaces it): one row each,
 * with its number, name (Was), main kind and other kinds (Art), amount (Um), Wann and Wo.
 */
function showPlaces(places: readonly Place[]): void {
  const h = document.createElement("h3");
  h.textContent = `Stellen (${count(places.length)})`;
  const ol = document.createElement("ol");
  ol.className = "places-readout";
  for (const p of places) {
    const li = document.createElement("li"),
      was = document.createElement("b");
    was.textContent = wasText(p);
    if (p.name && p.name !== was.textContent) was.title = p.name;
    const um = umText(p.amount);
    const art = [kindText(p.kind), ...p.kinds.slice(1).map((k) => `+ ${kindText(k)}`), um ? `um ${um}` : ""].filter(Boolean).join(" ");
    const where = [wannText(p.when), woText(p.where)].filter(Boolean).join(" · ");
    li.append(was, document.createElement("br"), `${art}${where ? ` · ${where}` : ""}`);
    ol.append(li);
  }
  $("body-compare").append(h, ol);
}

export function setUpFirstComparison(deps: FirstComparisonDeps) {
  const view = $("marks-view"),
    canvas = $<HTMLCanvasElement>("marks-canvas"),
    plansView = $("plans");
  let shown = false;
  /** The result the picture and the sidebar show now. */
  let drawn: ComparisonResult | undefined;
  let drawing = false;

  async function show(r: ComparisonResult): Promise<void> {
    const plans = deps.plans(),
      engines = deps.engines();
    if (drawing || !plans.old || !plans.new) return;
    drawing = true;
    view.dataset.state = "running";
    await deps.busy.start("Vergleich wird angezeigt…");
    try {
      const started = performance.now();
      const old = plans.old,
        nu = plans.new;
      const frame = markFrame({ old: [old.widthMm, old.heightMm], new: [nu.widthMm, nu.heightMm] }, r.setup.axis, r.setup.offset);
      const pictures = await Promise.all((["old", "new"] as Role[]).map((role) => picture(engines[role], plans[role]!, frame)));
      draw(frame, pictures as [HTMLCanvasElement, HTMLCanvasElement], r.comparison.marks, r.setup);
      const { counts } = r.comparison;
      Object.assign(view.dataset, {
        state: "done",
        added: String(counts.added),
        removed: String(counts.removed),
        offset: r.setup.offset.toFixed(3),
        timeDirection: r.timeDirection,
        places: String(r.places.length),
      });
      showFacts(
        [
          ["Zeitrichtung", r.timeDirection === "down" ? "senkrecht" : "waagerecht"],
          ["Versatz", `${mm(r.setup.offset)} mm`],
          ["Kopf und Fuß alt", `${mm(r.setup.old.body[0])} / ${mm(r.setup.old.body[1])} mm`],
          ["Kopf und Fuß neu", `${mm(r.setup.new.body[0])} / ${mm(r.setup.new.body[1])} mm`],
          ["Ausgenommen", `${count(r.setup.old.ignored.length)} alt / ${count(r.setup.new.ignored.length)} neu`],
          ["Kandidaten", r.offsetCandidates.map((c) => `${mm(c.offset)} mm (${count(c.votes)})`).join(", ") || "–"],
          ["Hinzugefügt", count(counts.added)],
          ["Entfernt", count(counts.removed)],
          ["Gleiche Objekte", `${count(counts.unchanged)} von ${count(counts.old)} / ${count(counts.new)}`],
          ["Abgleich", seconds(r.ms.compare)],
          ["Stellen bilden", seconds(r.ms.places)],
          ["Übertragen", seconds(r.ms.transfer)],
          ["Bild zeichnen", seconds(performance.now() - started)],
        ],
        "Vorläufige Ansicht: Sie zeigt das Ergebnis des Vergleichs mit Ihren Einstellungen.",
      );
      showPlaces(r.places);
      drawn = r;
    } catch (e) {
      view.dataset.state = "error";
      showFacts([], `Der Vergleich konnte nicht gezeigt werden: ${String(e)}`);
    } finally {
      drawing = false;
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

  return {
    /** The "Vergleich" tab is shown: draws the latest result (once). */
    enter(): void {
      shown = true;
      view.hidden = false;
      plansView.hidden = true;
      const r = deps.handoff.latest();
      if (r && r !== drawn) void show(r);
    },
    /** Another tab is shown. */
    leave(): void {
      shown = false;
      view.hidden = true;
      plansView.hidden = false;
    },
    /** Hears a new result while the tab is already shown (it is drawn at once). */
    listen(): () => void {
      return deps.handoff.subscribe((r) => {
        if (shown && r !== drawn) void show(r);
      });
    },
  };
}
