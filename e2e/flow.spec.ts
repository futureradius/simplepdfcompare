// The whole flow of v1 on the synthetic "activities" pair, the way a user goes through it, from
// the built single file on file:// with the network cut off (ADR 0001 offline, ADR 0009 tabs):
// open both Plans, set the Time direction, mark a zone, confirm the Offset, compare, filter,
// hide, export. Every request that is not file:, data: or blob: is aborted and recorded; none
// may happen. The exported file is caught as a download and must hold every Place.
import { test, expect, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { unzipStored } from "../src/testing/unzip";

const APP = pathToFileURL(resolve("dist/index.html")).href;
const OLD = resolve("samples/activities-old.pdf");
const NEW = resolve("samples/activities-new.pdf");

interface Truth {
  timeDirection: "down" | "right";
  offsetMm: number;
  old: { headerMm: [number, number]; footerMm: [number, number]; axisZonesMm: { time: { x0: number; y0: number; x1: number; y1: number }[] } };
  changes: { place: { name: string | null; labelPlace?: { name: string | null } } }[];
}
const truth = (): Truth => JSON.parse(readFileSync("samples/ground-truth.json", "utf8")).pairs.find((p: { name: string }) => p.name === "activities");

test.beforeAll(() => {
  if (!existsSync("dist/index.html")) throw new Error("run `npm run build` first");
  if (!existsSync(OLD)) throw new Error("run `npm run samples` first");
});

const spc = <T>(page: Page, f: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([f, args]) => (window as any).__spc[f as string](...(args as unknown[])), [f, args] as const) as Promise<T>;
const sheetRows = (xml: string) => [...xml.matchAll(/<row r="(\d+)">(.*?)<\/row>/g)].map((m) => m[2]!);
const texts = (row: string) => [...row.matchAll(/<t[^>]*>(.*?)<\/t>/g)].map((m) => m[1]!.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"'));
const rows = (page: Page) => page.locator("#body-compare .pl-row:not(.is-hidden)");

test("the whole flow from file:// with no network: open, direction, zones, Offset, compare, filter, hide, export", async ({ page, context }) => {
  const gt = truth();
  // ---- No network: the browser is offline, anything not on this machine is aborted, and every
  // request that tries to leave is recorded.
  await context.setOffline(true);
  const external: string[] = [];
  const local = (url: string) => url.startsWith("file:") || url.startsWith("data:") || url.startsWith("blob:");
  await context.route("**/*", (route) => (local(route.request().url()) ? route.continue() : route.abort("internetdisconnected")));
  context.on("request", (r) => {
    if (!local(r.url())) external.push(r.url());
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // The download path of "Exportieren" (Edge would otherwise show its own "Save as" window).
  await page.addInitScript(() => void delete (window as unknown as Record<string, unknown>).showSaveFilePicker);

  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto(APP);
  expect(page.url().startsWith("file:")).toBe(true);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "1", { timeout: 60_000 });

  // ---- Start page: both boxes clicked, each file chosen in the browser's file window.
  for (const [role, file] of [["old", OLD], ["new", NEW]] as const) {
    const chooser = page.waitForEvent("filechooser");
    await page.locator(`#box-${role}`).click();
    await (await chooser).setFiles(file);
    await expect(page.locator(`#box-${role} .file-name`)).toHaveText(file.split(/[\\/]/).pop()!, { timeout: 60_000 });
  }
  await page.locator("#proceed").click();

  // ---- Öffnen: the Time direction, preselected from the tall page, switched away and back.
  const dir = (v: string) => page.locator(`#direction-switch button[data-value="${v}"]`);
  await expect(dir("down")).toHaveAttribute("aria-checked", "true");
  await dir("right").click();
  await expect(dir("right")).toHaveAttribute("aria-checked", "true");
  await dir("down").click();
  await expect(dir("down")).toHaveAttribute("aria-checked", "true");
  expect(gt.timeDirection).toBe("down");
  await page.locator("#open-next").click();

  // ---- Alter Plan: Kopf and Fuß found where the generator drew them; a Zeitachse drawn over the dates.
  await expect(page.locator("#tab-old")).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
  await expect.poll(async () => (await spc<{ header: number }>(page, "inspect", "old")).header, { timeout: 30_000 }).toBeGreaterThan(0);
  const old = await spc<{ header: number; footer: number }>(page, "inspect", "old");
  expect(old.header).toBeCloseTo(gt.old.headerMm[1], 0);
  expect(old.footer).toBeCloseTo(gt.old.footerMm[0], 0);
  await page.locator('#body-old .kind-chips button[data-kind="time"]').click();
  await page.keyboard.press("1");
  const t = gt.old.axisZonesMm.time[0]!;
  const a = await spc<{ x: number; y: number }>(page, "toClient", t.x0 + 1, old.header + 40);
  const b = await spc<{ x: number; y: number }>(page, "toClient", t.x1 - 1, old.footer - 40);
  await page.mouse.move(a.x, a.y);
  await page.keyboard.down("Alt"); // freely, without Snap
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(page.locator("#body-old [data-zone]")).toHaveCount(1);
  await expect(page.locator("#body-old [data-zone]").first()).toContainText("Zeitachse 1");
  await page.locator('#body-old [data-action="next"]').click();

  // ---- Neuer Plan: the zone is copied over.
  await expect(page.locator("#tab-new")).toHaveAttribute("aria-selected", "true");
  expect((await spc<{ zones: { kind: string }[] }>(page, "inspect", "new")).zones.map((z) => z.kind)).toEqual(["time"]);
  await page.locator('#body-new [data-action="next"]').click();

  // ---- Versatz: the Offset found is the planted one; nudged by a key and back, then compared.
  await expect(page.locator("#tab-offset")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#offset-status")).toHaveAttribute("data-state", "done", { timeout: 60_000 });
  const offset = async () => Number(await page.locator("#offset-value").getAttribute("data-offset"));
  expect(await offset()).toBeCloseTo(gt.offsetMm, 1);
  await page.locator("#zone-canvas").hover();
  await page.keyboard.press("ArrowDown");
  expect(await offset()).toBeCloseTo(gt.offsetMm + 0.1, 2);
  await page.keyboard.press("ArrowUp");
  expect(await offset()).toBeCloseTo(gt.offsetMm, 2);
  await page.locator("#offset-compare").click();

  // ---- Vergleich: one Place per planted change (and one per label set apart), with their names.
  await expect(page.locator("#tab-compare")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#compare-view")).toHaveAttribute("data-state", "done", { timeout: 90_000 });
  const expected = gt.changes.flatMap((c) => [c.place, ...(c.place.labelPlace ? [c.place.labelPlace] : [])]);
  const places = (await page.evaluate(() => (window as any).__places.state.places.map((p: any) => ({ no: p.no, name: p.name, kinds: p.kinds })))) as { no: number; name: string | null; kinds: string[] }[];
  expect(places.length).toBe(expected.length);
  for (const e of expected) if (e.name) expect(places.map((p) => p.name)).toContain(e.name);
  await expect(page.locator(".pl-count")).toHaveText(`${places.length} Stellen mit Unterschieden`);
  await expect(rows(page)).toHaveCount(places.length);

  // ---- Filter: "Neu" unchecked in the filter list; the Places that are only new leave the list.
  await page.locator(".filter-btn").click();
  await page.locator('.filter-panel input[data-kind="new"]').uncheck();
  await page.keyboard.press("Escape");
  await expect(page.locator(".filter-panel")).toBeHidden();
  const onlyNew = places.filter((p) => p.kinds.every((k) => k === "new")).length;
  expect(onlyNew).toBeGreaterThan(0);
  await expect(rows(page)).toHaveCount(places.length - onlyNew);

  // ---- Hide: the first listed Place, by a click and H.
  const first = rows(page).first();
  const hiddenNo = Number(await first.getAttribute("data-no"));
  await first.click();
  await page.keyboard.press("h");
  await expect(page.locator("#body-compare [data-part=hidden]")).toContainText("1");
  await expect(rows(page)).toHaveCount(places.length - onlyNew - 1);

  // ---- Exportieren: every Place, whatever the filter, the hidden one marked.
  const download = page.waitForEvent("download");
  await page.locator("#cmp-export").click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Änderungen activities-old → activities-new.xlsx");
  const parts = unzipStored(new Uint8Array(readFileSync((await file.path())!)));
  const [head, ...body] = sheetRows(parts.get("xl/worksheets/sheet1.xml")!);
  expect(texts(head!)).toEqual(["Nr", "Was", "vorher", "Art", "Um (Tage)", "Von", "Bis", "km von", "km bis", "x (mm)", "y (mm)", "Ausgeblendet"]);
  expect(body.length).toBe(places.length);
  // Nr is a number in column A.
  const nos = body.map((r) => Number(/<c r="A\d+"[^>]*><v>(\d+)<\/v>/.exec(r)?.[1]));
  expect([...nos].sort((x, y) => x - y)).toEqual(places.map((p) => p.no).sort((x, y) => x - y));
  for (const e of expected) if (e.name) expect(body.some((r) => texts(r).includes(e.name!))).toBe(true);
  const marked = body.flatMap((r, i) => (texts(r).includes("ja") ? [nos[i]] : []));
  expect(marked).toEqual([hiddenNo]);
  const info = sheetRows(parts.get("xl/worksheets/sheet2.xml")!).map(texts);
  expect(info.find((r) => r[0] === "Zeitrichtung")).toEqual(["Zeitrichtung", "senkrecht"]);

  // ---- Nothing left this machine, and nothing broke.
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
