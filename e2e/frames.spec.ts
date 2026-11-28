// Frame times of the comparison view on the 14 m synthetic Plan (ADR 0004: about 60 fps while
// panning and zooming). Only with FRAMES=1, as a measurement: headless timings vary from run
// to run. Writes test-results/compare-frame-times.json.
import { test, expect, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const APP = pathToFileURL(resolve("dist/index.html")).href;
const PAIR = [resolve("samples/down-old.pdf"), resolve("samples/down-new.pdf")];

test.skip(!process.env.FRAMES, "only with FRAMES=1");
// FRAMES_DPR=1.5 measures a laptop screen (more pixels per frame).
test.use({ deviceScaleFactor: Number(process.env.FRAMES_DPR || 1) });

async function compared(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(APP);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "1", { timeout: 60_000 });
  const files = PAIR.map((p) => ({ name: p.split(/[\\/]/).pop()!, b64: readFileSync(p).toString("base64") }));
  await page.evaluate((files) => {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: "application/pdf" }));
    for (const type of ["dragenter", "dragover", "drop"]) document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, files);
  await expect(page.locator("#proceed")).toBeEnabled({ timeout: 60_000 });
  await page.locator("#proceed").click();
  // The real flow: Weiter, Weiter, Weiter, then "Vergleichen" on "Versatz".
  await page.locator("#open-next").click();
  await expect(page.locator("#tab-old")).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
  await page.locator("#body-old [data-action=next]").click();
  await page.locator("#body-new [data-action=next]").click();
  await expect(page.locator("#offset-status")).toHaveAttribute("data-state", "done", { timeout: 60_000 });
  await page.locator("#offset-compare").click();
  await expect(page.locator("#tab-compare")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#compare-view")).toHaveAttribute("data-state", "done", { timeout: 90_000 });
}

interface Motion {
  name: string;
  /** View per frame: centre x, y (mm) and zoom (CSS px per mm). */
  from: [number, number, number];
  to: [number, number, number];
  frames: number;
}

/** Moves the view once per frame along a path, and measures the time between frames and the JS per frame. */
function run(page: Page, m: Motion) {
  return page.evaluate(async (m) => {
    const api = (window as any).__spcCompare;
    api.setView(...m.from);
    // Let the view rest and its sharp layers arrive first, as when the user starts to move.
    await new Promise((r) => setTimeout(r, 600));
    const gaps: number[] = [],
      js: number[] = [];
    await new Promise<void>((done) => {
      let i = 0,
        last = 0;
      const tick = (t: number) => {
        if (last) gaps.push(t - last);
        last = t;
        if (i > 0) js.push(api.frame().ms);
        if (i > m.frames) return done();
        const u = i / m.frames;
        // Zoom moves geometrically, so a zoom path feels even.
        const z = m.from[2] * Math.pow(m.to[2] / m.from[2], u);
        api.setView(m.from[0] + (m.to[0] - m.from[0]) * u, m.from[1] + (m.to[1] - m.from[1]) * u, z);
        i++;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const q = (a: number[], p: number) => {
      const s = [...a].sort((x, y) => x - y);
      return +s[Math.min(s.length - 1, Math.floor(p * s.length))]!.toFixed(1);
    };
    return {
      name: m.name,
      frames: gaps.length,
      p50: q(gaps, 0.5),
      p95: q(gaps, 0.95),
      max: q(gaps, 1),
      dropped: gaps.filter((g) => g > 1.5 * (1000 / 60)).length,
      jsP50: q(js, 0.5),
      jsP95: q(js, 0.95),
      jsMax: q(js, 1),
      marks: api.inspect().drawn.marks,
    };
  }, m);
}

/** After the view rests at 1:1: how long until the sharp layers are there. */
function sharpAfterRest(page: Page, at: [number, number, number]) {
  return page.evaluate(async (at) => {
    const api = (window as any).__spcCompare;
    const before = api.inspect().sharpRenders;
    const t0 = performance.now();
    api.setView(...at);
    // Both Plans: two sharp layers, one from each worker.
    while (performance.now() - t0 < 5000) {
      await new Promise((r) => requestAnimationFrame(r));
      if (api.frame().sharpRenders >= before + 2) return Math.round(performance.now() - t0);
    }
    return -1;
  }, at);
}

test("frame times while panning and zooming the 14 m Plan", async ({ page }) => {
  test.setTimeout(300_000);
  await compared(page);
  const s = (await page.evaluate(() => (window as any).__spcCompare.inspect())) as { frame: { x1: number; y1: number }; cssW: number; cssH: number };
  const W = s.frame.x1,
    H = s.frame.y1;
  const whole = Math.min(s.cssW / W, s.cssH / H) * 0.98;
  const width = s.cssW / (W * 1.02);
  const oneToOne = 96 / 25.4;
  const motions: Motion[] = [
    { name: "pan, whole Plan", from: [W / 2, H / 2, whole], to: [W / 2 + 200, H / 2 + 2000, whole], frames: 120 },
    { name: "pan, Planbreite (about 1 px/mm), the whole length", from: [W / 2, 500, width], to: [W / 2, H - 500, width], frames: 240 },
    { name: "pan, 1:1 (3.78 px/mm), along D4", from: [690, 5600, oneToOne], to: [690, 7000, oneToOne], frames: 180 },
    { name: "pan, 4:1 (15 px/mm)", from: [690, 6100, oneToOne * 4], to: [760, 6500, oneToOne * 4], frames: 180 },
    { name: "zoom in, whole Plan to 1:1", from: [690, 6275, whole], to: [690, 6275, oneToOne], frames: 180 },
    { name: "zoom out, 1:1 to whole Plan", from: [690, 6275, oneToOne], to: [690, 6275, whole], frames: 180 },
  ];
  const results = [];
  for (const m of motions) results.push(await run(page, m));
  const sharpMs = await sharpAfterRest(page, [700, 9000, oneToOne]);
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/compare-frame-times.json", JSON.stringify({ results, sharpAfterRestMs: sharpMs }, null, 2));
  console.log(
    "FRAME TIMES (ms between frames; JS = draw time per frame):\n" +
      results.map((r) => `${r.name}: frames=${r.frames} p50=${r.p50} p95=${r.p95} max=${r.max} dropped=${r.dropped} JS p50=${r.jsP50} p95=${r.jsP95} max=${r.jsMax} marks=${r.marks}`).join("\n") +
      `\nsharp layers after the view rests at 1:1: ${sharpMs} ms (incl. the 120 ms delay)`,
  );
  for (const r of results) expect(r.p95).toBeLessThan(40);
});
