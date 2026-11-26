import { test, expect, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Setup Vorlagen in "Alter Plan": save, pick, "(geändert)", overwrite, rename, delete, export and
// import, on the synthetic pair.

const APP = pathToFileURL(resolve("dist/index.html")).href;
const SHOTS = process.env.SHOTS_DIR;
const OLD = resolve("samples/down-old.pdf");
const NEW = resolve("samples/down-new.pdf");

test.beforeAll(() => {
  if (!existsSync("dist/index.html")) throw new Error("run `npm run build` first");
  if (!existsSync(OLD)) throw new Error("run `npm run samples` first");
});

async function drop(page: Page, paths: string[]) {
  const files = paths.map((p) => ({ name: p.split(/[\\/]/).pop()!, b64: readFileSync(p).toString("base64") }));
  await page.evaluate((files) => {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: "application/pdf" }));
    for (const type of ["dragenter", "dragover", "drop"]) document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, files);
}

async function inOldTab(page: Page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(APP);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "1", { timeout: 60_000 });
  await drop(page, [OLD, NEW]);
  await expect(page.locator("#proceed")).toBeEnabled({ timeout: 60_000 });
  await page.locator("#proceed").click();
  await page.locator("#open-next").click();
  await expect(page.locator("#tab-old")).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
}

interface Inspected {
  header: number;
  footer: number;
  length: number;
  selected: number | undefined;
  zones: { id: number; kind: string; full: boolean; box: { x0: number; y0: number; x1: number; y1: number } }[];
}
type Role = "old" | "new";
const spc = <T>(page: Page, f: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([f, args]) => (window as any).__spc[f as string](...(args as unknown[])), [f, args] as const) as Promise<T>;
const inspect = (page: Page, role: Role = "old") => spc<Inspected>(page, "inspect", role);
const at = (page: Page, x: number, y: number) => spc<{ x: number; y: number }>(page, "toClient", x, y);
const shot = async (page: Page, name: string) => {
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, name) });
  }
};
async function focus(page: Page, y: number) {
  await page.keyboard.press("2");
  await spc(page, "centerOn", 594, y);
  await page.waitForTimeout(50);
}
async function dragMm(page: Page, from: [number, number], to: [number, number], opts: { alt?: boolean; steps?: number } = {}) {
  const a = await at(page, ...from);
  const b = await at(page, ...to);
  await page.mouse.move(a.x, a.y);
  if (opts.alt) await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: opts.steps ?? 8 });
  await page.mouse.up();
  if (opts.alt) await page.keyboard.up("Alt");
}


const P = "#setup-vorlage";
const shown = (page: Page) => page.locator(`${P}-select option:checked`);
const rowNames = (page: Page) => page.locator(`${P}-list li .name`).allTextContents();
async function openWindow(page: Page) {
  await page.locator(`${P}-edit`).click();
  await expect(page.locator(`${P}-dialog`)).toBeVisible();
}
async function saveAs(page: Page, name: string) {
  await page.locator(`${P}-name`).fill(name);
  await page.locator(`${P}-save`).click();
  await expect(page.locator(`${P}-msg`)).toContainText("gespeichert");
}
async function draw(page: Page, x: number) {
  const h = (await inspect(page)).header;
  await focus(page, h + 600);
  await dragMm(page, [x, h + 300], [x + 200, h + 700], { alt: true });
}
/** A Vorlagen file as an import: Header 30 mm, Footer 50 mm from the end, one Ausgenommen 10 mm after the Header line. */
const FILE = {
  kind: "simplepdfcompare-setup-vorlagen",
  version: 1,
  presets: [{ name: "Fest", setup: { header: 30, footerFromEnd: 50, zones: [{ kind: "area", full: false, a0: 10, a1: 60, t0: 10, t1: 200 }] } }],
};
async function importJson(page: Page, content: unknown, name = "import.json") {
  mkdirSync(resolve("test-results"), { recursive: true });
  const path = resolve("test-results", name);
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  await page.locator(`${P}-file`).setInputFiles(path);
}

test("Vorlage: shows –, saves, picks, marks (geändert), overwrites, renames, deletes", async ({ page }) => {
  await page.addInitScript(() => void delete (window as unknown as Record<string, unknown>).showSaveFilePicker);
  await inOldTab(page);
  await expect(shown(page)).toHaveText("–");
  await shot(page, "vorlage-dropdown.png");

  await draw(page, 100);
  await openWindow(page);
  await expect(page.locator(`${P}-empty`)).toBeVisible();
  await expect(page.locator(`${P}-export`)).toBeDisabled();
  await page.locator(`${P}-name`).fill("  ");
  await page.locator(`${P}-save`).click();
  await expect(page.locator(`${P}-msg`)).toContainText("Namen");
  await saveAs(page, "Strecke A");
  await shot(page, "vorlage-window.png");
  expect(await rowNames(page)).toEqual(["Strecke A"]);
  // The same name again is refused, ignoring case.
  await page.locator(`${P}-name`).fill("strecke a");
  await page.locator(`${P}-save`).click();
  await expect(page.locator(`${P}-msg`)).toContainText("schon");
  await page.locator(`${P}-close`).click();
  await expect(shown(page)).toHaveText("Strecke A");

  // A change by hand marks it; picking it again restores it.
  const saved = await inspect(page);
  await draw(page, 500);
  expect((await inspect(page)).zones).toHaveLength(2);
  await expect(shown(page)).toHaveText("Strecke A (geändert)");
  await page.locator(`${P}-select`).selectOption("Strecke A");
  await expect(shown(page)).toHaveText("Strecke A");
  const back = await inspect(page);
  expect(back.zones).toHaveLength(1);
  for (const k of ["x0", "y0", "x1", "y1"] as const) expect(back.zones[0]!.box[k]).toBeCloseTo(saved.zones[0]!.box[k], 3);

  // Overwrite with the changed setup.
  await draw(page, 500);
  await openWindow(page);
  await page.locator(`${P}-overwrite`).click();
  await expect(page.locator(`${P}-msg`)).toContainText("überschrieben");
  await page.locator(`${P}-close`).click();
  await expect(shown(page)).toHaveText("Strecke A");

  // Rename inline, then delete after asking.
  await openWindow(page);
  await page.locator(`${P}-list li >> text=Umbenennen`).click();
  await page.locator(`${P}-list input.name`).fill("Strecke B");
  await page.locator(`${P}-list input.name`).press("Enter");
  expect(await rowNames(page)).toEqual(["Strecke B"]);
  page.once("dialog", (d) => void d.accept());
  await page.locator(`${P}-list li >> text=Löschen`).click();
  await expect(page.locator(`${P}-empty`)).toBeVisible();
  await page.locator(`${P}-close`).click();
  await expect(shown(page)).toHaveText("–");
});

test("Vorlage: export, import with a numbered name for a clash, and files that are refused", async ({ page }) => {
  await page.addInitScript(() => void delete (window as unknown as Record<string, unknown>).showSaveFilePicker);
  await inOldTab(page);
  await draw(page, 100);
  await openWindow(page);
  await saveAs(page, "Strecke A");
  const download = page.waitForEvent("download");
  await page.locator(`${P}-export`).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("simplepdfcompare-Vorlagen.json");
  const exported = resolve("test-results/vorlagen-export.json");
  mkdirSync(resolve("test-results"), { recursive: true });
  writeFileSync(exported, readFileSync((await file.path())!));
  const data = JSON.parse(readFileSync(exported, "utf8"));
  expect(data.kind).toBe("simplepdfcompare-setup-vorlagen");
  expect(data.presets).toHaveLength(1);
  expect(JSON.stringify(data)).not.toMatch(/offset|direction|axis/i);

  await page.locator(`${P}-file`).setInputFiles(exported);
  await expect(page.locator(`${P}-msg`)).toContainText("importiert");
  expect(await rowNames(page)).toEqual(["Strecke A", "Strecke A (2)"]);

  await importJson(page, "this is not json", "bad.json");
  await expect(page.locator(`${P}-msg`)).toContainText("kein gültiges JSON");
  await importJson(page, { kind: "simplepdfclipper-presets", version: 1, presets: [] }, "other.json");
  await expect(page.locator(`${P}-msg`)).toContainText("keine Vorlagen-Datei");
  await importJson(page, { ...FILE, presets: [{ name: "kaputt", setup: { header: "x" } }] }, "empty.json");
  await expect(page.locator(`${P}-msg`)).toContainText("keine");
  expect(await rowNames(page)).toEqual(["Strecke A", "Strecke A (2)"]);
});

test("Vorlage: a pick keeps the mm distances from the Header line and never touches the Time direction", async ({ page }) => {
  await inOldTab(page);
  const before = await inspect(page);
  await openWindow(page);
  await importJson(page, FILE);
  await expect(page.locator(`${P}-msg`)).toContainText("importiert");
  await page.locator(`${P}-close`).click();
  await expect(shown(page)).toHaveText("–");

  await page.locator(`${P}-select`).selectOption("Fest");
  const after = await inspect(page);
  expect(after.header).toBeCloseTo(30, 3);
  expect(after.footer).toBeCloseTo(after.length - 50, 3);
  expect(after.zones).toHaveLength(1);
  expect(after.zones[0]!.box.y0).toBeCloseTo(40, 3); // 30 mm Header + 10 mm
  expect(after.zones[0]!.box.y1).toBeCloseTo(230, 3);
  expect(after.zones[0]!.box.x0).toBeCloseTo(10, 3);
  expect(after.zones[0]!.box.x1).toBeCloseTo(60, 3);
  expect(before.header).not.toBeCloseTo(30, 0);
  await expect(shown(page)).toHaveText("Fest");

  // The Time direction is untouched, and the setup of the other direction is a separate one.
  await page.locator("#tab-open").click();
  await expect(page.locator('#direction-switch button[aria-checked="true"]')).toHaveText("senkrecht");
  await page.locator('#direction-switch button[data-value="right"]').click();
  await page.locator("#open-next").click();
  await expect(page.locator("#tab-old")).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
  await expect(shown(page)).toHaveText("–"); // nothing picked in this direction yet
  const right = await inspect(page);
  expect(right.zones).toHaveLength(0);
  await page.locator(`${P}-select`).selectOption("Fest");
  const rightAfter = await inspect(page);
  expect(rightAfter.header).toBeCloseTo(30, 3);
  expect(rightAfter.zones[0]!.box.x0).toBeCloseTo(40, 3); // time runs to the right: along is x
  expect(rightAfter.zones[0]!.box.y0).toBeCloseTo(10, 3);
  await page.locator("#tab-open").click();
  await expect(page.locator('#direction-switch button[aria-checked="true"]')).toHaveText("waagerecht");

  // Back: the first direction kept what it had.
  await page.locator('#direction-switch button[data-value="down"]').click();
  await page.locator("#open-next").click();
  await expect(page.locator("#tab-old")).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
  await expect(shown(page)).toHaveText("Fest");
  expect((await inspect(page)).header).toBeCloseTo(30, 3);
});
