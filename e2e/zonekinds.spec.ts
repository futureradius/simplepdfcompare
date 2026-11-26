import { test, expect, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";

// Space no longer pans, a separate setup per Time direction, the kind dropdown and the numbering
// of zones (Ausgenommen, Zeitachse, Wegachse, Vorgänge), on the synthetic pair.

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
const rows = (page: Page) => page.locator("#body-old [data-zone]");
const names = (page: Page) => page.locator("#body-old [data-zone] .kind-btn span:first-child").allTextContents();

async function drawThree(page: Page) {
  const h = (await inspect(page)).header;
  await focus(page, h + 600);
  for (const x of [100, 450, 800]) await dragMm(page, [x, h + 300], [x + 200, h + 700], { alt: true });
  return h;
}

async function switchDirection(page: Page, dir: "down" | "right") {
  await page.locator("#tab-open").click();
  await page.locator(`#direction-switch button[data-value="${dir}"]`).click();
  await page.locator("#open-next").click();
  await expect(page.locator("#tab-old")).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
}

test("Space no longer pans: with Space held, a left drag still draws", async ({ page }) => {
  await inOldTab(page);
  const h = (await inspect(page)).header;
  await focus(page, h + 600);
  const before = await spc<{ x0: number; y0: number }>(page, "visible");
  await page.keyboard.down("Space");
  await dragMm(page, [200, h + 300], [500, h + 500], { alt: true });
  await page.keyboard.up("Space");
  const after = await spc<{ x0: number; y0: number }>(page, "visible");
  expect(after.x0).toBeCloseTo(before.x0, 3);
  expect(after.y0).toBeCloseTo(before.y0, 3);
  expect((await inspect(page)).zones).toHaveLength(1);
  await expect(page.locator("#body-old .zone-hint")).not.toContainText("Leertaste");
});

test("a separate setup per Time direction: switching away and back restores Old and New unchanged", async ({ page }) => {
  await inOldTab(page);
  const o = await inspect(page);
  await focus(page, o.header + 300);
  await dragMm(page, [100, o.header + 300], [400, o.header + 800], { alt: true });
  await dragMm(page, [594, o.header], [594, o.header + 40], { alt: true });
  const oldSet = await inspect(page);
  // The New Plan is edited by hand: its copied zone is deleted.
  await page.locator('#body-old [data-action="next"]').click();
  await page.locator("#body-new [data-zone] .x").click();
  const newSet = await inspect(page, "new");
  expect(newSet.zones).toHaveLength(0);

  // The other direction starts from the beginning: Kopf and Fuß found again, no zones.
  await switchDirection(page, "right");
  const right = await inspect(page);
  expect(right.zones).toHaveLength(0);
  expect(right.length).toBeCloseTo(1189, -1);
  await page.locator('#body-old [data-action="next"]').click();
  expect((await inspect(page, "new")).zones).toHaveLength(0);

  // Back: Old zones, New zones and the "edited by hand" state as they were.
  await switchDirection(page, "down");
  const again = await inspect(page);
  expect(again.header).toBeCloseTo(oldSet.header, 2);
  expect(again.footer).toBeCloseTo(oldSet.footer, 2);
  expect(again.zones).toHaveLength(1);
  expect(again.zones[0]!.box).toEqual(oldSet.zones[0]!.box);
  await page.locator('#body-old [data-action="next"]').click();
  const newAgain = await inspect(page, "new");
  expect(newAgain.zones).toHaveLength(0); // still edited by hand: not copied again
  expect(newAgain.header).toBeCloseTo(newSet.header, 2);
});

test("the remembered setup is kept per direction", async ({ page }) => {
  await inOldTab(page);
  const o = await inspect(page);
  await focus(page, o.header + 300);
  await dragMm(page, [100, o.header + 300], [400, o.header + 800], { alt: true });
  await switchDirection(page, "right"); // waagerecht: its own setup, with no zone
  expect((await inspect(page)).zones).toHaveLength(0);
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-ready", "1", { timeout: 60_000 });
  await drop(page, [OLD, NEW]);
  await expect(page.locator("#proceed")).toBeEnabled({ timeout: 60_000 });
  await page.locator("#proceed").click();
  await page.locator("#open-next").click();
  await expect(page.locator("#tab-old")).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
  expect((await inspect(page)).zones).toHaveLength(1); // senkrecht gets the senkrecht setup
  await switchDirection(page, "right");
  expect((await inspect(page)).zones).toHaveLength(0); // waagerecht the waagerecht one
});

test("numbering runs 1..n per kind with no gaps after a delete or a kind change; tag and row use one name", async ({ page }) => {
  await inOldTab(page);
  await drawThree(page);
  expect(await names(page)).toEqual(["Ausgenommen 1", "Ausgenommen 2", "Ausgenommen 3"]);
  await rows(page).first().locator(".x").click();
  expect(await names(page)).toEqual(["Ausgenommen 1", "Ausgenommen 2"]);
  // The first one's kind changes: it leaves the numbering of Ausgenommen, both kinds renumber.
  await rows(page).first().locator(".kind-btn").click();
  await rows(page).first().locator('.kind-list li[data-kind="time"]').click();
  expect(await names(page)).toEqual(["Zeitachse 1", "Ausgenommen 1"]);
  await shot(page, "old-numbered.png");
});

test("the kind dropdown: a click opens the list, picking changes the kind in place (geometry and selection stay)", async ({ page }) => {
  await inOldTab(page);
  await drawThree(page);
  const before = await inspect(page);
  const second = before.zones[1]!;
  const row = page.locator(`#body-old [data-zone="${second.id}"]`);
  await row.locator(".kind-btn").click(); // selects the zone and opens its list
  const list = row.locator(".kind-list");
  await expect(list).toBeVisible();
  await expect(list.locator("li")).toHaveText(["Ausgenommen", "Zeitachse", "Wegachse", "Vorgänge"]);
  await shot(page, "old-dropdown-open.png");
  await list.locator('li[data-kind="path"]').click();
  const after = await inspect(page);
  const z = after.zones.find((o) => o.id === second.id)!;
  expect(z.kind).toBe("path");
  expect(z.box).toEqual(second.box); // nothing moved
  expect(after.selected).toBe(second.id); // stays selected
  expect(after.zones.map((o) => o.id)).toEqual(before.zones.map((o) => o.id));
  await expect(page.locator(`#body-old [data-zone="${second.id}"] .kind-btn`)).toContainText("Wegachse 1");
  await expect(page.locator("#body-old .kind-list:visible")).toHaveCount(0);
  await expect(page.locator("#body-old [data-line] .kind-btn")).toHaveCount(0); // Kopf and Fuß have none
});

test("the kind dropdown by keyboard: Enter opens, arrows move, Enter picks, Esc closes", async ({ page }) => {
  await inOldTab(page);
  await drawThree(page);
  const id = (await inspect(page)).zones[2]!.id;
  const list = page.locator(`#body-old [data-zone="${id}"] .kind-list`);
  const btn = page.locator(`#body-old [data-zone="${id}"] .kind-btn`);
  await btn.focus();
  await page.keyboard.press("Enter");
  await expect(list).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  expect((await inspect(page)).zones.find((o) => o.id === id)!.kind).toBe("path");
  await expect(btn).toBeFocused(); // back on the button, so the next round works at once
  await page.keyboard.press("Space");
  await expect(list).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  expect((await inspect(page)).zones.find((o) => o.id === id)!.kind).toBe("path"); // Esc changed nothing
  // Keys of the view do not leak out of the open list: Entf must not delete the zone.
  await page.keyboard.press("Space");
  await page.keyboard.press("Delete");
  expect((await inspect(page)).zones).toHaveLength(3);
});

test("the kind chooser for new zones has buttons only, no heading, and sets what the next drag draws", async ({ page }) => {
  await inOldTab(page);
  await expect(page.locator("#body-old .kind-chips button")).toHaveText(["Ausgenommen", "Zeitachse", "Wegachse", "Vorgänge"]);
  await expect(page.locator("#body-old")).not.toContainText("Ein neuer Bereich ist ein");
  await page.locator('#body-old .kind-chips button[data-kind="rows"]').click();
  const h = (await inspect(page)).header;
  await focus(page, h + 600);
  await dragMm(page, [100, h + 300], [400, h + 800], { alt: true });
  expect((await inspect(page)).zones[0]!.kind).toBe("rows");
  await expect(rows(page).first()).toContainText("Vorgänge 1");
});
