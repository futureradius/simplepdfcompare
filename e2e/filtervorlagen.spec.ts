// Filter Vorlagen in "Vergleich" (ADR 0009): "Alle" built in, save, pick, "(geändert)", overwrite,
// rename, delete, export and import; a Vorlage holds the checked kinds only, never Wann or Wo, and
// applying one moves neither the Plan nor the list. On the synthetic "activities" pair.
import { test, expect, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const APP = pathToFileURL(resolve("dist/index.html")).href;
const SHOTS = process.env.SHOTS_DIR;
const KINDS_N = 12;
const PAIR = [resolve("samples/activities-old.pdf"), resolve("samples/activities-new.pdf")];
const TIMING = ["later", "earlier", "longer", "shorter"];

test.beforeAll(() => {
  if (!existsSync("dist/index.html")) throw new Error("run `npm run build` first");
  if (!existsSync(PAIR[0]!)) throw new Error("run `npm run samples` first");
});

async function compared(page: Page, viewport = { width: 1500, height: 900 }) {
  await page.addInitScript(() => void delete (window as unknown as Record<string, unknown>).showSaveFilePicker);
  await page.setViewportSize(viewport);
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

const P = "#filter-vorlage";
const shown = (page: Page) => page.locator(`${P}-select option:checked`);
const options = (page: Page) => page.locator(`${P}-select option`).allTextContents();
const rowNames = (page: Page) => page.locator(`${P}-list li .name`).allTextContents();
const checked = (page: Page) => page.evaluate(() => (window as any).__places.state.filter.off as string[]);
const filter = (page: Page) => page.evaluate(() => (window as any).__places.state.filter as { off: string[]; when: unknown; where: unknown });
const rows = (page: Page) => page.locator("#body-compare .pl-row");
const shot = async (page: Page, name: string) => {
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, name) });
  }
};
async function openWindow(page: Page) {
  await page.locator(`${P}-edit`).click();
  await expect(page.locator(`${P}-dialog`)).toBeVisible();
}
async function saveAs(page: Page, name: string) {
  await page.locator(`${P}-name`).fill(name);
  await page.locator(`${P}-save`).click();
  await expect(page.locator(`${P}-msg`)).toContainText("gespeichert");
}
/** Checks exactly these kinds in the filter list, then closes it. */
async function checkOnly(page: Page, kinds: string[]) {
  await page.locator(".filter-btn").click();
  const all = page.locator('.filter-panel input[data-kind="all"]');
  if (await all.isChecked()) await all.click();
  else {
    await all.click(); // some checked: to all, as in Excel
    await all.click(); // and to none
  }
  for (const k of kinds) await page.locator(`.filter-panel input[data-kind="${k}"]`).check();
  await page.keyboard.press("Escape");
  await expect(page.locator(".filter-panel")).toBeHidden();
}
async function importJson(page: Page, prefix: string, content: unknown, name: string) {
  mkdirSync(resolve("test-results"), { recursive: true });
  const path = resolve("test-results", name);
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  await page.locator(`${prefix}-file`).setInputFiles(path);
}

test("Filter-Vorlage: Alle built in, saves, picks, marks (geändert), overwrites, renames, deletes", async ({ page }) => {
  await compared(page);
  const n = await rows(page).count();
  // Beside the filter, with "Alle" picked and only "Alle" in the list.
  await expect(page.locator(`${P}-row + .filter-wrap`)).toHaveCount(1);
  await expect(shown(page)).toHaveText("Alle");
  expect(await options(page)).toEqual(["Alle"]);

  // A change by hand marks "Alle"; picking it again checks every kind.
  await checkOnly(page, TIMING);
  await expect(page.locator(".filter-btn")).toContainText(`4 von ${KINDS_N}`);
  await expect(shown(page)).toHaveText("Alle (geändert)");

  await openWindow(page);
  await expect(page.locator(`${P}-title`)).toHaveText("Filter-Vorlagen");
  await expect(page.locator(`${P}-empty`)).toBeVisible();
  await expect(page.locator(`${P}-export`)).toBeDisabled();
  // "Alle" can't be used as a name, nor the same name twice, ignoring case.
  await page.locator(`${P}-name`).fill("alle");
  await page.locator(`${P}-save`).click();
  await expect(page.locator(`${P}-msg`)).toContainText("fest eingebaut");
  await saveAs(page, "Nur Termine");
  await page.locator(`${P}-name`).fill("nur termine");
  await page.locator(`${P}-save`).click();
  await expect(page.locator(`${P}-msg`)).toContainText("schon");
  // "Alle" is not in the window's list: it can't be renamed or deleted.
  expect(await rowNames(page)).toEqual(["Nur Termine"]);
  await shot(page, "filter-vorlage-window.png");
  await page.locator(`${P}-close`).click();
  await expect(shown(page)).toHaveText("Nur Termine");
  expect(await options(page)).toEqual(["Alle", "Nur Termine"]);

  // "Alle" checks every kind; the Vorlage checks its kinds again.
  await page.locator(`${P}-select`).selectOption("Alle");
  expect(await checked(page)).toEqual([]);
  await expect(rows(page)).toHaveCount(n);
  await page.locator(`${P}-select`).selectOption("Nur Termine");
  expect((await checked(page)).sort()).toEqual(["gone", "labelMoved", "lineWidth", "movedAcross", "new", "other", "recoloured", "textChanged"].sort());
  await expect(page.locator(".filter-btn")).toContainText(`4 von ${KINDS_N}`);

  // One more kind by hand: "(geändert)"; overwrite takes it in.
  await checkOnly(page, [...TIMING, "new"]);
  await expect(shown(page)).toHaveText("Nur Termine (geändert)");
  await openWindow(page);
  await expect(page.locator(`${P}-overwrite`)).toBeEnabled();
  await page.locator(`${P}-overwrite`).click();
  await expect(page.locator(`${P}-msg`)).toContainText("überschrieben");
  await expect(page.locator(`${P}-overwrite`)).toBeDisabled();
  await page.locator(`${P}-close`).click();
  await expect(shown(page)).toHaveText("Nur Termine");

  // Nothing checked can't be saved.
  await checkOnly(page, []);
  await openWindow(page);
  await page.locator(`${P}-name`).fill("Leer");
  await page.locator(`${P}-save`).click();
  await expect(page.locator(`${P}-msg`)).toContainText("mindestens eine Art");
  await page.locator(`${P}-close`).click();

  // Rename inline, then delete after asking: back to "Alle (geändert)" while kinds are unchecked.
  await openWindow(page);
  await page.locator(`${P}-list li >> text=Umbenennen`).click();
  await page.locator(`${P}-list input.name`).fill("Termine");
  await page.locator(`${P}-list input.name`).press("Enter");
  expect(await rowNames(page)).toEqual(["Termine"]);
  page.once("dialog", (d) => void d.accept());
  await page.locator(`${P}-list li >> text=Löschen`).click();
  await expect(page.locator(`${P}-empty`)).toBeVisible();
  await page.locator(`${P}-close`).click();
  await expect(shown(page)).toHaveText("Alle (geändert)");
  expect(await options(page)).toEqual(["Alle (geändert)", "Alle"]);
});

test("Filter-Vorlage: holds the kinds only, keeps Wann and Wo, and moves neither the Plan nor the list", async ({ page }) => {
  await compared(page, { width: 1500, height: 700 });
  await checkOnly(page, ["new", "gone"]);
  await openWindow(page);
  await saveAs(page, "Neu und entfallen");
  await page.locator(`${P}-close`).click();

  // A Wo range does not mark the Vorlage changed, and picking another one keeps it.
  await page.locator('.col-cell[data-column="where"] .range-btn').click();
  const inputs = page.locator(".range-panel input");
  await inputs.nth(0).fill("10");
  await inputs.nth(1).fill("20");
  await page.locator(".range-panel .btn.primary").click();
  await expect(page.locator(".filter-btn")).toContainText("Wo 10 – 20");
  await expect(shown(page)).toHaveText("Neu und entfallen");
  await page.locator(`${P}-select`).selectOption("Alle");
  expect((await filter(page)).where).toEqual([10, 20]);
  await expect(page.locator(".filter-btn")).toContainText("Wo 10 – 20");
  await page.locator('.col-cell[data-column="where"] .range-btn').click();
  await page.locator(".range-panel .btn", { hasText: "Leeren" }).click();

  // Applying a Vorlage: the list keeps its scroll position, the Plan stays where it is.
  await page.evaluate(() => {
    const src = (window as any).__places.state.places[0];
    const many = Array.from({ length: 3000 }, (_, i) => ({ ...src, no: i + 1, marks: [], partKinds: [], kind: "new", kinds: i % 2 ? ["new"] : ["new", "gone"], name: `Vorgang ${i + 1}`, box: { x0: i, y0: i, x1: i + 5, y1: i + 5 } }));
    (window as any).__places.state.setResult(many, 777);
  });
  const scroller = page.locator("#body-compare .pl-scroll");
  await scroller.evaluate((e) => (e.scrollTop = 30_000));
  await expect.poll(() => rows(page).first().getAttribute("data-no")).not.toBe("1");
  const top = await scroller.evaluate((e) => e.scrollTop);
  const centre = await page.evaluate(() => (window as any).__spcCompare.inspect().centre);
  await page.locator(`${P}-select`).selectOption("Neu und entfallen");
  await expect(page.locator(".filter-btn")).toContainText(`2 von ${KINDS_N}`);
  expect(await scroller.evaluate((e) => e.scrollTop)).toBe(top);
  await page.locator(`${P}-select`).selectOption("Alle");
  expect(await scroller.evaluate((e) => e.scrollTop)).toBe(top);
  expect(await page.evaluate(() => (window as any).__spcCompare.inspect().centre)).toEqual(centre);
  await page.locator(`${P}-select`).selectOption("Neu und entfallen");
  await shot(page, "filter-vorlage-applied.png");
});

test("Filter-Vorlage: export, import with a numbered name for a clash, and setup files are refused (and the other way round)", async ({ page }) => {
  await compared(page);
  await checkOnly(page, TIMING);
  await openWindow(page);
  await saveAs(page, "Nur Termine");
  const download = page.waitForEvent("download");
  await page.locator(`${P}-export`).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("simplepdfcompare-Filter-Vorlagen.json");
  const exported = resolve("test-results/filter-vorlagen-export.json");
  mkdirSync(resolve("test-results"), { recursive: true });
  writeFileSync(exported, readFileSync((await file.path())!));
  const data = JSON.parse(readFileSync(exported, "utf8"));
  expect(data).toEqual({ kind: "simplepdfcompare-filter-vorlagen", version: 1, presets: [{ name: "Nur Termine", kinds: TIMING }] });

  await page.locator(`${P}-file`).setInputFiles(exported);
  await expect(page.locator(`${P}-msg`)).toContainText("importiert");
  expect(await rowNames(page)).toEqual(["Nur Termine", "Nur Termine (2)"]);
  await importJson(page, P, { kind: "simplepdfcompare-filter-vorlagen", version: 1, presets: [{ name: "Alle", kinds: ["new"] }] }, "filter-alle.json");
  await expect(page.locator(`${P}-msg`)).toContainText("„Alle (2)“");

  await importJson(page, P, "this is not json", "filter-bad.json");
  await expect(page.locator(`${P}-msg`)).toContainText("kein gültiges JSON");
  const setupFile = { kind: "simplepdfcompare-setup-vorlagen", version: 1, presets: [{ name: "Fest", setup: { header: 30, footerFromEnd: 50, zones: [] } }] };
  await importJson(page, P, setupFile, "setup-in-filter.json");
  await expect(page.locator(`${P}-msg`)).toContainText("keine Filter-Vorlagen-Datei");
  expect(await rowNames(page)).toEqual(["Alle (2)", "Nur Termine", "Nur Termine (2)"]);
  await page.locator(`${P}-close`).click();

  // The setup Vorlagen in "Alter Plan" refuse the filter file.
  await page.locator("#tab-old").click();
  await expect(page.locator("#tab-old")).toHaveAttribute("aria-selected", "true");
  await page.locator("#setup-vorlage-edit").click();
  await page.locator("#setup-vorlage-file").setInputFiles(exported);
  await expect(page.locator("#setup-vorlage-msg")).toContainText("keine Vorlagen-Datei");
  await expect(page.locator("#setup-vorlage-empty")).toBeVisible();
});
