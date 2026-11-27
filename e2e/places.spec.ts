// The list of Places in "Vergleich" (ADR 0003, ADR 0008): the count, the filter, selecting in the
// list and on the Plan (CAD boxes), hiding, stepping with the arrows, and the display settings.
// Reached through the real flow on the synthetic "activities" pair; no real Plan is involved.
import { test, expect, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";

const APP = pathToFileURL(resolve("dist/index.html")).href;
const SHOTS = process.env.SHOTS_DIR;
const KINDS_N = 12;
const PAIR = [resolve("samples/activities-old.pdf"), resolve("samples/activities-new.pdf")];

test.beforeAll(() => {
  if (!existsSync("dist/index.html")) throw new Error("run `npm run build` first");
  if (!existsSync(PAIR[0]!)) throw new Error("run `npm run samples` first");
});

async function compared(page: Page, viewport = { width: 1500, height: 900 }) {
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

interface Inspected {
  zoom: number;
  centre: { x: number; y: number };
  selected: number[];
  peek: string | null;
  flying: boolean;
  settings: { base: string; fade: number; outline: number; removed: string; xSize: number; rings: boolean; marks: boolean };
  outlineGroups: number;
  drawn: { marks: number };
}
const inspect = (page: Page) => page.evaluate(() => (window as any).__spcCompare.inspect()) as Promise<Inspected>;
const settled = async (page: Page) => {
  await expect.poll(async () => (await inspect(page)).flying).toBe(false);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
};
const rows = (page: Page) => page.locator("#body-compare .pl-row");
const row = (page: Page, no: number) => page.locator(`#body-compare .pl-row[data-no="${no}"]`);
const places = (page: Page) =>
  page.evaluate(() => (window as any).__places.state.places.map((p: any) => ({ no: p.no, name: p.name, kind: p.kind, kinds: p.kinds, box: p.box }))) as Promise<
    { no: number; name: string | null; kind: string; kinds: string[]; box: { x0: number; y0: number; x1: number; y1: number } }[]
  >;
const selectedNos = async (page: Page) => (await inspect(page)).selected.sort((a, b) => a - b);
const onScreen = (page: Page, no: number) =>
  page.evaluate((no) => (window as any).__spcCompare.placeOnScreen(no), no) as Promise<{ x: number; y: number; w: number; h: number } | null>;
const scrollTop = (page: Page) => page.locator("#body-compare .pl-scroll").evaluate((e) => e.scrollTop);
const navBox = (page: Page) => page.locator("#cmp-nav").boundingBox();

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, name) });
}

/** Drags a box on the Plan from one corner to the other, in canvas px. */
async function dragBox(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, key?: "Control" | "Shift", shotName?: string) {
  const c = (await page.locator("#compare-canvas").boundingBox())!;
  if (key) await page.keyboard.down(key);
  await page.mouse.move(c.x + from.x, c.y + from.y);
  await page.mouse.down();
  await page.mouse.move(c.x + (from.x + to.x) / 2, c.y + (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(c.x + to.x, c.y + to.y, { steps: 4 });
  if (shotName) await shot(page, shotName);
  await page.mouse.up();
  if (key) await page.keyboard.up(key);
}

test.describe("the list of Places", () => {
  test("lists every Place with its name, kinds and amounts, and counts them", async ({ page }) => {
    const gt = JSON.parse(readFileSync("samples/ground-truth.json", "utf8")).pairs.find((p: { name: string }) => p.name === "activities");
    await compared(page);
    await expect(page.locator(".pl-count")).toHaveText(`${gt.changes.length} Stellen mit Unterschieden`);
    await expect(rows(page)).toHaveCount(gt.changes.length);
    const longer = row(page, (await places(page)).find((p) => p.name === "Gleis 2 erneuern mit Schotter")!.no);
    await expect(longer).toContainText("Verlängert");
    await expect(longer).toContainText("1 Tag 6 Std.");
    // The other kinds of a Place are tags.
    await expect(row(page, (await places(page)).find((p) => p.name === "Gleis 1 erneuern")!.no).locator(".tag")).toContainText("Beschriftung verschoben");
    await shot(page, "list.png");
  });

  test("draws the small pictures only for rows that are in view, and they show the marks", async ({ page }) => {
    await compared(page);
    await expect.poll(() => page.locator(".thumb-canvas").count(), { timeout: 30_000 }).toBeGreaterThan(3);
    const painted = await page.locator(".thumb-canvas").first().evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let red = 0,
        yellow = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i]! > 190 && d[i + 1]! < 110 && d[i + 2]! < 110) red++;
        else if (d[i]! > 190 && d[i + 1]! > 150 && d[i + 2]! < 90) yellow++;
      }
      return red + yellow;
    });
    expect(painted).toBeGreaterThan(20);
  });

  test("filters by kind of change and tells the Plan which marks to show", async ({ page }) => {
    await compared(page);
    const all = await places(page);
    const groups0 = (await inspect(page)).outlineGroups;
    await page.locator(".filter-btn").click();
    await expect(page.locator(".filter-panel")).toBeVisible();
    await expect(page.locator(".filter-rule")).toContainText("mehr ergeben als die Stellen");
    // Uncheck a kind that some Places have alone: those go, a Place that has another kind too stays.
    const kinds = [...new Set(all.map((p) => p.kind))];
    const kind = kinds.find((k) => all.some((p) => p.kinds.length === 1 && p.kinds[0] === k))!;
    const gone = all.filter((p) => p.kinds.every((k) => k === kind)).length;
    expect(gone).toBeGreaterThan(0);
    await page.locator(`.filter-panel input[data-kind="${kind}"]`).uncheck();
    await expect(page.locator(".pl-count")).toHaveText(`${all.length - gone} von ${all.length} Stellen`);
    await expect(rows(page)).toHaveCount(all.length - gone);
    await expect(page.locator(".filter-btn")).toContainText(`${KINDS_N - 1} von ${KINDS_N}`);
    expect((await inspect(page)).outlineGroups).toBeLessThan(groups0);
    // A Place with several kinds stays when one of them is checked; the unchecked kind's tag is struck through.
    const multi = all.find((p) => p.kinds.length > 1 && p.kinds[0] !== kind && p.kinds[1] !== kind)!;
    expect(multi).toBeTruthy();
    await page.locator(`.filter-panel input[data-kind="${multi.kinds[1]}"]`).uncheck();
    await expect(row(page, multi.no)).toBeVisible();
    await expect(row(page, multi.no).locator(".tag.off")).toHaveCount(1);
    // Nothing checked: the list is empty and the bar says why.
    const selectAll = page.locator('.filter-panel input[data-kind="all"]');
    await selectAll.click(); // from some kinds to all (as in Excel) ...
    await selectAll.click(); // ... and to none
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator("#cmp-nav-text")).toContainText("Keine Stelle passt zum Filter");
    await shot(page, "filter-open.png");
    await selectAll.click();
    await expect(rows(page)).toHaveCount(all.length);
    await page.keyboard.press("Escape");
    await expect(page.locator(".filter-panel")).toBeHidden();
  });

  test("filters by a Wo range typed in the column's funnel", async ({ page }) => {
    await compared(page);
    const n = (await places(page)).length;
    await page.locator('.col-cell[data-column="where"] .range-btn').click();
    await expect(page.locator(".range-panel")).toBeVisible();
    const inputs = page.locator(".range-panel input");
    await inputs.nth(0).fill("14");
    await inputs.nth(1).fill("15,2");
    await page.locator(".range-panel .btn.primary").click();
    await expect(page.locator(".range-panel")).toHaveCount(0);
    const shown = await rows(page).count();
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(n);
    await expect(page.locator(".filter-btn")).toContainText("Wo 14 – 15,2");
    // Clearing brings every Place back.
    await page.locator('.col-cell[data-column="where"] .range-btn').click();
    await page.locator(".range-panel .btn", { hasText: "Leeren" }).click();
    await expect(rows(page)).toHaveCount(n);
  });

  test("sorts by a column and moves a column", async ({ page }) => {
    await compared(page);
    const nos = () => rows(page).evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.no)));
    expect(await nos()).toEqual([...(await nos())].sort((a, b) => a - b));
    await page.locator('.col-title[data-column="name"]').click();
    const byName = (await places(page)).sort((a, b) => (a.name ?? "").toLowerCase().localeCompare((b.name ?? "").toLowerCase(), "de", { numeric: true })).map((p) => p.no);
    expect((await nos()).length).toBe(byName.length);
    await expect(page.locator('.col-title[data-column="name"]')).toContainText("▲");
    await page.locator('.col-title[data-column="name"]').click();
    await expect(page.locator('.col-title[data-column="name"]')).toContainText("▼");
    await page.locator('[data-action="clear-sort"]').click();
    expect(await nos()).toEqual([...(await nos())].sort((a, b) => a - b));
    // Dragging a title moves its column.
    await page.locator('.col-cell[data-column="where"]').dragTo(page.locator('.col-cell[data-column="no"]'), { targetPosition: { x: 2, y: 5 } });
    await expect(page.locator(".pl-head .col-cell").first()).toHaveAttribute("data-column", "where");
  });
});

test.describe("selecting", () => {
  test("a click in the list selects the Place and flies the Plan to it; Ctrl and Shift work as in Explorer", async ({ page }) => {
    await compared(page);
    const ps = await places(page);
    const before = await inspect(page);
    await row(page, ps[2]!.no).click();
    await expect(row(page, ps[2]!.no)).toHaveClass(/selected/);
    expect(await selectedNos(page)).toEqual([ps[2]!.no]);
    await settled(page);
    const after = await inspect(page);
    expect(after.zoom).toBeGreaterThan(before.zoom);
    const b = ps[2]!.box;
    expect(Math.abs(after.centre.x - (b.x0 + b.x1) / 2)).toBeLessThan(150);
    expect(Math.abs(after.centre.y - (b.y0 + b.y1) / 2)).toBeLessThan(150);
    await expect(page.locator(".pl-selection")).toContainText("1 ausgewählt");

    // Ctrl + click and Shift + click change the selection and never move the Plan.
    const still = await inspect(page);
    await row(page, ps[4]!.no).click({ modifiers: ["Control"] });
    expect(await selectedNos(page)).toEqual([ps[2]!.no, ps[4]!.no].sort((a, b) => a - b));
    await row(page, ps[6]!.no).click({ modifiers: ["Shift"] });
    expect(await selectedNos(page)).toEqual([ps[4]!.no, ps[5]!.no, ps[6]!.no].sort((a, b) => a - b));
    await row(page, ps[5]!.no).click({ modifiers: ["Control"] });
    expect(await selectedNos(page)).toEqual([ps[4]!.no, ps[6]!.no].sort((a, b) => a - b));
    await page.waitForTimeout(500);
    const end = await inspect(page);
    expect(end.centre).toEqual(still.centre);
    expect(end.zoom).toBe(still.zoom);
    await shot(page, "selection-list.png");
    // Esc clears it.
    await page.keyboard.press("Escape");
    expect(await selectedNos(page)).toEqual([]);
    await expect(page.locator(".pl-selection")).toBeHidden();
  });

  test("a click on a Place of the Plan selects it and the Plan stays where it is; a click on empty Plan clears it", async ({ page }) => {
    await compared(page);
    const ps = await places(page);
    await row(page, ps[1]!.no).click();
    await settled(page);
    const view = await inspect(page);
    const r = (await onScreen(page, ps[1]!.no))!;
    expect(r).not.toBeNull();
    const c = (await page.locator("#compare-canvas").boundingBox())!;
    // Click a point on the Place's own marks: its frame's corner may be empty, so look for the marks' pixels.
    const at = await page.evaluate(
      ({ r }) => {
        const cv = document.getElementById("compare-canvas") as HTMLCanvasElement;
        const d = devicePixelRatio;
        const px = cv.getContext("2d")!.getImageData(Math.round(r.x * d), Math.round(r.y * d), Math.max(1, Math.round(r.w * d)), Math.max(1, Math.round(r.h * d))).data;
        const w = Math.max(1, Math.round(r.w * d));
        for (let i = 0; i < px.length; i += 4) if (px[i]! > 200 && px[i + 1]! < 90 && px[i + 2]! < 90) return { x: r.x + ((i / 4) % w) / d, y: r.y + Math.floor(i / 4 / w) / d };
        return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      },
      { r },
    );
    await page.keyboard.press("Escape");
    await page.mouse.click(c.x + at.x, c.y + at.y);
    expect(await selectedNos(page)).toEqual([ps[1]!.no]);
    await expect(row(page, ps[1]!.no)).toHaveClass(/selected/);
    const after = await inspect(page);
    expect(after.centre).toEqual(view.centre);
    expect(after.zoom).toBe(view.zoom);
    // Empty Plan, far from every mark.
    await page.mouse.click(c.x + 5, c.y + 5);
    expect(await selectedNos(page)).toEqual([]);
  });

  test("a box dragged to the right takes what lies fully inside, to the left what it touches; Ctrl removes", async ({ page }) => {
    await compared(page);
    const ps = await places(page);
    const target = ps.find((p) => p.name === "Gleis 2 erneuern mit Schotter")!;
    await row(page, target.no).click();
    await settled(page);
    await page.keyboard.press("Escape");
    const r = (await onScreen(page, target.no))!;
    const pad = 30;
    // Left to right, but a corner short of the whole Place: nothing.
    await dragBox(page, { x: r.x - pad, y: r.y - pad }, { x: r.x + r.w / 2, y: r.y + r.h / 2 });
    expect(await selectedNos(page)).toEqual([]);
    // Left to right round the whole Place: it is selected.
    await dragBox(page, { x: r.x - pad, y: r.y - pad }, { x: r.x + r.w + pad, y: r.y + r.h + pad }, undefined, "selection-box-drag.png");
    expect(await selectedNos(page)).toContain(target.no);
    await shot(page, "selection-box.png");
    // Ctrl + box removes it again.
    await dragBox(page, { x: r.x - pad, y: r.y - pad }, { x: r.x + r.w + pad, y: r.y + r.h + pad }, "Control");
    expect(await selectedNos(page)).not.toContain(target.no);
    // Right to left through a corner of its box: it touches, so it is taken.
    await page.keyboard.press("Escape");
    await dragBox(page, { x: r.x + r.w / 2 + 5, y: r.y + r.h / 2 + 5 }, { x: r.x + r.w / 2 - 5, y: r.y + r.h / 2 - 5 });
    expect(await selectedNos(page)).toContain(target.no);
    // The Plan never moved.
    await row(page, target.no).waitFor();
  });

  test("the plan does not move for selecting, hiding or filtering, and the list keeps its scroll position", async ({ page }) => {
    await compared(page, { width: 1500, height: 700 });
    // A long list (synthetic Places, only to look at the list): many rows, only those in the page are built.
    await page.evaluate(() => {
      const src = (window as any).__places.state.places[0];
      const many = Array.from({ length: 3000 }, (_, i) => ({ ...src, no: i + 1, marks: [], partKinds: [], name: `Vorgang ${i + 1}`, box: { x0: i, y0: i, x1: i + 5, y1: i + 5 } }));
      (window as any).__places.state.setResult(many, 12345);
    });
    await expect(page.locator(".pl-count")).toHaveText("3.000 Stellen mit Unterschieden");
    expect(await rows(page).count()).toBeLessThan(60);
    const scroller = page.locator("#body-compare .pl-scroll");
    await scroller.evaluate((e) => (e.scrollTop = 30_000));
    await expect.poll(() => rows(page).first().getAttribute("data-no")).not.toBe("1");
    const top = await scrollTop(page);
    const centre = (await inspect(page)).centre;
    const target = Number(await rows(page).nth(8).getAttribute("data-no"));
    // Selecting, Ctrl + click, hiding by H and by the row's button, filtering: the scroll position stays.
    await rows(page).nth(8).click({ modifiers: ["Control"] });
    expect(await scrollTop(page)).toBe(top);
    await page.keyboard.press("h");
    await expect(row(page, target)).toHaveCount(0);
    expect(await scrollTop(page)).toBe(top);
    await rows(page).nth(8).hover();
    await rows(page).nth(8).locator('[data-action="hide-row"]').click();
    expect(await scrollTop(page)).toBe(top);
    await page.locator(".filter-btn").click();
    await page.locator('.filter-panel input[data-kind="gone"]').uncheck();
    expect(await scrollTop(page)).toBe(top);
    expect((await inspect(page)).centre).toEqual(centre);
  });
});

test.describe("hiding", () => {
  test("H hides the selection: it leaves the list and the Plan, nothing stays selected, nothing moves; hidden Places come back", async ({ page }) => {
    await compared(page);
    const ps = await places(page);
    const n = ps.length;
    await row(page, ps[3]!.no).click();
    await row(page, ps[5]!.no).click({ modifiers: ["Control"] });
    await settled(page);
    const view = await inspect(page);
    const groups = view.outlineGroups;
    await page.keyboard.press("h");
    await expect(rows(page)).toHaveCount(n - 2);
    await expect(row(page, ps[3]!.no)).toHaveCount(0);
    expect(await selectedNos(page)).toEqual([]);
    await expect(page.locator(".pl-count")).toHaveText(`${n - 2} von ${n} Stellen`);
    await expect(page.locator('[data-part="hidden"]')).toContainText("2 ausgeblendet");
    const after = await inspect(page);
    expect(after.centre).toEqual(view.centre);
    expect(after.zoom).toBe(view.zoom);
    expect(after.outlineGroups).toBeLessThan(groups);
    await shot(page, "hidden.png");
    // "zeigen" lists them again, greyed, still off the Plan.
    await page.locator('[data-action="toggle-hidden"]').click();
    await expect(rows(page)).toHaveCount(n);
    await expect(row(page, ps[3]!.no)).toHaveClass(/is-hidden/);
    expect((await inspect(page)).outlineGroups).toBe(after.outlineGroups);
    await row(page, ps[3]!.no).locator('[data-action="unhide"]').click();
    await expect(row(page, ps[3]!.no)).not.toHaveClass(/is-hidden/);
    await expect(page.locator('[data-part="hidden"]')).toContainText("1 ausgeblendet");
    await row(page, ps[5]!.no).locator('[data-action="unhide"]').click();
    await expect(page.locator('[data-part="hidden"]')).toBeHidden();
    await expect(rows(page)).toHaveCount(n);
  });

  test("the row's button hides the whole selection when the row is part of it", async ({ page }) => {
    await compared(page);
    const ps = await places(page);
    await row(page, ps[0]!.no).click();
    await row(page, ps[1]!.no).click({ modifiers: ["Control"] });
    await row(page, ps[1]!.no).locator('[data-action="hide-row"]').click();
    await expect(rows(page)).toHaveCount(ps.length - 2);
  });
});

test.describe("stepping", () => {
  test("the arrow keys, J and K and the buttons step through the list as shown, and the bar keeps its width", async ({ page }) => {
    await compared(page);
    const ps = await places(page);
    const width0 = (await navBox(page))!.width;
    await expect(page.locator("#cmp-nav-text")).toContainText("Keine Auswahl");
    await page.keyboard.press("ArrowRight");
    await settled(page);
    expect(await selectedNos(page)).toEqual([ps[0]!.no]);
    await expect(page.locator("#cmp-nav-text")).toContainText(ps[0]!.name!);
    const first = await inspect(page);
    await page.keyboard.press("j");
    expect(await selectedNos(page)).toEqual([ps[1]!.no]);
    await page.keyboard.press("k");
    await page.keyboard.press("k");
    expect(await selectedNos(page)).toEqual([ps[ps.length - 1]!.no]); // round the end
    await page.locator("#cmp-next").click();
    expect(await selectedNos(page)).toEqual([ps[0]!.no]);
    await page.locator("#cmp-prev").click();
    expect(await selectedNos(page)).toEqual([ps[ps.length - 1]!.no]);
    await settled(page);
    expect(await selectedNos(page)).toEqual([ps[ps.length - 1]!.no]);
    expect((await inspect(page)).centre).not.toEqual(first.centre); // it flew there
    // The arrows stay under the pointer: the bar's width does not depend on the Place.
    expect((await navBox(page))!.width).toBe(width0);
    const prev = (await page.locator("#cmp-prev").boundingBox())!;
    await page.locator("#cmp-next").click();
    expect((await page.locator("#cmp-prev").boundingBox())!.x).toBe(prev.x);
  });

  test("stepping follows the filter, and goes on from where hidden Places were", async ({ page }) => {
    await compared(page);
    const ps = await places(page);
    await row(page, ps[2]!.no).click();
    await page.keyboard.press("h");
    await page.keyboard.press("ArrowRight");
    expect(await selectedNos(page)).toEqual([ps[3]!.no]);
    await page.keyboard.press("Escape");
    await row(page, ps[3]!.no).click();
    await page.keyboard.press("h");
    await page.keyboard.press("ArrowLeft");
    expect(await selectedNos(page)).toEqual([ps[1]!.no]);
  });

  test("Space still shows the New Plan, and typing in a field does not step", async ({ page }) => {
    await compared(page);
    await page.keyboard.down(" ");
    expect((await inspect(page)).peek).toBe("new");
    await page.keyboard.up(" ");
    await page.locator('.col-cell[data-column="where"] .range-btn').click();
    await page.locator(".range-panel input").first().focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("j");
    expect(await selectedNos(page)).toEqual([]);
  });
});

test.describe("the display settings", () => {
  test("are folded away, change the Plan, and are remembered", async ({ page }) => {
    await compared(page);
    const details = page.locator("details.display");
    await expect(details).not.toHaveAttribute("open", "");
    await expect(page.locator(".display-body")).toBeHidden();
    await details.locator("summary").click();
    await expect(page.locator(".display-body")).toBeVisible();
    await page.locator('.wsw-btn[data-value="both"]').click();
    await page.locator('.wsw-btn[data-value="soft"]').click();
    await page.locator('.display-body input[type="range"]').nth(0).fill("12"); // Umriss
    await expect(page.locator(".disp-check", { hasText: "Ring" }).locator("input")).toBeChecked();
    await page.locator(".disp-check", { hasText: "Ring" }).locator("input").uncheck();
    const s = (await inspect(page)).settings;
    expect(s).toMatchObject({ base: "both", removed: "soft", outline: 12, rings: false });
    await shot(page, "display-open.png");
    // The "M" key switches the marks off and on.
    await page.locator("#compare-canvas").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("m");
    expect((await inspect(page)).settings.marks).toBe(false);
    await page.keyboard.press("m");
    expect((await inspect(page)).settings.marks).toBe(true);
    // Remembered in this browser.
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("simplepdfcompare.display")!));
    expect(stored).toMatchObject({ base: "both", removed: "soft", outline: 12, rings: false });
  });
});

test("the list's rows are available as a table, for the export", async ({ page }) => {
  await compared(page);
  const t = await page.evaluate(() => (window as any).__places.state.table());
  expect(t.columns).toEqual(["no", "name", "kind", "amount", "when", "where"]);
  expect(t.rows.length).toBe((await places(page)).length);
  expect(t.rows[0].cells[0]).toBe("1");
});
