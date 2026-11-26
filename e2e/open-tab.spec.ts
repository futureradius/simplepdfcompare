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
const arrow = async (page: Page, which: "a" | "b") => (await page.locator(`#sheet .tarrow.${which}`).boundingBox())!;
const sheet = async (page: Page) => (await page.locator("#sheet").boundingBox())!;
const box = async (page: Page, sel: string) => (await page.locator(sel).boundingBox())!;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, name) });
};
/** A hash of the picture on the canvas, to tell the Old from the New Plan. */
const pictureHash = (page: Page) =>
  page.locator("#plan").evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]!) | 0;
    return `${c.width}x${c.height}:${h}`;
  });

test("tabs: later ones stay greyed out until Weiter confirms Öffnen; going back locks nothing", async ({ page }) => {
  await inOpenTab(page);
  expect(await enabled(page)).toEqual([true, false, false, false, false]);
  await page.locator("#open-next").click();
  await expect(page.locator("#tab-old")).toHaveAttribute("aria-selected", "true");
  expect(await enabled(page)).toEqual([true, true, false, false, false]);
  await page.locator("#tab-open").click();
  await expect(page.locator("#body-open")).toBeVisible();
  expect(await enabled(page)).toEqual([true, true, false, false, false]);
});

test("Time direction: preselected from the Old Plan's page shape, and no hint line under the switch", async ({ page }) => {
  await inOpenTab(page);
  await expect(page.locator('#direction-switch button[aria-checked="true"]')).toHaveText("senkrecht");
  await expect(page.locator("#plans")).toHaveAttribute("data-dir", "down");
  await expect(page.locator(".hint")).toHaveCount(0);
  await page.goto(APP);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "1", { timeout: 60_000 });
  await drop(page, "body", [RIGHT_OLD, RIGHT_NEW]);
  await expect(page.locator("#proceed")).toBeEnabled({ timeout: 60_000 });
  await page.locator("#proceed").click();
  await expect(page.locator('#direction-switch button[aria-checked="true"]')).toHaveText("waagerecht");
  await expect(page.locator("#plans")).toHaveAttribute("data-dir", "right");
});

test("Time direction: the highlight slides and the one pair of arrows moves beside and above the Plan", async ({ page }) => {
  await inOpenTab(page);
  const right = page.locator('#direction-switch button[data-value="right"]');
  const s = await sheet(page);
  const a = await arrow(page, "a");
  const b = await arrow(page, "b");
  expect(a.x + a.width).toBeLessThanOrEqual(s.x + 1);
  expect(b.x).toBeGreaterThanOrEqual(s.x + s.width - 1);
  expect(a.height).toBeGreaterThan(a.width);
  const hlBefore = await box(page, "#direction-switch .hl");
  await shot(page, "open-senkrecht-alt.png");
  await right.click();
  await expect(right).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#plans")).toHaveAttribute("data-dir", "right");
  await page.waitForTimeout(700);
  const a2 = await arrow(page, "a");
  const b2 = await arrow(page, "b");
  expect(a2.y + a2.height).toBeLessThanOrEqual(s.y + 1);
  expect(b2.y).toBeGreaterThanOrEqual(s.y + s.height - 1);
  expect(a2.width).toBeGreaterThan(a2.height);
  const hlAfter = await box(page, "#direction-switch .hl");
  expect(hlAfter.x).toBeGreaterThan(hlBefore.x + hlBefore.width / 2);
  const s2 = await sheet(page);
  expect(Math.abs(s2.x - s.x)).toBeLessThan(1);
  expect(Math.abs(s2.width - s.width)).toBeLessThan(1);
  await page.locator('#shown-switch button[data-value="new"]').click();
  await shot(page, "open-waagerecht-neu.png");
});

test("arrows are thin: a 3 px line and a head under 20 px wide", async ({ page }) => {
  await inOpenTab(page);
  const info = await page.locator("#sheet .tarrow.a path").evaluate((p) => {
    const bb = (p as SVGGraphicsElement).getBBox();
    return { stroke: getComputedStyle(p).strokeWidth, bboxWidth: bb.width };
  });
  expect(info.stroke).toBe("3px");
  expect(info.bboxWidth).toBeLessThan(20);
});

test("Time direction: with reduced motion the arrows fade instead of sliding", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await inOpenTab(page);
  await page.locator('#direction-switch button[data-value="right"]').click();
  await expect(page.locator("#plans")).toHaveClass(/fading/);
  expect(await page.locator("#sheet .tarrow.a").evaluate((e) => getComputedStyle(e).transitionProperty)).toBe("opacity");
  await expect(page.locator("#plans")).toHaveAttribute("data-dir", "right");
  await expect(page.locator("#plans")).not.toHaveClass(/fading/);
  await page.waitForTimeout(300);
  expect(await page.locator("#sheet .tarrow.a").evaluate((e) => getComputedStyle(e).opacity)).not.toBe("0");
  const s = await sheet(page);
  const a = await arrow(page, "a");
  expect(a.y + a.height).toBeLessThanOrEqual(s.y + 1);
});

test("Alt | Neu: shows the other Plan, locks nothing, keeps the direction, and nothing jumps", async ({ page }) => {
  await inOpenTab(page);
  await page.locator('#direction-switch button[data-value="right"]').click();
  await page.locator("#open-next").click();
  await page.locator("#tab-open").click();
  expect(await enabled(page)).toEqual([true, true, false, false, false]);
  await expect(page.locator("#shown-switch button[aria-checked='true']")).toHaveText("Alt");
  await page.waitForTimeout(700); // let the arrows finish sliding
  const old = await pictureHash(page);
  const sw = await box(page, "#shown-switch");
  const a = await arrow(page, "a");
  await page.locator('#shown-switch button[data-value="new"]').click();
  await expect(page.locator("#shown-switch button[aria-checked='true']")).toHaveText("Neu");
  expect(await pictureHash(page)).not.toBe(old);
  expect(await enabled(page)).toEqual([true, true, false, false, false]);
  await expect(page.locator('#direction-switch button[aria-checked="true"]')).toHaveText("waagerecht");
  const sw2 = await box(page, "#shown-switch");
  const a2 = await arrow(page, "a");
  expect([sw2.x, sw2.y, sw2.width]).toEqual([sw.x, sw.y, sw.width]);
  // The arrows stay with the Plan; the two samples differ by 2 % in length, so allow a few px.
  expect(Math.abs(a2.x - a.x)).toBeLessThan(15);
  expect(Math.abs(a2.y - a.y)).toBeLessThan(1);
  await page.locator('#shown-switch button[data-value="old"]').click();
  expect(await pictureHash(page)).toBe(old);
});

test("the Alt | Neu switch sits alone top left; Über stays top right; the view has no swap button", async ({ page }) => {
  await inOpenTab(page);
  const sw = await box(page, "#shown-switch");
  const viewer = await box(page, "#viewer");
  expect(sw.x - viewer.x).toBeLessThan(30);
  expect(sw.y - viewer.y).toBeLessThan(30);
  const about = await box(page, "#about-open");
  expect(about.x).toBeGreaterThan(viewer.x + viewer.width - 120);
  await expect(page.locator("#viewer button", { hasText: "⇄" })).toHaveCount(0);
  await expect(page.locator("#viewer [aria-label='Alt und Neu tauschen']")).toHaveCount(0);
  // The one swap in the workspace is in the sidebar, between the two file cards.
  await expect(page.locator("#workspace [aria-label='Alt und Neu tauschen']")).toHaveCount(1);
  await expect(page.locator("#swap-open")).toHaveText("⇄ Alt/Neu tauschen");
  const old = await box(page, "#card-old");
  const sp = await box(page, "#swap-open");
  const nw = await box(page, "#card-new");
  expect(sp.y).toBeGreaterThanOrEqual(old.y + old.height);
  expect(sp.y + sp.height).toBeLessThanOrEqual(nw.y);
  // The other tabs hide the switch.
  await page.locator("#open-next").click();
  await expect(page.locator("#shown-switch")).toBeHidden();
  await expect(page.locator("#about-open")).toBeVisible();
});

test("swap from the sidebar button exchanges the files, locks the later tabs, and Alt shows the new Old Plan", async ({ page }) => {
  await inOpenTab(page);
  await page.locator("#open-next").click();
  await page.locator("#tab-open").click();
  expect(await enabled(page)).toEqual([true, true, false, false, false]);
  const before = await pictureHash(page);
  const sw = await box(page, "#shown-switch");
  const s1 = await sheet(page);
  const a1 = await arrow(page, "a");
  await page.waitForTimeout(700);
  await page.locator("#swap-open").click();
  await expect(page.locator("#card-old .file-name")).toHaveText("down-new.pdf");
  await expect(page.locator("#card-new .file-name")).toHaveText("down-old.pdf");
  expect(await enabled(page)).toEqual([true, false, false, false, false]);
  await expect(page.locator("#shown-switch button[aria-checked='true']")).toHaveText("Alt");
  // Nothing in the view moves, apart from the picture.
  const sw2 = await box(page, "#shown-switch");
  const s2 = await sheet(page);
  const a2 = await arrow(page, "a");
  expect([sw2.x, sw2.y, sw2.width]).toEqual([sw.x, sw.y, sw.width]);
  expect(Math.abs(s2.x - s1.x)).toBeLessThan(15);
  expect(Math.abs(s2.y - s1.y)).toBeLessThan(1);
  expect(Math.abs(a2.y - a1.y)).toBeLessThan(1);
  // "Alt" now shows what was the New Plan; "Neu" shows what Alt showed before.
  expect(await pictureHash(page)).not.toBe(before);
  await page.locator('#shown-switch button[data-value="new"]').click();
  expect(await pictureHash(page)).toBe(before);
});

test("changing the direction, a file or a page locks the later tabs again", async ({ page }) => {
  await inOpenTab(page);
  const confirm = async () => {
    await page.locator("#open-next").click();
    await page.locator("#tab-open").click();
    expect(await enabled(page)).toEqual([true, true, false, false, false]);
  };
  await confirm();
  await page.locator('#direction-switch button[data-value="right"]').click();
  expect(await enabled(page)).toEqual([true, false, false, false, false]);
  await confirm();
  await drop(page, "#card-new", [RIGHT_NEW]);
  await expect(page.locator("#card-new .file-name")).toHaveText("right-new.pdf");
  expect(await enabled(page)).toEqual([true, false, false, false, false]);
  await confirm();
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

test("Öffnen view: one Plan whole in the view, the sidebar lists both files", async ({ page }) => {
  await inOpenTab(page);
  await expect(page.locator("#card-old")).toContainText("down-old.pdf");
  await expect(page.locator("#card-old")).toContainText("Andere Datei…");
  await expect(page.locator("#card-new")).toContainText("down-new.pdf");
  await expect(page.locator("#plan")).toHaveCount(1);
  const s = await sheet(page);
  const view = await box(page, "#viewer");
  expect(s.y).toBeGreaterThanOrEqual(view.y);
  expect(s.y + s.height).toBeLessThanOrEqual(view.y + view.height);
  expect(s.x + s.width).toBeLessThanOrEqual(view.x + view.width);
  await shot(page, "open-tab.png");
});
