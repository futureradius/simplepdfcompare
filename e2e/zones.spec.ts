import { test, expect, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

// "Alter Plan" and "Neuer Plan" on the synthetic pair: draw, move, resize, Snap, delete and
// reset zones, the New Plan getting the copied zones, and drag frame times on the 14 m Plan.

const APP = pathToFileURL(resolve("dist/index.html")).href;
const SHOTS = process.env.SHOTS_DIR;
const OLD = resolve("samples/down-old.pdf");
const NEW = resolve("samples/down-new.pdf");
const RIGHT_OLD = resolve("samples/right-old.pdf");
const RIGHT_NEW = resolve("samples/right-new.pdf");
const OLD_LEN = 13710;
const NEW_LEN = 13990;

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

async function openPair(page: Page, pair: [string, string] = [OLD, NEW]) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(APP);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "1", { timeout: 60_000 });
  await drop(page, pair);
  await expect(page.locator("#proceed")).toBeEnabled({ timeout: 60_000 });
  await page.locator("#proceed").click();
  await expect(page.locator("#workspace")).toBeVisible();
}

/** Opens the pair and goes to "Alter Plan" (Weiter reads Header and Footer). */
async function inOldTab(page: Page, pair?: [string, string]) {
  await openPair(page, pair);
  await page.locator("#open-next").click();
  await expect(page.locator("#tab-old")).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
  await expect(page.locator("#zone-canvas")).toBeVisible();
}

type Role = "old" | "new";
interface Inspected {
  header: number;
  footer: number;
  length: number;
  selected: number | undefined;
  zones: { id: number; kind: string; full: boolean; box: { x0: number; y0: number; x1: number; y1: number } }[];
  indexReady: boolean;
}
const spc = <T>(page: Page, f: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([f, args]) => (window as any).__spc[f as string](...(args as unknown[])), [f, args] as const) as Promise<T>;
const inspect = (page: Page, role: Role = "old") => spc<Inspected>(page, "inspect", role);
/** Client px of a point of the Plan (mm). */
const at = (page: Page, x: number, y: number) => spc<{ x: number; y: number }>(page, "toClient", x, y);
const shot = async (page: Page, name: string) => {
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, name) });
  }
};

/** The width fills the view and the Plan's y (mm) is in the middle: about 0.8 px per mm. */
async function focus(page: Page, y: number) {
  await page.keyboard.press("2");
  await spc(page, "centerOn", 594, y);
  await page.waitForTimeout(50);
}

/** Left drag from one Plan point to another, in several moves. */
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

test("Alter Plan: the detected Header and Footer are shown as lines, with their sizes in the sidebar", async ({ page }) => {
  await inOldTab(page);
  const s = await inspect(page);
  expect(s.length).toBeCloseTo(OLD_LEN, 0);
  expect(s.header).toBeGreaterThan(100);
  expect(s.header).toBeLessThan(200);
  expect(s.length - s.footer).toBeGreaterThan(200);
  expect(s.length - s.footer).toBeLessThan(320);
  expect(s.zones).toEqual([]);
  await expect(page.locator('#body-old [data-line="header"] .size')).toContainText("mm");
  await expect(page.locator("#minimap")).toBeHidden(); // the whole Plan is in view
  await shot(page, "old-whole.png");
});

test("draw, move, resize: a left drag edits, and the size shows in the sidebar", async ({ page }) => {
  await inOldTab(page);
  const h = (await inspect(page)).header;
  await focus(page, h + 600);
  // Draw.
  await dragMm(page, [100, h + 300], [400, h + 800], { alt: true });
  let s = await inspect(page);
  expect(s.zones).toHaveLength(1);
  const z0 = s.zones[0]!.box;
  expect(z0.x0).toBeCloseTo(100, -1);
  expect(z0.x1 - z0.x0).toBeCloseTo(300, -1);
  expect(z0.y1 - z0.y0).toBeCloseTo(500, -1);
  expect(s.zones[0]!.kind).toBe("area");
  expect(s.selected).toBe(s.zones[0]!.id);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Ausgenommen 1");
  await expect(rows(page).first()).toContainText("300 × 500 mm");
  await shot(page, "old-drawn.png");
  // Move: drag inside by (+200, +100) mm.
  await dragMm(page, [250, h + 550], [450, h + 650], { alt: true });
  const z1 = (await inspect(page)).zones[0]!.box;
  expect(z1.x0 - z0.x0).toBeCloseTo(200, -1);
  expect(z1.y0 - z0.y0).toBeCloseTo(100, -1);
  expect(z1.x1 - z1.x0).toBeCloseTo(z0.x1 - z0.x0, 0); // moving keeps the size
  // Resize: pull the right edge by +100 mm.
  await dragMm(page, [z1.x1, (z1.y0 + z1.y1) / 2], [z1.x1 + 100, (z1.y0 + z1.y1) / 2], { alt: true });
  const z2 = (await inspect(page)).zones[0]!.box;
  expect(z2.x1 - z1.x1).toBeCloseTo(100, -1);
  expect(z2.x0).toBeCloseTo(z1.x0, 0);
  expect(z2.y0).toBeCloseTo(z1.y0, 0);
});

test("a click on empty Plan deselects and draws nothing; a press under 4 px is a click", async ({ page }) => {
  await inOldTab(page);
  const h = (await inspect(page)).header;
  await focus(page, h + 600);
  await dragMm(page, [100, h + 300], [400, h + 800], { alt: true });
  expect((await inspect(page)).selected).toBeDefined();
  const p = await at(page, 900, h + 1000);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 3, p.y + 2);
  await page.mouse.up();
  const s = await inspect(page);
  expect(s.selected).toBeUndefined();
  expect(s.zones).toHaveLength(1);
});

test("the right button pans, the left button never does", async ({ page }) => {
  await inOldTab(page);
  const h = (await inspect(page)).header;
  await focus(page, h + 600);
  const before = await spc<{ x0: number; y0: number }>(page, "visible");
  const a = await at(page, 600, h + 600);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(a.x - 100, a.y - 100, { steps: 5 });
  await page.mouse.up({ button: "right" });
  const afterRight = await spc<{ x0: number; y0: number }>(page, "visible");
  expect(afterRight.x0 - before.x0).toBeGreaterThan(50);
  expect(afterRight.y0 - before.y0).toBeGreaterThan(50);
  expect((await inspect(page)).zones).toHaveLength(0); // no zone was drawn
  // Middle button.
  const b = await at(page, 600, h + 600);
  await page.mouse.move(b.x, b.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(b.x + 80, b.y, { steps: 4 });
  await page.mouse.up({ button: "middle" });
  const afterMiddle = await spc<{ x0: number }>(page, "visible");
  expect(afterMiddle.x0).toBeLessThan(afterRight.x0 - 40);
  // Left: draws, the view stays.
  const v = await spc<{ x0: number; y0: number }>(page, "visible");
  await dragMm(page, [200, h + 300], [500, h + 500], { alt: true });
  const w = await spc<{ x0: number; y0: number }>(page, "visible");
  expect(w.x0).toBeCloseTo(v.x0, 3);
  expect(w.y0).toBeCloseTo(v.y0, 3);
  expect((await inspect(page)).zones).toHaveLength(1);
});

test("the wheel zooms around the pointer and the keys 1, 2, 3 set the view", async ({ page }) => {
  await inOldTab(page);
  const z1 = await spc<number>(page, "zoom");
  const c = await at(page, 594, 3000);
  await page.mouse.move(c.x, c.y);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(50);
  expect(await spc<number>(page, "zoom")).toBeGreaterThan(z1 * 1.3);
  await page.keyboard.press("3");
  await page.waitForTimeout(50);
  expect(await spc<number>(page, "zoom")).toBeCloseTo(96 / 25.4, 1);
  await page.keyboard.press("1");
  await page.waitForTimeout(50);
  expect(await spc<number>(page, "zoom")).toBeCloseTo(z1, 3);
});

test("Snap: the Header line and zone edges jump to drawn lines, Alt drags freely, the segment index is built on first use", async ({ page }) => {
  await inOldTab(page);
  const h = (await inspect(page)).header;
  await focus(page, h + 300);
  expect((await inspect(page)).indexReady).toBe(false); // nothing built before it is needed
  // The Header line, 6 mm off: it snaps back to the line across the Plan.
  await dragMm(page, [594, h], [594, h + 6]);
  expect((await inspect(page)).header).toBeCloseTo(h, 1);
  // With Alt it goes where the pointer is.
  await dragMm(page, [594, h], [594, h + 6], { alt: true });
  const free = (await inspect(page)).header;
  expect(free).toBeGreaterThan(h + 3);
  await dragMm(page, [594, free], [594, h]); // back (snaps)
  expect((await inspect(page)).header).toBeCloseTo(h, 1);
  // A zone edge: the first drag asks for the index; once it is there, edges snap.
  await dragMm(page, [200, h + 300], [400, h + 400], { alt: true });
  const id = (await inspect(page)).zones[0]!.id;
  expect(id).toBeDefined();
  const a = await at(page, 300, h + 300);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x, a.y - 30, { steps: 3 }); // starts the drag: the index is asked for
  await expect.poll(async () => (await inspect(page)).indexReady, { timeout: 20_000 }).toBe(true);
  const target = await at(page, 300, h + 5);
  await page.mouse.move(target.x, target.y, { steps: 4 });
  await page.mouse.up();
  const snapped = (await inspect(page)).zones[0]!.box.y0;
  expect(snapped).toBeCloseTo(h, 1);
  // The same drag with Alt stays where it is.
  const b = await at(page, 300, snapped);
  await page.mouse.move(b.x, b.y);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(b.x, b.y + 20, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  expect((await inspect(page)).zones[0]!.box.y0).toBeGreaterThan(h + 15);
});

test("delete: the × bubble, the sidebar × and the Entf key; ⇕ stretches over the whole length and back", async ({ page }) => {
  await inOldTab(page);
  const h = (await inspect(page)).header;
  await focus(page, h + 600);
  for (const x of [100, 450, 800]) await dragMm(page, [x, h + 300], [x + 200, h + 700], { alt: true });
  expect((await inspect(page)).zones).toHaveLength(3);
  await expect(rows(page)).toHaveCount(3);
  // The bubbles as the next frame draws them.
  const fresh = async () => {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    return spc<{ name: string; x: number; y: number }[]>(page, "bubbles", "old");
  };
  // The × bubble of the selected (third) zone, drawn on the canvas.
  let bubbles = await fresh();
  const del = bubbles.filter((b) => b.name === "Bereich löschen");
  expect(del.length).toBeGreaterThan(0);
  const last = del[del.length - 1]!; // the selected zone is drawn last
  await page.mouse.click(last.x, last.y);
  expect((await inspect(page)).zones).toHaveLength(2);
  // The sidebar ×.
  await rows(page).first().locator(".x").click();
  expect((await inspect(page)).zones).toHaveLength(1);
  // Select the last one by its row, then Entf.
  await rows(page).first().click();
  expect((await inspect(page)).selected).toBeDefined();
  // ⇕ first, to see the zone run over the whole length.
  bubbles = await fresh();
  const full = bubbles.find((b) => b.name === "Über die ganze Länge")!;
  await page.mouse.click(full.x, full.y);
  let z = (await inspect(page)).zones[0]!;
  expect(z.full).toBe(true);
  expect(z.box.y0).toBe(0);
  expect(z.box.y1).toBeCloseTo(OLD_LEN, 0);
  await shot(page, "old-full-length.png");
  bubbles = await fresh();
  await page.mouse.click(bubbles.find((b) => b.name === "Über die ganze Länge")!.x, bubbles.find((b) => b.name === "Über die ganze Länge")!.y);
  z = (await inspect(page)).zones[0]!;
  expect(z.full).toBe(false);
  expect(z.box.y1 - z.box.y0).toBeCloseTo(400, -1);
  await page.keyboard.press("Delete");
  expect((await inspect(page)).zones).toHaveLength(0);
  await expect(rows(page)).toHaveCount(0);
});

test("deleting the Header zone leaves its line on the Plan's edge; pulling the line brings the zone back", async ({ page }) => {
  await inOldTab(page);
  const h = (await inspect(page)).header;
  await focus(page, h + 100);
  const bubbles = await spc<{ name: string; x: number; y: number }[]>(page, "bubbles", "old");
  const x = bubbles.find((b) => b.name === "Kopf löschen")!;
  await page.mouse.click(x.x, x.y);
  expect((await inspect(page)).header).toBe(0);
  await expect(page.locator('#body-old [data-line="header"] .size')).toHaveText("gelöscht");
  await spc(page, "centerOn", 594, 200);
  await page.keyboard.press("3");
  await spc(page, "centerOn", 594, 100);
  await dragMm(page, [594, 0], [594, 90], { alt: true });
  expect((await inspect(page)).header).toBeGreaterThan(80);
});

test("reset: back to the detected Header and Footer with no other zones", async ({ page }) => {
  await inOldTab(page);
  const start = await inspect(page);
  await focus(page, start.header + 300);
  await dragMm(page, [100, start.header + 300], [400, start.header + 800], { alt: true });
  await dragMm(page, [594, start.header], [594, start.header + 30], { alt: true });
  expect((await inspect(page)).zones).toHaveLength(1);
  expect((await inspect(page)).header).not.toBeCloseTo(start.header, 0);
  await page.locator('#body-old [data-action="reset"]').click();
  const s = await inspect(page);
  expect(s.zones).toHaveLength(0);
  expect(s.header).toBeCloseTo(start.header, 1);
  expect(s.footer).toBeCloseTo(start.footer, 1);
});

test("Neuer Plan: the zones are copied from the Old Plan (Header height, Footer distance from the end, same place), and Reset copies them again", async ({ page }) => {
  await inOldTab(page);
  const o = await inspect(page);
  await focus(page, o.header + 600);
  await dragMm(page, [100, o.header + 300], [400, o.header + 800], { alt: true });
  await dragMm(page, [594, o.header], [594, o.header + 40], { alt: true });
  const old = await inspect(page);
  await page.locator('#body-old [data-action="next"]').click();
  await expect(page.locator("#tab-new")).toHaveAttribute("aria-selected", "true");
  const n = await inspect(page, "new");
  expect(n.length).toBeCloseTo(NEW_LEN, 0);
  expect(n.header).toBeCloseTo(old.header, 1);
  expect(OLD_LEN - old.footer).toBeCloseTo(n.length - n.footer, 1);
  expect(n.zones).toHaveLength(1);
  expect(n.zones[0]!.box.x0).toBeCloseTo(old.zones[0]!.box.x0, 1);
  expect(n.zones[0]!.box.y0).toBeCloseTo(old.zones[0]!.box.y0, 1);
  await expect(page.locator('#body-new [data-zone]')).toHaveCount(1);
  await shot(page, "new-copied.png");
  // Edit the New Plan, then Reset copies the Old Plan's zones again.
  await page.keyboard.press("Delete"); // nothing selected: no effect
  await page.locator('#body-new [data-zone] .x').click();
  expect((await inspect(page, "new")).zones).toHaveLength(0);
  await page.locator('#body-new [data-action="reset"]').click();
  expect((await inspect(page, "new")).zones).toHaveLength(1);
  // Going back and forth does not lose the New Plan's own edits.
  await page.locator('#body-new [data-zone] .x').click();
  await page.locator("#tab-old").click();
  await page.locator("#tab-new").click();
  expect((await inspect(page, "new")).zones).toHaveLength(0);
});

test("each tab keeps its own view: switching tabs does not move the Plan", async ({ page }) => {
  await inOldTab(page);
  const h = (await inspect(page)).header;
  await focus(page, h + 2000);
  const v1 = await spc<{ x0: number; y0: number }>(page, "visible");
  await page.locator('#body-old [data-action="next"]').click();
  await expect(page.locator("#tab-new")).toHaveAttribute("aria-selected", "true");
  await page.locator("#tab-old").click();
  const v2 = await spc<{ x0: number; y0: number }>(page, "visible");
  expect(v2.x0).toBeCloseTo(v1.x0, 3);
  expect(v2.y0).toBeCloseTo(v1.y0, 3);
});

test("minimap: hidden while the whole Plan is in view, shown when zoomed, × folds it, a click moves the view", async ({ page }) => {
  await inOldTab(page);
  await expect(page.locator("#minimap")).toBeHidden();
  await page.keyboard.press("3");
  await expect(page.locator("#minimap")).toBeVisible();
  const box = (await page.locator("#minimap").boundingBox())!;
  const viewer = (await page.locator("#zone-view").boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(viewer.height / 3 + 14); // a third of the view, plus its padding
  const before = await spc<{ y0: number }>(page, "visible");
  const inner = (await page.locator("#overview-inner").boundingBox())!;
  await page.mouse.click(inner.x + inner.width / 2, inner.y + inner.height * 0.8);
  const after = await spc<{ y0: number }>(page, "visible");
  expect(after.y0).toBeGreaterThan(before.y0 + 1000);
  await shot(page, "old-minimap.png");
  await page.locator("#minimap-collapse").click();
  await expect(page.locator("#minimap")).toBeHidden();
  await expect(page.locator("#minimap-expand")).toBeVisible();
  await page.locator("#minimap-expand").click();
  await expect(page.locator("#minimap")).toBeVisible();
  await page.keyboard.press("1");
  await expect(page.locator("#minimap")).toBeHidden();
});

test("the setup is remembered silently for the next pair", async ({ page }) => {
  await inOldTab(page);
  const o = await inspect(page);
  await focus(page, o.header + 600);
  await dragMm(page, [100, o.header + 300], [400, o.header + 800], { alt: true });
  await dragMm(page, [594, o.header], [594, o.header + 40], { alt: true });
  const set = await inspect(page);
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-ready", "1", { timeout: 60_000 });
  await drop(page, [OLD, NEW]);
  await expect(page.locator("#proceed")).toBeEnabled({ timeout: 60_000 });
  await page.locator("#proceed").click();
  await page.locator("#open-next").click();
  await expect(page.locator("#tab-old")).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
  const again = await inspect(page);
  expect(again.header).toBeCloseTo(set.header, 1);
  expect(again.footer).toBeCloseTo(set.footer, 1);
  expect(again.zones).toHaveLength(1);
  expect(again.zones[0]!.box.y0).toBeCloseTo(set.zones[0]!.box.y0, 1);
});

test("the other Time direction: the zones lie along x on a waagerecht Plan", async ({ page }) => {
  await inOldTab(page, [RIGHT_OLD, RIGHT_NEW]);
  const s = await inspect(page);
  expect(s.length).toBeCloseTo(590, -1); // the Old Plan is 590 mm wide
  expect(s.header).toBeGreaterThan(0);
  expect(s.header).toBeLessThan(s.footer);
  await page.keyboard.press("1");
  await shot(page, "old-right.png");
});

test("dragging stays smooth on the 14 m Plan: frame times while drawing, moving and pulling a line", async ({ page }) => {
  await inOldTab(page);
  const h = (await inspect(page)).header;
  const measure = async (name: string, f: () => Promise<void>) => {
    await page.evaluate(() => {
      const w = window as unknown as { __frames: number[]; __run: boolean };
      w.__frames = [];
      w.__run = true;
      let last = performance.now();
      const tick = (t: number) => {
        w.__frames.push(t - last);
        last = t;
        if (w.__run) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await f();
    const frames = await page.evaluate(() => {
      (window as any).__run = false;
      return (window as any).__frames as number[];
    });
    const sorted = [...frames].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
    return { name, frames: frames.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +sorted[sorted.length - 1]!.toFixed(1) };
  };
  const results = [];
  // On the whole Plan, and at 1:1 further in.
  await page.keyboard.press("1");
  results.push(
    await measure("draw a zone, whole Plan (80 moves)", async () => {
      await dragMm(page, [100, 3000], [900, 9000], { steps: 80 });
    }),
  );
  results.push(
    await measure("move it, whole Plan (80 moves)", async () => {
      await dragMm(page, [500, 6000], [300, 8000], { steps: 80 });
    }),
  );
  results.push(
    await measure("pull the Header line, whole Plan (80 moves)", async () => {
      await dragMm(page, [594, h], [594, h + 600], { steps: 80, alt: true });
    }),
  );
  await focus(page, 5000);
  await page.keyboard.press("3");
  await spc(page, "centerOn", 400, 5000);
  results.push(
    await measure("draw a zone, 1:1 (80 moves, with Snap)", async () => {
      await dragMm(page, [150, 4900], [330, 5100], { steps: 80 });
    }),
  );
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/frame-times.json", JSON.stringify(results, null, 2));
  console.log("FRAME TIMES (ms between frames):\n" + results.map((r) => `${r.name}: frames=${r.frames} p50=${r.p50} p95=${r.p95} max=${r.max}`).join("\n"));
  for (const r of results) expect(r.p95).toBeLessThan(60);
});
