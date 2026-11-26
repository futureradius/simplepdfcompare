// The smooth comparison view in "Vergleich" (ADR 0003, 0004, 0009): one Plan view with the
// marks, Space and Ctrl + Space, keys 1 2 3 F, the Overhang hatched, and the minimap with
// the Places. Reached through the real flow: "Vergleichen" on "Versatz" hands the result over.
import { test, expect, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";

const APP = pathToFileURL(resolve("dist/index.html")).href;
const SHOTS = process.env.SHOTS_DIR;
const PAIRS = {
  down: [resolve("samples/down-old.pdf"), resolve("samples/down-new.pdf")],
  activities: [resolve("samples/activities-old.pdf"), resolve("samples/activities-new.pdf")],
} as const;

test.beforeAll(() => {
  if (!existsSync("dist/index.html")) throw new Error("run `npm run build` first");
  if (!existsSync(PAIRS.down[0])) throw new Error("run `npm run samples` first");
});

async function compared(page: Page, pair: keyof typeof PAIRS) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(APP);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "1", { timeout: 60_000 });
  const files = PAIRS[pair].map((p) => ({ name: p.split(/[\\/]/).pop()!, b64: readFileSync(p).toString("base64") }));
  await page.evaluate((files) => {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: "application/pdf" }));
    for (const type of ["dragenter", "dragover", "drop"]) document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, files);
  await expect(page.locator("#proceed")).toBeEnabled({ timeout: 60_000 });
  await page.locator("#proceed").click();
  // The real flow: Weiter, Weiter, Weiter, then "Vergleichen" on "Versatz".
  await page.locator("#open-next").click();
  await expect(page.locator("#tab-old")).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
  await page.locator("#body-old [data-action=next]").click();
  await page.locator("#body-new [data-action=next]").click();
  await expect(page.locator("#offset-status")).toHaveAttribute("data-state", "done", { timeout: 60_000 });
  await page.locator("#offset-compare").click();
  await expect(page.locator("#tab-compare")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#compare-view")).toHaveAttribute("data-state", "done", { timeout: 90_000 });
  await expect(page.locator("#compare-canvas")).toBeVisible();
}

interface Inspected {
  zoom: number;
  centre: { x: number; y: number };
  visible: { x0: number; y0: number; x1: number; y1: number };
  frame: { x0: number; y0: number; x1: number; y1: number };
  cssW: number;
  peek: "old" | "new" | null;
  drawn: { notCompared: { plan: string; kind: string; label: string }[]; marks: number; rings: number };
}
const inspect = (page: Page) => page.evaluate(() => (window as any).__spcCompare.inspect()) as Promise<Inspected>;
const settle = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Pixels of the view (or a part of it, in CSS px) by mark colour, and the hatch's blue-grey. */
const colours = (page: Page, part?: { x: number; y: number; w: number; h: number }) =>
  page.evaluate((part) => {
    const c = document.getElementById("compare-canvas") as HTMLCanvasElement;
    const d = devicePixelRatio;
    const r = part ? [part.x * d, part.y * d, part.w * d, part.h * d].map(Math.round) : [0, 0, c.width, c.height];
    const px = c.getContext("2d")!.getImageData(r[0]!, r[1]!, Math.max(1, r[2]!), Math.max(1, r[3]!)).data;
    let red = 0,
      yellow = 0,
      hatch = 0;
    for (let i = 0; i < px.length; i += 4) {
      const [R, G, B] = [px[i]!, px[i + 1]!, px[i + 2]!];
      if (R > 200 && G < 90 && B < 90) red++;
      else if (R > 170 && G > 120 && G < 210 && B < 70) yellow++;
      else if (B - R >= 4 && B - G >= 4 && R < 235) hatch++;
    }
    return { red, yellow, hatch, n: px.length / 4 };
  }, part);

/** A cheap fingerprint of the whole view's pixels, to tell two pictures apart. */
const fingerprint = (page: Page) =>
  page.evaluate(() => {
    const c = document.getElementById("compare-canvas") as HTMLCanvasElement;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i]! + 7 * d[i + 1]! + 13 * d[i + 2]!) >>> 0;
    return h;
  });

async function shot(page: Page, name: string, clip?: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  if (clip) await page.locator(clip).screenshot({ path: join(SHOTS, name) });
  else await page.screenshot({ path: join(SHOTS, name) });
}

test("the view shows the marks on the faded New Plan, and keys 1 2 3 F zoom", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await compared(page, "down");
  await page.keyboard.press("1");
  await settle(page);
  let s = await inspect(page);
  // 1: the whole frame, both Plans (the New Plan 560 mm further down).
  expect(s.frame.y1).toBeCloseTo(14550, -1);
  expect(s.visible.y0).toBeLessThanOrEqual(s.frame.y0 + 1);
  expect(s.visible.y1).toBeGreaterThanOrEqual(s.frame.y1 - 1);
  const c = await colours(page);
  expect(c.red).toBeGreaterThan(20);
  expect(c.yellow).toBeGreaterThan(20);
  await shot(page, "view-whole-down.png");
  // 2: the Plan's width fills the view.
  await page.keyboard.press("2");
  s = await inspect(page);
  expect(s.zoom * (s.frame.x1 - s.frame.x0)).toBeGreaterThan(s.cssW * 0.95);
  expect(s.zoom * (s.frame.x1 - s.frame.x0)).toBeLessThanOrEqual(s.cssW);
  // 3: 1:1 (96 dpi).
  await page.keyboard.press("3");
  s = await inspect(page);
  expect(s.zoom).toBeCloseTo(96 / 25.4, 3);
  // F without a selected Place: the whole Plan, like 1.
  await page.keyboard.press("f");
  s = await inspect(page);
  expect(s.visible.y1 - s.visible.y0).toBeGreaterThanOrEqual(s.frame.y1 - s.frame.y0 - 1);
  expect(errors).toEqual([]);
});

test("Space shows the New Plan alone, Ctrl + Space the Old Plan, both without marks", async ({ page }) => {
  await compared(page, "down");
  await page.keyboard.press("2");
  await page.evaluate(() => (window as any).__spcCompare.centerOn(600, 7000));
  await settle(page);
  const before = await colours(page);
  expect(before.red + before.yellow).toBeGreaterThan(0);
  expect((await inspect(page)).drawn.marks).toBeGreaterThan(0);
  const marked = await fingerprint(page);
  await page.keyboard.down(" ");
  await settle(page);
  expect((await inspect(page)).peek).toBe("new");
  expect((await inspect(page)).drawn.marks).toBe(0);
  const newAlone = await fingerprint(page);
  expect(newAlone).not.toBe(marked);
  await shot(page, "space-new.png");
  await page.keyboard.down("Control");
  await settle(page);
  expect((await inspect(page)).peek).toBe("old");
  expect((await inspect(page)).drawn.marks).toBe(0);
  // The Old Plan alone is another picture than the New Plan alone (the Plans differ there).
  expect(await fingerprint(page)).not.toBe(newAlone);
  await shot(page, "ctrl-space-old.png");
  await page.keyboard.up("Control");
  await settle(page);
  expect((await inspect(page)).peek).toBe("new");
  await page.keyboard.up(" ");
  await settle(page);
  expect((await inspect(page)).peek).toBe(null);
  const c = await colours(page);
  expect(c.red + c.yellow).toBeGreaterThan(0);
  // Ctrl + Space pressed in that order too.
  await page.keyboard.down("Control");
  await page.keyboard.down(" ");
  await settle(page);
  expect((await inspect(page)).peek).toBe("old");
  await page.keyboard.up(" ");
  await page.keyboard.up("Control");
  await settle(page);
  expect((await inspect(page)).peek).toBe(null);
  // Space does not move the Plan.
  const s = await inspect(page);
  expect(s.centre.y).toBeCloseTo(7000, 0);
});

test("the Overhang is dimmed and hatched: nur im neuen Plan, and with Ctrl + Space nur im alten Plan", async ({ page }) => {
  await compared(page, "down");
  await page.keyboard.press("2");
  // The end of the New Plan's Body has no counterpart in the Old Plan.
  await page.evaluate(() => (window as any).__spcCompare.centerOn(600, 13900));
  await settle(page);
  let s = await inspect(page);
  expect(s.drawn.notCompared.map((z) => z.label)).toContain("nur im neuen Plan");
  const box = await page.evaluate(() => (window as any).__spcCompare.notComparedOnScreen("new", "overhang")) as { x: number; y: number; w: number; h: number };
  expect(box.h).toBeGreaterThan(50);
  const inside = await colours(page, { x: box.x + 5, y: box.y + 40, w: Math.min(300, box.w - 10), h: Math.min(200, box.h - 50) });
  expect(inside.hatch / inside.n).toBeGreaterThan(0.03);
  // A compared part of the Body has no hatch.
  await page.evaluate(() => (window as any).__spcCompare.centerOn(600, 7000));
  await settle(page);
  const body = await colours(page, { x: 20, y: 200, w: 300, h: 200 });
  expect(body.hatch / body.n).toBeLessThan(0.01);
  await page.evaluate(() => (window as any).__spcCompare.centerOn(600, 13900));
  await settle(page);
  await shot(page, "overhang-new.png");
  // The start of the Old Plan's Body, shown with Ctrl + Space.
  await page.evaluate(() => (window as any).__spcCompare.centerOn(600, 500));
  await page.keyboard.down("Control");
  await page.keyboard.down(" ");
  await settle(page);
  s = await inspect(page);
  expect(s.drawn.notCompared.map((z) => z.label)).toContain("nur im alten Plan");
  await shot(page, "overhang-old.png");
  await page.keyboard.up(" ");
  await page.keyboard.up("Control");
});

test("the minimap shows the Places, and a click on it centres the view there", async ({ page }) => {
  await compared(page, "down");
  await page.keyboard.press("1");
  await settle(page);
  // Hidden while the whole Plan is in view.
  await expect(page.locator("#cmp-minimap")).toBeHidden();
  await page.keyboard.press("2");
  await expect(page.locator("#cmp-minimap")).toBeVisible();
  const places = await page.evaluate(() => {
    const c = document.getElementById("cmp-places-canvas") as HTMLCanvasElement;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let red = 0,
      yellow = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]! < 128) continue;
      if (d[i]! > 180 && d[i + 1]! < 90) red++;
      else if (d[i]! > 180 && d[i + 1]! > 120 && d[i + 2]! < 90) yellow++;
    }
    return { red, yellow };
  });
  expect(places.red).toBeGreaterThan(0);
  expect(places.yellow).toBeGreaterThan(0);
  const r = (await page.locator("#cmp-overview-canvas").boundingBox())!;
  const s0 = await inspect(page);
  const scale = r.width / (s0.frame.x1 - s0.frame.x0);
  await page.mouse.click(r.x + r.width * 0.5, r.y + r.height * 0.7);
  await settle(page);
  const s = await inspect(page);
  expect(s.centre.x).toBeCloseTo(s0.frame.x0 + (r.width * 0.5) / scale, -1);
  expect(Math.abs(s.centre.y - (s0.frame.y0 + (r.height * 0.7) / scale))).toBeLessThan(2 / scale);
  // The view did not zoom.
  expect(s.zoom).toBeCloseTo(s0.zoom, 6);
});

test("the minimap with Places, for the user to judge: activities and down at a few zooms", async ({ page }) => {
  test.skip(!SHOTS, "only with SHOTS_DIR");
  for (const pair of ["activities", "down"] as const) {
    await compared(page, pair);
    for (const [name, zoom] of [
      ["width", "2"],
      ["1to1", "3"],
    ] as const) {
      await page.keyboard.press(zoom);
      await settle(page);
      await page.waitForTimeout(400);
      await shot(page, `minimap-${pair}-${name}.png`, "#cmp-minimap");
      await shot(page, `view-${pair}-${name}.png`);
    }
  }
});
