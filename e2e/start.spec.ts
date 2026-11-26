import { test, expect, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { makeMultiPageDocument } from "../src/testing/multipage";

const APP = pathToFileURL(resolve("dist/index.html")).href;
const OUT = resolve("test-results/fixtures");
const OLD = resolve("samples/down-old.pdf");
const NEW = resolve("samples/down-new.pdf");
const RIGHT_OLD = resolve("samples/right-old.pdf");
const RIGHT_NEW = resolve("samples/right-new.pdf");
const LONG_NAME = "Bauzeitenplan_Neubau_Wohnanlage_Hauptstrasse_Abschnitt_3_Ausfuehrung_Stand_2026-11-26_Index_C_final_abgestimmt.pdf";
let THREE: string;
let LONG: string;

test.beforeAll(() => {
  if (!existsSync("dist/index.html")) throw new Error("run `npm run build` first");
  if (!existsSync(OLD)) throw new Error("run `npm run samples` first");
  mkdirSync(OUT, { recursive: true });
  // A three-page Document, generated here (synthetic, not committed).
  THREE = join(OUT, "drei-seiten.pdf");
  writeFileSync(THREE, makeMultiPageDocument());
  LONG = join(OUT, LONG_NAME);
  writeFileSync(LONG, readFileSync(OLD));
});

async function open(page: Page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(APP);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "1", { timeout: 60_000 });
}

/** Drops files onto an element like the browser would (real DataTransfer, real File objects). */
async function drop(page: Page, selector: string, paths: string[]) {
  const files = paths.map((p) => ({ name: p.split(/[\\/]/).pop()!, b64: readFileSync(p).toString("base64") }));
  await page.evaluate(
    ({ selector, files }) => {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: "application/pdf" }));
      const target = document.querySelector(selector)!;
      for (const type of ["dragenter", "dragover", "drop"]) target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    { selector, files },
  );
}

const name = (page: Page, role: "old" | "new") => page.locator(`#box-${role} .file-name`);

test("shows the start page with the intro, two empty boxes and the offline note", async ({ page }) => {
  await open(page);
  expect(await page.locator("body").getAttribute("data-engine")).toBe("worker");
  await expect(page.locator("#start h1")).toHaveText("Zwei Versionen eines Plans vergleichen");
  await expect(page.locator("#start .local")).toContainText("nicht hochgeladen");
  await expect(page.locator("#start .local")).toContainText("ohne Internet");
  await expect(page.locator("#box-old")).toContainText("Alter Plan");
  await expect(page.locator("#box-new")).toContainText("Neuer Plan");
  await expect(page.locator("#proceed")).toBeDisabled();
  await page.screenshot({ path: "test-results/start-empty.png" });
});

test("opens a file by clicking a box", async ({ page }) => {
  await open(page);
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#box-new").click();
  await (await chooser).setFiles(NEW);
  await expect(name(page, "new")).toHaveText("down-new.pdf");
  await expect(page.locator("#box-old .file-name")).toHaveCount(0);
  await expect(page.locator("#proceed")).toBeDisabled();
});

test("a PDF dropped anywhere fills the first empty box", async ({ page }) => {
  await open(page);
  await drop(page, "#start h1", [OLD]);
  await expect(name(page, "old")).toHaveText("down-old.pdf");
  await drop(page, "#start .local", [NEW]);
  await expect(name(page, "new")).toHaveText("down-new.pdf");
  await expect(page.locator("#proceed")).toBeEnabled();
});

test("two PDFs dropped at once fill both boxes in order", async ({ page }) => {
  await open(page);
  await drop(page, "body", [OLD, NEW]);
  await expect(name(page, "old")).toHaveText("down-old.pdf");
  await expect(name(page, "new")).toHaveText("down-new.pdf");
  await expect(page.locator("#proceed")).toBeEnabled();
});

test("a file dropped on a filled box replaces it", async ({ page }) => {
  await open(page);
  await drop(page, "body", [OLD, NEW]);
  await expect(name(page, "new")).toHaveText("down-new.pdf");
  await drop(page, "#box-new", [RIGHT_NEW]);
  await expect(name(page, "new")).toHaveText("right-new.pdf");
  await expect(name(page, "old")).toHaveText("down-old.pdf");
});

test("swap exchanges the two files", async ({ page }) => {
  await open(page);
  await drop(page, "body", [OLD, NEW]);
  await expect(name(page, "new")).toHaveText("down-new.pdf");
  await page.locator("#swap-start").click();
  await expect(name(page, "old")).toHaveText("down-new.pdf");
  await expect(name(page, "new")).toHaveText("down-old.pdf");
  await page.locator("#swap-start").click();
  await expect(name(page, "old")).toHaveText("down-old.pdf");
});

test("a long file name stays fully readable and does not break the layout", async ({ page }) => {
  await open(page);
  await drop(page, "body", [LONG]);
  const n = name(page, "old");
  await expect(n).toHaveText(LONG_NAME);
  const box = (await page.locator("#box-old").boundingBox())!;
  const text = (await n.boundingBox())!;
  expect(text.x).toBeGreaterThanOrEqual(box.x);
  expect(text.x + text.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/start-long-name.png" });
});

test("a three-page Document shows the page picker; picking a page makes it the Plan", async ({ page }) => {
  await open(page);
  await drop(page, "body", [THREE]);
  await expect(page.locator("#pages")).toBeVisible();
  await expect(page.locator("#pages-grid .thumb")).toHaveCount(3);
  await expect(page.locator("#pages-info")).toContainText("3 Seiten");
  await page.screenshot({ path: "test-results/page-picker.png" });
  await page.locator("#pages-grid .thumb").nth(1).click();
  await expect(page.locator("#pages")).toBeHidden();
  await expect(name(page, "old")).toHaveText("drei-seiten.pdf");
  await expect(page.locator("#box-old .pager")).toContainText("Seite 2 von 3");
  await expect(page.locator("#box-old")).toContainText("420 × 297 mm");
  // ▶ goes to page 3 (297 × 210 mm).
  await page.locator('#box-old button[aria-label="Nächste Seite"]').click();
  await expect(page.locator("#box-old .pager")).toContainText("Seite 3 von 3");
  await expect(page.locator("#box-old")).toContainText("297 × 210 mm");
});

test("cancelling the page picker leaves the box empty", async ({ page }) => {
  await open(page);
  await drop(page, "body", [THREE]);
  await page.locator("#pages-cancel").click();
  await expect(page.locator("#box-old .file-name")).toHaveCount(0);
});

test("a single-page Document opens without the page picker", async ({ page }) => {
  await open(page);
  await drop(page, "body", [OLD]);
  await expect(name(page, "old")).toBeVisible();
  await expect(page.locator("#pages")).toBeHidden();
  await expect(page.locator("#box-old .pager")).toHaveCount(0);
});

test("Weiter leads to the workspace shell, which is not left again", async ({ page }) => {
  await open(page);
  await drop(page, "body", [OLD, NEW]);
  await expect(page.locator("#proceed")).toBeEnabled();
  await page.locator("#proceed").click();
  await expect(page.locator("#start")).toBeHidden();
  await expect(page.locator("#workspace")).toBeVisible();
  const tabs = page.locator(".tab");
  await expect(tabs).toHaveText(["Öffnen", "Alter Plan", "Neuer Plan", "Versatz", "Vergleich"]);
  await expect(page.locator("#tab-open")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#tab-compare")).toBeDisabled();
  await expect(page.locator("#card-old")).toContainText("down-old.pdf");
  await expect(page.locator("#card-new")).toContainText("down-new.pdf");
  // The Plan view runs the full height of the window.
  const view = (await page.locator("#viewer").boundingBox())!;
  expect(view.y).toBe(0);
  expect(Math.round(view.height)).toBe(900);
  await page.screenshot({ path: "test-results/workspace.png" });
  // Swap in the workspace.
  await page.locator("#swap-ws").click();
  await expect(page.locator("#card-old")).toContainText("down-new.pdf");
  // "Alter Plan" shows its placeholder.
  await page.locator("#tab-old").click();
  await expect(page.locator("#body-old")).toBeVisible();
  await expect(page.locator("#body-open")).toBeHidden();
  // "Über" opens the About window with its chapters.
  await page.locator("#about-open").click();
  await expect(page.locator("#about")).toBeVisible();
  await expect(page.locator("#about h3")).toHaveText(["Über das Projekt", "Wie geht's", "Tastenkürzel", "Lizenz & Dank"]);
});

test("both synthetic pairs open from file:// with no network", async ({ page }) => {
  const external: string[] = [];
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("file:") || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    external.push(url);
    return route.abort();
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  expect(page.url().startsWith("file:")).toBe(true);
  for (const [o, n] of [
    [OLD, NEW],
    [RIGHT_OLD, RIGHT_NEW],
  ] as const) {
    await page.reload();
    await expect(page.locator("body")).toHaveAttribute("data-ready", "1", { timeout: 60_000 });
    await drop(page, "body", [o, n]);
    await expect(page.locator("#proceed")).toBeEnabled({ timeout: 60_000 });
    await page.locator("#proceed").click();
    await expect(page.locator("#workspace")).toBeVisible();
    const dims = await page.evaluate(() => ["plan-old", "plan-new"].map((id) => (document.getElementById(id) as HTMLCanvasElement).width));
    expect(dims.every((w) => w > 10)).toBe(true);
  }
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("shows the busy window while opening when a job is slow", async ({ page }) => {
  await page.addInitScript(() => ((window as unknown as { __busyDelayMs: number }).__busyDelayMs = 0));
  await open(page);
  await drop(page, "body", [OLD]);
  await expect(page.locator("#busy")).toBeVisible();
  await expect(page.locator("#busy-text")).toContainText("Plan wird geöffnet");
  await expect(page.locator("#busy")).toBeHidden();
  await expect(name(page, "old")).toBeVisible();
});
