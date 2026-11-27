// Screenshots for the user to judge the outlines and the x–x–x (one per Place and colour), on
// planted changes of the `activities` and `down` pairs, at Planbreite and 1:1. Only with
// SHOTS_DIR. Reached through the real flow, as in compareview.spec.ts.
import { test, expect, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const APP = pathToFileURL(resolve("dist/index.html")).href;
const SHOTS = process.env.SHOTS_DIR;
const PAIRS = {
  down: [resolve("samples/down-old.pdf"), resolve("samples/down-new.pdf")],
  activities: [resolve("samples/activities-old.pdf"), resolve("samples/activities-new.pdf")],
} as const;
/** Planted changes to centre on (ids in samples/ground-truth.json). */
const SPOTS = {
  activities: { width: ["A9", "A4"], "1to1": ["A9", "A3", "A4", "A1", "A10"] },
  down: { width: ["D8", "D2"], "1to1": ["D8", "D2", "D5", "D1"] },
} as const;

async function compared(page: Page, pair: keyof typeof PAIRS) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(APP);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "1", { timeout: 60_000 });
  const files = PAIRS[pair].map((p) => ({ name: p.split(/[\\/]/).pop()!, b64: readFileSync(p).toString("base64") }));
  await page.evaluate((files) => {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: "application/pdf" }));
    for (const type of ["dragenter", "dragover", "drop"]) document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, files);
  await expect(page.locator("#proceed")).toBeEnabled({ timeout: 60_000 });
  await page.locator("#proceed").click();
  await page.locator("#open-next").click();
  await expect(page.locator("#tab-old")).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
  await page.locator("#body-old [data-action=next]").click();
  await page.locator("#body-new [data-action=next]").click();
  await expect(page.locator("#offset-status")).toHaveAttribute("data-state", "done", { timeout: 60_000 });
  await page.locator("#offset-compare").click();
  await expect(page.locator("#compare-view")).toHaveAttribute("data-state", "done", { timeout: 90_000 });
}

/** The middle of a change's Differences, Old frame mm (an Added box is moved by the Offset). */
function spotOf(pair: keyof typeof PAIRS, id: string): { x: number; y: number } {
  const truth = JSON.parse(readFileSync("samples/ground-truth.json", "utf8"));
  const p = truth.pairs.find((q: { name: string }) => q.name === pair);
  const c = p.changes.find((q: { id: string }) => q.id === id);
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const d of c.differences) {
    const b = d.boxMm,
      dy = d.plan === "new" && p.timeDirection === "down" ? p.offsetMm : 0,
      dx = d.plan === "new" && p.timeDirection === "right" ? p.offsetMm : 0;
    x0 = Math.min(x0, b.x0 + dx);
    y0 = Math.min(y0, b.y0 + dy);
    x1 = Math.max(x1, b.x1 + dx);
    y1 = Math.max(y1, b.y1 + dy);
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

for (const pair of ["activities", "down"] as const) {
  test(`outlines for the user to judge: ${pair}`, async ({ page }) => {
    test.skip(!SHOTS, "only with SHOTS_DIR");
    test.setTimeout(240_000);
    mkdirSync(SHOTS!, { recursive: true });
    await compared(page, pair);
    const made = await page.evaluate(() => (window as any).__spcCompare.inspect());
    writeFileSync(join(SHOTS!, `${pair}-outlines.json`), JSON.stringify({ outlineMs: made.outlineMs, wholeView: made.drawn }));
    for (const [zoomName, key] of [
      ["width", "2"],
      ["1to1", "3"],
    ] as const) {
      await page.keyboard.press(key);
      const zoom = await page.evaluate(() => (window as any).__spcCompare.inspect().zoom as number);
      for (const id of SPOTS[pair][zoomName]) {
        const s = spotOf(pair, id);
        await page.evaluate(([x, y, z]) => (window as any).__spcCompare.setView(x, y, z), [s.x, s.y, zoom]);
        await page.waitForTimeout(500);
        await page.locator("#compare-view").screenshot({ path: join(SHOTS!, `${pair}-${zoomName}-${id}.png`) });
      }
    }
  });
}
