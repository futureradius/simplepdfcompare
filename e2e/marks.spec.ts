// The temporary "Vergleich" view: after the setup tabs and "Vergleichen" on "Versatz" it draws
// the marks of the comparison (default Header and Footer, the Offset found) and lists the Places.
import { test, expect, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const APP = pathToFileURL(resolve("dist/index.html")).href;
const PAIRS = {
  down: [resolve("samples/down-old.pdf"), resolve("samples/down-new.pdf")],
  right: [resolve("samples/right-old.pdf"), resolve("samples/right-new.pdf")],
} as const;

test.beforeAll(() => {
  if (!existsSync("dist/index.html")) throw new Error("run `npm run build` first");
  if (!existsSync(PAIRS.down[0])) throw new Error("run `npm run samples` first");
});

async function openPair(page: Page, url: string, paths: readonly string[]) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(url);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "1", { timeout: 60_000 });
  const files = paths.map((p) => ({ name: p.split(/[\\/]/).pop()!, b64: readFileSync(p).toString("base64") }));
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
  await expect(page.locator("#tab-offset")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#offset-status")).toHaveAttribute("data-state", "done", { timeout: 60_000 });
}

/** How many pixels of the marks canvas have each mark colour. */
const colours = (page: Page) =>
  page.evaluate(() => {
    const c = document.getElementById("compare-canvas") as HTMLCanvasElement;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let red = 0,
      yellow = 0,
      grey = 0;
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b] = [d[i]!, d[i + 1]!, d[i + 2]!];
      if (r > 200 && g < 80 && b < 80) red++;
      // Removed yellow, or its darker x–x–x line and ring.
      else if (r > 170 && g > 120 && g < 210 && b < 70) yellow++;
      else if (Math.abs(r - 74) < 6 && Math.abs(g - 74) < 6 && Math.abs(b - 74) < 6) grey++;
    }
    return { red, yellow, grey };
  });

for (const [name, offset] of [
  ["down", "560,00"],
  ["right", "36,00"],
] as const) {
  test(`Vergleichen: the ${name} pair is compared and its marks are drawn`, async ({ page }) => {
    const errors: string[] = [],
      external: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("file:") || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
      external.push(url);
      return route.abort();
    });
    await openPair(page, APP, PAIRS[name]);
    await expect(page.locator("#tab-compare")).toBeDisabled();
    await page.locator("#offset-compare").click();
    const view = page.locator("#compare-view");
    await expect(view).toHaveAttribute("data-state", "done", { timeout: 90_000 });
    await expect(page.locator("#plans")).toBeHidden();
    await expect(page.locator("#body-compare")).toContainText(`${offset} mm`);
    expect(Number(await view.getAttribute("data-added"))).toBeGreaterThan(0);
    expect(Number(await view.getAttribute("data-removed"))).toBeGreaterThan(0);
    const c = await colours(page);
    expect(c.red).toBeGreaterThan(20);
    expect(c.yellow).toBeGreaterThan(20);
    // Both pairs have a shape that moved by less than its length: its common part is grey.
    // On the 14 m Plan it is too small to see whole, so the view goes to it (planted D4).
    if (name === "down") {
      await page.keyboard.press("2");
      await page.evaluate(() => (window as any).__spcCompare.centerOn(690, 6275));
      await page.keyboard.press("3");
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    }
    expect((await colours(page)).grey).toBeGreaterThan(20);
    await page.screenshot({ path: `test-results/marks-${name}.png` });
    // Back on another tab, the Plans are shown again.
    await page.locator("#tab-open").click();
    await expect(page.locator("#plans")).toBeVisible();
    await expect(view).toBeHidden();
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });
}

// A temporary readout of the Places (slice "Places, their names and kinds of change"), until
// the real list replaces it: one row per Place with its name, main kind, Wann and Wo.
test("Vergleich lists the Places of the activities pair in the sidebar", async ({ page }) => {
  const gt = JSON.parse(readFileSync("samples/ground-truth.json", "utf8")).pairs.find((p: { name: string }) => p.name === "activities");
  await openPair(page, APP, [resolve("samples/activities-old.pdf"), resolve("samples/activities-new.pdf")]);
  await expect(page.locator("#tab-compare")).toBeDisabled();
  await page.locator("#offset-compare").click();
  await expect(page.locator("#compare-view")).toHaveAttribute("data-state", "done", { timeout: 90_000 });
  await expect(page.locator("#plans")).toBeHidden();
  await expect(page.locator("#body-compare .places-readout")).toBeVisible();
  const rows = page.locator("#body-compare .places-readout li");
  await expect(rows).toHaveCount(gt.changes.length);
  await expect(page.locator("#body-compare .places-readout")).toContainText("Gleis 1 erneuern");
  const row = rows.filter({ hasText: "Gleis 2 erneuern mit Schotter" });
  await expect(row).toContainText("Verlängert");
  await expect(row).toContainText("um 1 Tag 6 Std.");
  await expect(row).toContainText("km 15,5–16,0");
  await page.screenshot({ path: "test-results/places-activities.png" });
});

test("the Vergleich tab stays locked until Vergleichen has run", async ({ page }) => {
  await openPair(page, APP, PAIRS.right);
  await expect(page.locator("#tab-compare")).toBeDisabled();
});
