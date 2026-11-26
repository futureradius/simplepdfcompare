import { test, expect, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { makeMultiPageDocument } from "../src/testing/multipage";

const APP = pathToFileURL(resolve("dist/index.html")).href;
const OUT = resolve("test-results/fixtures");
const SHOTS = process.env.SHOTS_DIR;
const OLD = resolve("samples/down-old.pdf");
const NEW = resolve("samples/down-new.pdf");
const RIGHT_OLD = resolve("samples/right-old.pdf");
const RIGHT_NEW = resolve("samples/right-new.pdf");
let THREE: string;

test.beforeAll(() => {
  if (!existsSync("dist/index.html")) throw new Error("run `npm run build` first");
  if (!existsSync(OLD)) throw new Error("run `npm run samples` first");
  mkdirSync(OUT, { recursive: true });
  THREE = join(OUT, "drei-seiten.pdf");
  writeFileSync(THREE, makeMultiPageDocument());
});

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

/** Opens the app, drops a pair and passes the start page, so "Öffnen" is showing. */
async function inOpenTab(page: Page, pair: [string, string] = [OLD, NEW]) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(APP);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "1", { timeout: 60_000 });
  await drop(page, "body", pair);
  await expect(page.locator("#proceed")).toBeEnabled({ timeout: 60_000 });
  await page.locator("#proceed").click();
  await expect(page.locator("#workspace")).toBeVisible();
}

const enabled = async (page: Page) => page.locator(".tab").evaluateAll((tabs) => tabs.map((t) => !(t as HTMLButtonElement).disabled));
const arrow = async (page: Page, role: "old" | "new", which: "a" | "b") => (await page.locator(`#sheet-${role} .tarrow.${which}`).boundingBox())!;
const sheet = async (page: Page, role: "old" | "new") => (await page.locator(`#sheet-${role}`).boundingBox())!;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, name) });
};

test("tabs: later ones stay greyed out until Weiter confirms Öffnen; going back locks nothing", async ({ page }) => {
  await inOpenTab(page);
  expect(await enabled(page)).toEqual([true, false, false, false, false]);
  await page.locator("#open-next").click();
  await expect(page.locator("#tab-old")).toHaveAttribute("aria-selected", "true");
  expect(await enabled(page)).toEqual([true, true, false, false, false]);
  // Visiting "Öffnen" again without a change locks nothing.
  await page.locator("#tab-open").click();
  await expect(page.locator("#body-open")).toBeVisible();
  expect(await enabled(page)).toEqual([true, true, false, false, false]);
});

test("Time direction: preselected from the Old Plan's page shape", async ({ page }) => {
  await inOpenTab(page);
  await expect(page.locator('#direction-switch button[aria-checked="true"]')).toHaveText("senkrecht");
  await expect(page.locator("#plans")).toHaveAttribute("data-dir", "down");
  await page.goto(APP);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "1", { timeout: 60_000 });
  await drop(page, "body", [RIGHT_OLD, RIGHT_NEW]);
  await expect(page.locator("#proceed")).toBeEnabled({ timeout: 60_000 });
  await page.locator("#proceed").click();
  await expect(page.locator('#direction-switch button[aria-checked="true"]')).toHaveText("waagerecht");
  await expect(page.locator("#plans")).toHaveAttribute("data-dir", "right");
});

test("Time direction: the switch slides its highlight and the arrows move beside and above the Plans", async ({ page }) => {
  await inOpenTab(page);
  const down = page.locator('#direction-switch button[data-dir="down"]');
  const right = page.locator('#direction-switch button[data-dir="right"]');
  // Down: arrows on the left and right of each Plan, vertically centred.
  for (const role of ["old", "new"] as const) {
    const s = await sheet(page, role);
    const a = await arrow(page, role, "a");
    const b = await arrow(page, role, "b");
    expect(a.x + a.width).toBeLessThanOrEqual(s.x + 1);
    expect(b.x).toBeGreaterThanOrEqual(s.x + s.width - 1);
    expect(a.height).toBeGreaterThan(a.width);
  }
  const hlBefore = (await page.locator("#direction-switch .hl").boundingBox())!;
  const planBefore = await sheet(page, "old");
  await shot(page, "open-down.png");
  await right.click();
  await expect(right).toHaveAttribute("aria-checked", "true");
  await expect(down).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#plans")).toHaveAttribute("data-dir", "right");
  // Let the slide finish; then arrows sit above and below, pointing right (wider than tall).
  await page.waitForTimeout(700);
  for (const role of ["old", "new"] as const) {
    const s = await sheet(page, role);
    const a = await arrow(page, role, "a");
    const b = await arrow(page, role, "b");
    expect(a.y + a.height).toBeLessThanOrEqual(s.y + 1);
    expect(b.y).toBeGreaterThanOrEqual(s.y + s.height - 1);
    expect(a.width).toBeGreaterThan(a.height);
  }
  const hlAfter = (await page.locator("#direction-switch .hl").boundingBox())!;
  expect(hlAfter.x).toBeGreaterThan(hlBefore.x + hlBefore.width / 2);
  // Nothing jumped: the Plan kept its place and size.
  const planAfter = await sheet(page, "old");
  expect(Math.abs(planAfter.x - planBefore.x)).toBeLessThan(1);
  expect(Math.abs(planAfter.width - planBefore.width)).toBeLessThan(1);
  await shot(page, "open-right.png");
});

test("Time direction: with reduced motion the arrows fade instead of sliding", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await inOpenTab(page);
  await page.locator('#direction-switch button[data-dir="right"]').click();
  // Mid-switch the arrows are faded out and have not moved yet.
  await expect(page.locator("#plans")).toHaveClass(/fading/);
  expect(await page.locator("#sheet-old .tarrow.a").evaluate((e) => getComputedStyle(e).transitionProperty)).toBe("opacity");
  await expect(page.locator("#plans")).toHaveAttribute("data-dir", "right");
  await expect(page.locator("#plans")).not.toHaveClass(/fading/);
  await page.waitForTimeout(300);
  expect(await page.locator("#sheet-old .tarrow.a").evaluate((e) => getComputedStyle(e).opacity)).not.toBe("0");
  const s = await sheet(page, "old");
  const a = await arrow(page, "old", "a");
  expect(a.y + a.height).toBeLessThanOrEqual(s.y + 1);
});

test("swap: the view has the only swap button, between the Plans, and it exchanges the order and locks the later tabs", async ({ page }) => {
  await inOpenTab(page);
  await expect(page.locator("#panel button", { hasText: "⇄" })).toHaveCount(0);
  await expect(page.locator("#panel [aria-label='Alt und Neu tauschen']")).toHaveCount(0);
  await page.locator("#open-next").click();
  await page.locator("#tab-open").click();
  expect(await enabled(page)).toEqual([true, true, false, false, false]);
  const swap = (await page.locator("#swap-view").boundingBox())!;
  const o = await sheet(page, "old");
  const n = await sheet(page, "new");
  expect(swap.x).toBeGreaterThan(o.x + o.width);
  expect(swap.x + swap.width).toBeLessThan(n.x);
  await page.locator("#swap-view").click();
  await expect(page.locator("#card-old .file-name")).toHaveText("down-new.pdf");
  await expect(page.locator("#card-new .file-name")).toHaveText("down-old.pdf");
  expect(await enabled(page)).toEqual([true, false, false, false, false]);
});

test("changing the direction, a file or a page locks the later tabs again", async ({ page }) => {
  await inOpenTab(page);
  const confirm = async () => {
    await page.locator("#open-next").click();
    await page.locator("#tab-open").click();
    expect(await enabled(page)).toEqual([true, true, false, false, false]);
  };
  await confirm();
  await page.locator('#direction-switch button[data-dir="right"]').click();
  expect(await enabled(page)).toEqual([true, false, false, false, false]);
  await confirm();
  // Dropping a PDF on a file card replaces that file.
  await drop(page, "#card-new", [RIGHT_NEW]);
  await expect(page.locator("#card-new .file-name")).toHaveText("right-new.pdf");
  expect(await enabled(page)).toEqual([true, false, false, false, false]);
  await confirm();
  // Picking the same file again changes nothing... but another page of a Document does.
  await drop(page, "#card-old", [THREE]);
  await page.locator("#pages-grid .thumb").first().click();
  await expect(page.locator("#card-old .pager")).toContainText("Seite 1 von 3");
  expect(await enabled(page)).toEqual([true, false, false, false, false]);
  await confirm();
  await page.locator('#card-old button[aria-label="Nächste Seite"]').click();
  await expect(page.locator("#card-old .pager")).toContainText("Seite 2 von 3");
  expect(await enabled(page)).toEqual([true, false, false, false, false]);
});

test("sidebar width: 400 px by default and minimum, draggable to two thirds, double-click resets", async ({ page }) => {
  await inOpenTab(page);
  const width = async () => Math.round((await page.locator("#panel").boundingBox())!.width);
  expect(await width()).toBe(400);
  const handle = (await page.locator("#panel-resize").boundingBox())!;
  const y = handle.y + handle.height / 2;
  const x = handle.x + handle.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 200, y, { steps: 5 });
  await page.mouse.up();
  expect(await width()).toBe(600);
  // Not below the minimum.
  const h2 = (await page.locator("#panel-resize").boundingBox())!;
  await page.mouse.move(h2.x + 4, y);
  await page.mouse.down();
  await page.mouse.move(100, y, { steps: 5 });
  await page.mouse.up();
  expect(await width()).toBe(400);
  // Not past two thirds of the window (1400 px).
  const h3 = (await page.locator("#panel-resize").boundingBox())!;
  await page.mouse.move(h3.x + 4, y);
  await page.mouse.down();
  await page.mouse.move(1390, y, { steps: 5 });
  await page.mouse.up();
  expect(await width()).toBe(933);
  await page.locator("#panel-resize").dblclick();
  expect(await width()).toBe(400);
  // Remembered across a reload.
  await page.keyboard.press("Tab");
  await page.locator("#panel-resize").focus();
  await page.keyboard.press("ArrowRight");
  const w = await width();
  expect(w).toBe(416);
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-ready", "1", { timeout: 60_000 });
  await drop(page, "body", [OLD, NEW]);
  await expect(page.locator("#proceed")).toBeEnabled({ timeout: 60_000 });
  await page.locator("#proceed").click();
  expect(await width()).toBe(416);
});

test("Öffnen view: both Plans whole side by side, no minimap, the sidebar lists both files", async ({ page }) => {
  await inOpenTab(page);
  await expect(page.locator("#card-old")).toContainText("down-old.pdf");
  await expect(page.locator("#card-old")).toContainText("Andere Datei…");
  await expect(page.locator("#card-new")).toContainText("down-new.pdf");
  const o = await sheet(page, "old");
  const n = await sheet(page, "new");
  expect(o.x + o.width).toBeLessThan(n.x);
  expect(Math.abs(o.width - n.width)).toBeLessThan(2);
  const view = (await page.locator("#viewer").boundingBox())!;
  expect(o.y).toBeGreaterThanOrEqual(view.y);
  expect(o.y + o.height).toBeLessThanOrEqual(view.y + view.height);
  await shot(page, "open-tab.png");
});
