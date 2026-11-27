// "Exportieren" in "Vergleich" (ADR 0007): every Place goes into the .xlsx whatever the list's
// filter, hidden ones marked "ja", with the Info sheet. Reached through the real flow on the
// synthetic "activities" pair; the file is caught as a download and read back.
import { test, expect, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { unzipStored } from "../src/testing/unzip";

const APP = pathToFileURL(resolve("dist/index.html")).href;
const PAIR = [resolve("samples/activities-old.pdf"), resolve("samples/activities-new.pdf")];
/** Set to keep the exported file and a picture of the sidebar (not committed). */
const KEEP = process.env.EXPORT_DIR;

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

const sheetRows = (xml: string) => [...xml.matchAll(/<row r="(\d+)">(.*?)<\/row>/g)].map((m) => m[2]!);
const texts = (row: string) => [...row.matchAll(/<t[^>]*>(.*?)<\/t>/g)].map((m) => m[1]!);

test("Exportieren saves every Place as .xlsx, whatever the filter, hidden ones marked", async ({ page }) => {
  await page.addInitScript(() => void delete (window as unknown as Record<string, unknown>).showSaveFilePicker);
  await compared(page);
  const all = await page.evaluate(() => (window as any).__places.state.places.length as number);

  // Hide the first Place in the list, and filter the list down to the new Places only.
  await page.locator("#body-compare .pl-row").first().click();
  await page.keyboard.press("h");
  await expect(page.locator("#body-compare [data-part=hidden]")).toContainText("1");
  await page.evaluate(() => {
    const s = (window as any).__places.state;
    s.setFilter({ ...s.filter, off: ["later", "earlier", "longer", "shorter", "movedAcross", "textChanged", "gone", "recoloured", "lineWidth", "labelMoved", "other"] });
  });

  const button = page.locator("#cmp-export");
  await expect(button).toHaveText("Exportieren");
  if (KEEP) {
    mkdirSync(KEEP, { recursive: true });
    await page.screenshot({ path: join(KEEP, "vergleich-exportieren.png") });
  }
  const download = page.waitForEvent("download");
  await button.click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Änderungen activities-old → activities-new.xlsx");
  const bytes = readFileSync((await file.path())!);
  if (KEEP) writeFileSync(join(KEEP, file.suggestedFilename()), bytes);

  const parts = unzipStored(new Uint8Array(bytes));
  expect([...parts.get("xl/workbook.xml")!.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])).toEqual(["Änderungen", "Info"]);
  const rows = sheetRows(parts.get("xl/worksheets/sheet1.xml")!);
  expect(texts(rows[0]!).slice(0, 3)).toEqual(["Nr", "Was", "vorher"]);
  expect(rows.length).toBe(all + 1); // every Place, not only the new ones the list shows
  expect(rows.filter((r) => texts(r).includes("ja")).length).toBe(1);

  const info = sheetRows(parts.get("xl/worksheets/sheet2.xml")!).map(texts);
  expect(info[0]).toEqual(["Alter Plan", "activities-old.pdf"]);
  expect(info[1]).toEqual(["Neuer Plan", "activities-new.pdf"]);
  expect(info.find((r) => r[0] === "Zeitrichtung")).toEqual(["Zeitrichtung", "senkrecht"]);
});
