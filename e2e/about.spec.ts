// "Über" (ADR 0009, the clipper's ADR 0012): a 640 px window with four chapters. "Wie geht's"
// walks through the five tabs, "Tastenkürzel" lists every key by tab (built from
// src/ui/shortcuts.ts, kept complete by its unit test), "Lizenz & Dank" points to the source.
import { test, expect, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";

const APP = pathToFileURL(resolve("dist/index.html")).href;
const PAIR = [resolve("samples/activities-old.pdf"), resolve("samples/activities-new.pdf")];
/** Set to keep a picture of each chapter (not committed). */
const SHOTS = process.env.SHOTS_DIR;

test.beforeAll(() => {
  if (!existsSync("dist/index.html")) throw new Error("run `npm run build` first");
  if (!existsSync(PAIR[0]!)) throw new Error("run `npm run samples` first");
});

async function compared(page: Page) {
  await page.setViewportSize({ width: 1500, height: 900 });
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
  await page.locator("#open-next").click();
  await expect(page.locator("#tab-old")).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
  await page.locator("#body-old [data-action=next]").click();
  await page.locator("#body-new [data-action=next]").click();
  await expect(page.locator("#offset-status")).toHaveAttribute("data-state", "done", { timeout: 60_000 });
  await page.locator("#offset-compare").click();
  await expect(page.locator("#compare-view")).toHaveAttribute("data-state", "done", { timeout: 90_000 });
  await expect(page.locator("#body-compare .pl-row").first()).toBeVisible();
}

const CHAPTERS = ["Über das Projekt", "Wie geht's", "Tastenkürzel", "Lizenz & Dank"];

test("Über: 640 px, four chapters, the flow through the tabs, every key by tab, the source and the credits", async ({ page }) => {
  await compared(page);
  await page.locator("#about-open").click();
  const about = page.locator("#about");
  await expect(about).toBeVisible();
  expect((await about.boundingBox())!.width).toBeCloseTo(640, 0);
  await expect(about.locator("h3")).toHaveText(CHAPTERS);
  await expect(about).not.toContainText("folgt mit den nächsten Schritten");

  // Wie geht's: one step per tab, in their order, then the tips.
  const steps = about.locator("#about-steps > li > strong");
  await expect(steps).toHaveText([/^Öffnen/, /^Alter Plan/, /^Neuer Plan/, /^Versatz/, /^Vergleich/]);
  await expect(about.locator("#about-steps")).toContainText("Exportieren");

  // Tastenkürzel: a heading per tab, then its keys as key caps.
  const keys = about.locator("#shortcuts");
  await expect(keys.locator("tr.group th")).toHaveText(["Startseite", "Alter Plan, Neuer Plan", "Versatz", "Vergleich", "Überall"]);
  for (const k of ["H", "J", "K", "M", "F", "Entf", "Bild ↓", "Leertaste", "Strg", "Alt", "Esc"]) await expect(keys.locator("kbd", { hasText: new RegExp(`^${k}$`) }).first()).toBeVisible();
  // The key column is a fixed 30 %, so a long key description wraps instead of squeezing the text.
  const col = (await keys.locator("td").first().boundingBox())!.width;
  const table = (await keys.boundingBox())!.width;
  expect(col / table).toBeCloseTo(0.3, 1);

  // Lizenz & Dank: the source (AGPL) and MuPDF by Artifex.
  const source = about.locator('a[href="https://github.com/futureradius/simplepdfcompare"]');
  await expect(source).toHaveText("github.com/futureradius/simplepdfcompare");
  await expect(about).toContainText("GNU AGPL-3.0 oder neuer");
  await expect(about.locator('a[href="https://mupdf.com/"]')).toHaveText("MuPDF");
  await expect(about).toContainText("© Artifex Software, Inc. (AGPL-3.0)");

  // While Über is open the keys do nothing: H hides nothing.
  const hidden0 = await page.evaluate(() => (window as any).__places.state.hiddenCount as number);
  await page.locator("#body-compare .pl-row").first().evaluate((r) => (r as HTMLElement).click()); // behind the window: selection by script
  await page.keyboard.press("h");
  expect(await page.evaluate(() => (window as any).__places.state.hiddenCount as number)).toBe(hidden0);

  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    const body = about.locator(".body");
    for (const [i, name] of CHAPTERS.entries()) {
      await about.locator("h3").nth(i).evaluate((h) => {
        const b = h.closest(".body")!;
        b.scrollTop = (h as HTMLElement).offsetTop - (b as HTMLElement).offsetTop - 8;
      });
      await page.waitForTimeout(50);
      await body.screenshot({ path: join(SHOTS, `about-${i + 1}-${name.replace(/[^\wäöüÄÖÜß]+/g, "-")}.png`) });
    }
    await page.screenshot({ path: join(SHOTS, "about-window.png") });
  }
  await page.locator("#about-close").click();
  await expect(about).toBeHidden();
});

test("Über opens on the start page too, at the top", async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "1", { timeout: 60_000 });
  await page.locator("#about-open").click();
  await expect(page.locator("#about h3")).toHaveText(CHAPTERS);
  await page.locator("#about .body").evaluate((b) => (b.scrollTop = 500));
  await page.keyboard.press("Escape");
  await page.locator("#about-open").click();
  expect(await page.locator("#about .body").evaluate((b) => b.scrollTop)).toBe(0);
});
