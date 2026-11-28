// How responsive the comparison view stays after a change that repaints its marks (issue
// #57, ADR 0010): long main-thread tasks after the busy window, after a filter change (a kind
// unchecked, then checked again), after H, after M off and on, and after a display setting.
// Also the frame times while panning and zooming the same pair.
//
// Only with RESPONSIVE=1, as a measurement: headless timings vary from run to run. The pair
// is the synthetic "dense" one; RESPONSIVE_OLD and RESPONSIVE_NEW (two PDF paths), or
// RESPONSIVE_DIR (a folder with exactly two PDFs, the Old one first by name or the one
// called "old" / "alt"), point it at another pair. Writes test-results/responsive.json.
//
// On the synthetic pair it also checks: no task over RESPONSIVE_MAX_MS (default 200 ms)
// after any of the changes. Another pair is only measured, never checked.
import { test, expect, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { basename, join, resolve } from "node:path";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const APP = pathToFileURL(resolve("dist/index.html")).href;

function pair(): { files: string[]; synthetic: boolean } {
  const { RESPONSIVE_OLD: o, RESPONSIVE_NEW: n, RESPONSIVE_DIR: dir } = process.env;
  if (o && n) return { files: [resolve(o), resolve(n)], synthetic: false };
  if (dir) {
    const pdfs = readdirSync(dir)
      .filter((f) => /\.pdf$/i.test(f))
      .sort((a, b) => Number(/old|alt/i.test(b)) - Number(/old|alt/i.test(a)) || a.localeCompare(b));
    if (pdfs.length !== 2) throw new Error(`RESPONSIVE_DIR needs exactly two PDFs, found ${pdfs.length}`);
    return { files: pdfs.map((f) => resolve(join(dir, f))), synthetic: false };
  }
  return { files: [resolve("samples/dense-old.pdf"), resolve("samples/dense-new.pdf")], synthetic: true };
}
const PAIR = pair();
const MAX_MS = Number(process.env.RESPONSIVE_MAX_MS || 200);
/** How long after a change its long tasks are collected, ms. */
const WINDOW_MS = Number(process.env.RESPONSIVE_WINDOW_MS || 8000);

test.skip(!process.env.RESPONSIVE, "only with RESPONSIVE=1");

async function compared(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__long = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__long.push({ start: e.startTime, ms: e.duration });
    }).observe({ type: "longtask", buffered: true });
    // Long animation frames, with what ran in them (which kind of callback), where supported.
    w.__loaf = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as any[])
          w.__loaf.push({ start: e.startTime, ms: e.duration, scripts: (e.scripts ?? []).map((x: any) => ({ invoker: String(x.invokerType ?? x.invoker ?? ""), ms: x.duration })) });
      }).observe({ type: "long-animation-frame", buffered: true });
    } catch {
      // not supported: the steps below still say what was slow
    }
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(APP);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "1", { timeout: 60_000 });
  const files = PAIR.files.map((p) => ({ name: basename(p), b64: readFileSync(p).toString("base64") }));
  await page.evaluate((files) => {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: "application/pdf" }));
    for (const type of ["dragenter", "dragover", "drop"]) document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, files);
  await expect(page.locator("#proceed")).toBeEnabled({ timeout: 120_000 });
  await page.locator("#proceed").click();
  await page.locator("#open-next").click();
  await expect(page.locator("#tab-old")).toHaveAttribute("aria-selected", "true", { timeout: 120_000 });
  await page.locator("#body-old [data-action=next]").click();
  await page.locator("#body-new [data-action=next]").click();
  await expect(page.locator("#offset-status")).toHaveAttribute("data-state", "done", { timeout: 120_000 });
  await page.locator("#offset-compare").click();
  await expect(page.locator("#compare-view")).toHaveAttribute("data-state", "done", { timeout: 300_000 });
  await expect(page.locator("#body-compare .pl-row").first()).toBeVisible();
}

interface Probe {
  name: string;
  /** Long tasks in the window after the change. */
  tasks: number;
  maxMs: number;
  totalMs: number;
  /**
   * How long the view showed marks not up to date (outdated or stood-in tiles): from the first
   * frame that knew of the change until the first that showed it complete, ms; -1: not
   * within the window. For a change that leaves the tiles as they are (M), from the action.
   */
  shownMs: number;
  /** The longest gap between two frames in the window, ms. */
  maxFrameMs: number;
  /**
   * The app's named steps that took 15 ms or more ("spc …" measures, src/ui/spans.ts): per
   * name, how often, the longest and the total, ms. Says which step a long task was.
   */
  steps: Record<string, [number, number, number]>;
  /** Of the frames over 100 ms: per kind of callback that ran in them, the longest and the total, ms. */
  frames: Record<string, [number, number]>;
}

/**
 * Does `act` (in the page), then for WINDOW_MS collects the long tasks and the frame gaps,
 * and when the view first showed the change complete.
 */
async function probe(page: Page, name: string, act: () => Promise<void>, opts: { changesTiles?: boolean; scrollList?: boolean } = {}): Promise<Probe> {
  await page.evaluate((changesTiles) => {
    const w = window as any;
    w.__long = [];
    w.__t0 = performance.now();
    w.__gaps = [];
    w.__shown = -1;
    const id = (w.__probing = (w.__probe = (w.__probe ?? 0) + 1));
    const v0 = w.__spcCompare.frame().tileVersion;
    let last = 0,
      changed = changesTiles ? -1 : w.__t0 + 30;
    const tick = (t: number) => {
      if (w.__probing !== id) return; // a later probe, or done
      if (last) w.__gaps.push(t - last);
      last = t;
      if (w.__shown < 0) {
        const s = w.__spcCompare.frame();
        if (changed < 0 && s.tileVersion !== v0) changed = t;
        if (changed >= 0 && t >= changed && s.marksReady) w.__shown = t - changed;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, !!opts.changesTiles);
  await act();
  if (opts.scrollList) {
    // The list scrolled with the wheel, as the user does right after the busy window.
    const list = page.locator("#body-compare .pl-scroll");
    const b = (await list.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(40);
    }
  }
  await page.waitForTimeout(WINDOW_MS);
  return page.evaluate((name) => {
    const w = window as any;
    w.__probing = 0;
    const long = (w.__long as { start: number; ms: number }[]).filter((e) => e.start >= w.__t0 - 5);
    return {
      name,
      tasks: long.length,
      maxMs: Math.round(Math.max(0, ...long.map((e) => e.ms))),
      totalMs: Math.round(long.reduce((s, e) => s + e.ms, 0)),
      shownMs: Math.round(w.__shown),
      maxFrameMs: Math.round(Math.max(0, ...(w.__gaps as number[]))),
      steps: (() => {
        const out: Record<string, [number, number, number]> = {};
        for (const m of performance.getEntriesByType("measure")) {
          if (!m.name.startsWith("spc ") || m.startTime < w.__t0 - 5) continue;
          const o = (out[m.name.slice(4)] ??= [0, 0, 0]);
          o[0]++;
          o[1] = Math.max(o[1], Math.round(m.duration));
          o[2] += Math.round(m.duration);
        }
        performance.clearMeasures();
        return out;
      })(),
      frames: (() => {
        const out: Record<string, [number, number]> = {};
        for (const f of w.__loaf as { start: number; ms: number; scripts: { invoker: string; ms: number }[] }[]) {
          if (f.start < w.__t0 - 5 || f.ms < 100) continue;
          const by: Record<string, number> = {};
          for (const x of f.scripts) by[x.invoker] = (by[x.invoker] ?? 0) + x.ms;
          if (!f.scripts.length) by["(no script)"] = f.ms;
          for (const [k, ms] of Object.entries(by)) {
            const o = (out[k] ??= [0, 0]);
            o[0] = Math.max(o[0], Math.round(ms));
            o[1] += Math.round(ms);
          }
        }
        w.__loaf = [];
        return out;
      })(),
    };
  }, name);
}

/** The slow steps and the scripts in long frames of a probe, on one line, the longest first. */
function steps(r: Probe): string {
  const st = Object.entries(r.steps).sort((a, b) => b[1][1] - a[1][1]);
  const fr = Object.entries(r.frames).sort((a, b) => b[1][0] - a[1][0]);
  return (
    (st.length ? `\n    steps (count, longest, total ms): ${st.map(([n, [c, m, t]]) => `${n} ${c}× ${m}/${t}`).join("; ")}` : "") +
    (fr.length ? `\n    in frames over 100 ms (longest, total ms): ${fr.map(([n, [m, t]]) => `${n} ${m}/${t}`).join("; ")}` : "")
  );
}

interface Motion {
  name: string;
  from: [number, number, number];
  to: [number, number, number];
  frames: number;
}

/** Moves the view once per frame along a path (as e2e/frames.spec.ts), and measures the time between frames. */
function run(page: Page, m: Motion) {
  return page.evaluate(async (m) => {
    const api = (window as any).__spcCompare;
    api.setView(...m.from);
    await new Promise((r) => setTimeout(r, 1500));
    const gaps: number[] = [],
      js: number[] = [];
    performance.clearMeasures();
    const t0 = performance.now();
    await new Promise<void>((done) => {
      let i = 0,
        last = 0;
      const tick = (t: number) => {
        if (last) gaps.push(t - last);
        if (i > 0) js.push(api.frame().ms);
        last = t;
        if (i > m.frames) return done();
        const u = i / m.frames;
        const z = m.from[2] * Math.pow(m.to[2] / m.from[2], u);
        api.setView(m.from[0] + (m.to[0] - m.from[0]) * u, m.from[1] + (m.to[1] - m.from[1]) * u, z);
        i++;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const s = [...gaps].sort((x, y) => x - y);
    const q = (p: number) => +s[Math.min(s.length - 1, Math.floor(p * s.length))]!.toFixed(1);
    const steps: Record<string, [number, number]> = {};
    for (const e of performance.getEntriesByType("measure")) {
      if (!e.name.startsWith("spc ") || e.startTime < t0) continue;
      const o = (steps[e.name.slice(4)] ??= [0, 0]);
      o[0]++;
      o[1] = Math.max(o[1], Math.round(e.duration));
    }
    const jsMax = Math.round(Math.max(0, ...js) * 10) / 10;
    return { name: m.name, frames: gaps.length, p50: q(0.5), p95: q(0.95), max: q(1), dropped: gaps.filter((g) => g > 1.5 * (1000 / 60)).length, jsMax, steps };
  }, m);
}

test("the view stays responsive after filtering, hiding, M and a display setting", async ({ page }) => {
  test.setTimeout(900_000);
  await compared(page);
  const results: Probe[] = [];
  // Right after the busy window: what is painted ahead, while the user scrolls the list.
  results.push(await probe(page, "after the busy window (list scrolled)", async () => {}, { scrollList: true }));

  const info = await page.evaluate(() => {
    const ps = (window as any).__places.state.places as { no: number; kind: string; kinds: string[] }[];
    const count = new Map<string, number>();
    for (const p of ps) if (p.kinds.length === 1) count.set(p.kind, (count.get(p.kind) ?? 0) + 1);
    const kind = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ps[0]!.kind;
    const s = (window as any).__spcCompare.inspect();
    return { places: ps.length, kind, groups: s.outlineGroups as number, marks: s.drawn.marks as number };
  });

  await page.locator(".filter-btn").click();
  await expect(page.locator(".filter-panel")).toBeVisible();
  const box = page.locator(`.filter-panel input[data-kind="${info.kind}"]`);
  results.push(await probe(page, "filter: one kind unchecked", () => box.uncheck(), { changesTiles: true }));
  results.push(await probe(page, "filter: checked again", () => box.check(), { changesTiles: true }));
  await page.keyboard.press("Escape");
  await expect(page.locator(".filter-panel")).toBeHidden();

  // H: one Place selected in the list (Ctrl + click: the Plan stays), then hidden.
  const row = page.locator("#body-compare .pl-row").nth(2);
  await row.click({ modifiers: ["Control"] });
  await page.waitForTimeout(1500);
  results.push(await probe(page, "H (one Place hidden)", () => page.keyboard.press("h"), { changesTiles: true }));

  results.push(await probe(page, "M (marks off)", () => page.keyboard.press("m")));
  results.push(await probe(page, "M (marks on again)", () => page.keyboard.press("m")));

  // A display setting: how Removed is outlined, there and back.
  const pick = (v: string) => page.evaluate((v) => (document.querySelector(`.display .wsw-btn[data-value="${v}"]`) as HTMLButtonElement).click(), v);
  const removed = await page.evaluate(() => (window as any).__spcCompare.inspect().settings.removed as string);
  results.push(await probe(page, "display: Removed outlined otherwise", () => pick(removed === "xxx" ? "soft" : "xxx"), { changesTiles: true }));
  results.push(await probe(page, "display: and back", () => pick(removed), { changesTiles: true }));

  // Panning and zooming the same pair.
  const s = (await page.evaluate(() => (window as any).__spcCompare.inspect())) as { frame: { x0: number; y0: number; x1: number; y1: number }; cssW: number; cssH: number };
  const f = s.frame,
    W = f.x1 - f.x0,
    H = f.y1 - f.y0,
    cx = (f.x0 + f.x1) / 2,
    cy = (f.y0 + f.y1) / 2;
  const whole = Math.min(s.cssW / W, s.cssH / H) * 0.98,
    width = s.cssW / (W * 1.02),
    oneToOne = 96 / 25.4;
  const motions: Motion[] = [
    { name: "pan, whole Plan", from: [cx, cy, whole], to: [cx + W / 10, cy + H / 7, whole], frames: 120 },
    { name: "pan, Planbreite", from: [cx, f.y0 + H * 0.1, width], to: [cx, f.y0 + H * 0.9, width], frames: 240 },
    { name: "zoom in, whole Plan to 1:1", from: [cx, cy, whole], to: [cx, cy, oneToOne], frames: 180 },
    { name: "zoom out, 1:1 to whole Plan", from: [cx, cy, oneToOne], to: [cx, cy, whole], frames: 180 },
  ];
  const frames = [];
  for (const m of motions) frames.push(await run(page, m));

  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/responsive.json", JSON.stringify({ synthetic: PAIR.synthetic, places: info.places, outlineGroups: info.groups, marks: info.marks, results, frames }, null, 2));
  console.log(
    `RESPONSIVENESS (${PAIR.synthetic ? "synthetic dense pair" : "given pair"}; long tasks in the ${WINDOW_MS / 1000} s after each change):\n` +
      results.map((r) => `${r.name}: tasks=${r.tasks} max=${r.maxMs} ms total=${r.totalMs} ms outdated marks shown for ${r.shownMs} ms, longest frame ${r.maxFrameMs} ms` + steps(r)).join("\n") +
      "\nFRAME TIMES (ms between frames):\n" +
      frames
        .map(
          (r) =>
            `${r.name}: frames=${r.frames} p50=${r.p50} p95=${r.p95} max=${r.max} dropped=${r.dropped}, draw JS max ${r.jsMax} ms` +
            (Object.keys(r.steps).length ? `\n    steps (count, longest ms): ${Object.entries(r.steps).map(([n, [c, mx]]) => `${n} ${c}× ${mx}`).join("; ")}` : ""),
        )
        .join("\n"),
  );
  if (PAIR.synthetic) {
    for (const r of results) expect(r.maxMs, r.name).toBeLessThan(MAX_MS);
    for (const r of results) if (r.name.startsWith("filter") || r.name.startsWith("H") || r.name.startsWith("display") || r.name.includes("on again")) expect(r.shownMs, r.name).toBeGreaterThanOrEqual(0);
  }
});
