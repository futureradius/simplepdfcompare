import { test, expect, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

// "Versatz": both Plans on top of each other, the Offset found, nudged, typed and dragged,
// the search stopped on going back, and "Vergleichen" handing a result that used the user's zones.

const APP = pathToFileURL(resolve(process.env.APP_DIST ?? "dist/index.html")).href;
const SHOTS = process.env.SHOTS_DIR;
const PAIRS = {
  down: { files: [resolve("samples/down-old.pdf"), resolve("samples/down-new.pdf")], offset: 560, axis: "y" },
  right: { files: [resolve("samples/right-old.pdf"), resolve("samples/right-new.pdf")], offset: 36, axis: "x" },
} as const;

test.beforeAll(() => {
  if (!existsSync("dist/index.html")) throw new Error("run `npm run build` first");
  if (!existsSync(PAIRS.down.files[0])) throw new Error("run `npm run samples` first");
});

async function drop(page: Page, paths: readonly string[]) {
  const files = paths.map((p) => ({ name: p.split(/[\\/]/).pop()!, b64: readFileSync(p).toString("base64") }));
  await page.evaluate((files) => {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: "application/pdf" }));
    for (const type of ["dragenter", "dragover", "drop"]) document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, files);
}

/** Opens the pair and goes through "Alter Plan" and "Neuer Plan" with their defaults. */
async function toVersatz(page: Page, name: keyof typeof PAIRS = "down", init?: () => Promise<void>) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await init?.();
  await page.goto(APP);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "1", { timeout: 60_000 });
  await drop(page, PAIRS[name].files);
  await expect(page.locator("#proceed")).toBeEnabled({ timeout: 60_000 });
  await page.locator("#proceed").click();
  await page.locator("#open-next").click();
  await expect(page.locator("#tab-old")).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
  await page.locator('#body-old [data-action="next"]').click();
  await expect(page.locator("#tab-new")).toHaveAttribute("aria-selected", "true");
  await page.locator('#body-new [data-action="next"]').click();
  await expect(page.locator("#tab-offset")).toHaveAttribute("aria-selected", "true");
}

const offset = async (page: Page) => Number(await page.locator("#offset-value").getAttribute("data-offset"));
const searchDone = (page: Page) => expect(page.locator("#offset-status")).toHaveAttribute("data-state", "done", { timeout: 60_000 });
const spc = <T>(page: Page, f: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([f, args]) => (window as any).__spc[f as string](...(args as unknown[])), [f, args] as const) as Promise<T>;
const shot = async (page: Page, name: string) => {
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, name) });
  }
};

for (const name of ["down", "right"] as const) {
  test(`${name} pair: the Offset found by default is the ground truth, with candidates and a bar`, async ({ page }) => {
    await toVersatz(page, name);
    await searchDone(page);
    expect(await offset(page)).toBeCloseTo(PAIRS[name].offset, 2);
    await expect(page.locator("#offset-value")).toContainText(`${PAIRS[name].offset},00 mm`);
    await expect(page.locator("#offset-from")).toContainText("automatisch erkannt");
    const first = page.locator('#offset-cands [data-cand="0"]');
    await expect(first).toHaveClass(/on/);
    await expect(first.locator(".bar")).toBeVisible();
    await shot(page, `versatz-${name}.png`);
    // The canvas shows both Plans: blue (only Old), red (only New) and dark (both) ink.
    const ink = await page.evaluate(() => {
      const c = document.getElementById("zone-canvas") as HTMLCanvasElement;
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let blue = 0, red = 0, dark = 0;
      for (let i = 0; i < d.length; i += 4) {
        const [r, g, b] = [d[i]!, d[i + 1]!, d[i + 2]!];
        if (b > 180 && r < 90 && g < 170) blue++;
        else if (r > 180 && g < 60 && b < 110) red++;
        else if (r < 120 && g < 120 && b < 140) dark++;
      }
      return { blue, red, dark };
    });
    expect(ink.dark).toBeGreaterThan(10);
    if (name === "right") expect(ink.blue + ink.red).toBeGreaterThan(5); // the first view of the down pair holds only aligned ink
  });
}

test("nudging by the buttons moves the Offset by 0.1, 1 and 10 mm", async ({ page }) => {
  await toVersatz(page);
  await searchDone(page);
  await page.locator('[data-nudge="0.1"]').click();
  expect(await offset(page)).toBeCloseTo(560.1, 2);
  await page.locator('[data-nudge="-1"]').click();
  expect(await offset(page)).toBeCloseTo(559.1, 2);
  await page.locator('[data-nudge="10"]').click();
  expect(await offset(page)).toBeCloseTo(569.1, 2);
  await page.locator('[data-nudge="-0.1"]').click();
  await page.locator('[data-nudge="-10"]').click();
  expect(await offset(page)).toBeCloseTo(559, 2);
  await expect(page.locator("#offset-from")).toContainText("von Hand");
  await expect(page.locator('#offset-cands [data-cand="0"]')).not.toHaveClass(/on/);
});

test("nudging by the arrow keys: along the Time direction, Ctrl for 1 mm, Page down for 10 mm", async ({ page }) => {
  await toVersatz(page);
  await searchDone(page);
  await page.keyboard.press("ArrowDown");
  expect(await offset(page)).toBeCloseTo(560.1, 2);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowRight"); // across: no effect
  expect(await offset(page)).toBeCloseTo(560, 2);
  await page.keyboard.press("Control+ArrowDown");
  expect(await offset(page)).toBeCloseTo(561, 2);
  await page.keyboard.press("PageUp");
  expect(await offset(page)).toBeCloseTo(551, 2);
});

test("on the right pair the arrow keys run left and right", async ({ page }) => {
  await toVersatz(page, "right");
  await searchDone(page);
  await page.keyboard.press("ArrowRight");
  expect(await offset(page)).toBeCloseTo(36.1, 2);
  await page.keyboard.press("ArrowDown"); // across: no effect
  expect(await offset(page)).toBeCloseTo(36.1, 2);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  expect(await offset(page)).toBeCloseTo(35.9, 2);
});

test("typing the Offset: German decimal, Enter or leaving the field; nonsense is refused", async ({ page }) => {
  await toVersatz(page);
  await searchDone(page);
  const input = page.locator("#offset-input");
  await input.fill("123,45");
  await input.press("Enter");
  expect(await offset(page)).toBeCloseTo(123.45, 2);
  await expect(page.locator("#offset-value")).toContainText("123,45 mm");
  await input.fill("-7");
  await page.locator("h2", { hasText: "Versatz" }).click(); // leave the field
  expect(await offset(page)).toBeCloseTo(-7, 2);
  await input.fill("abc");
  await input.press("Enter");
  expect(await offset(page)).toBeCloseTo(-7, 2);
  await expect(input).toHaveValue("-7,00");
  // A candidate button sets it back.
  await page.locator('#offset-cands [data-cand="0"]').click();
  expect(await offset(page)).toBeCloseTo(560, 2);
  await expect(page.locator("#offset-from")).toContainText("automatisch");
});

test("dragging the Plan snaps to a candidate (Alt drags free)", async ({ page }) => {
  await toVersatz(page);
  await searchDone(page);
  await page.locator("#offset-input").fill("540");
  await page.locator("#offset-input").press("Enter");
  expect(await offset(page)).toBeCloseTo(540, 2);
  await page.keyboard.press("2");
  const win = await page.evaluate(() => (window as any).__offset.inspect().window as [number, number]);
  const y = win[0] + 1500;
  await spc(page, "centerOn", 594, y);
  await page.waitForTimeout(50);
  const drag = async (dy: number, alt: boolean) => {
    const a = await spc<{ x: number; y: number }>(page, "toClient", 594, y);
    const zoom = await spc<number>(page, "zoom");
    await page.mouse.move(a.x, a.y);
    if (alt) await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(a.x, a.y + dy * zoom, { steps: 10 });
    await page.mouse.up();
    if (alt) await page.keyboard.up("Alt");
  };
  await drag(18, false); // 540 + 18 = 558, within 10 px of 560
  expect(await offset(page)).toBeCloseTo(560, 2);
  await expect(page.locator("#offset-from")).toContainText("automatisch");
  await page.locator("#offset-input").fill("540");
  await page.locator("#offset-input").press("Enter");
  await drag(18, true);
  expect(await offset(page)).toBeGreaterThan(557);
  expect(await offset(page)).toBeLessThan(559);
  await expect(page.locator("#offset-from")).toContainText("von Hand");
});

test("going back to Alter Plan stops the search, and entering again searches again", async ({ page }) => {
  await toVersatz(page, "down", async () => {
    await page.addInitScript(() => ((window as any).__offsetSearchDelayMs = 4000));
  });
  const state = () => page.evaluate(() => (window as any).__offset.inspect().state as string);
  await expect(page.locator("#offset-status")).toHaveAttribute("data-state", "searching");
  await expect(page.locator("#offset-status")).toContainText("Suche läuft");
  // The tool stays usable meanwhile: the Offset can be set by hand.
  await page.locator('[data-nudge="1"]').click();
  expect(await offset(page)).toBeCloseTo(1, 2);
  await page.locator("#tab-old").click();
  expect(await state()).toBe("idle");
  await page.waitForTimeout(4500);
  expect(await state()).toBe("idle");
  await page.locator("#tab-offset").click();
  await expect(page.locator("#offset-status")).toHaveAttribute("data-state", "searching");
  await expect(page.locator("#offset-status")).toHaveAttribute("data-state", "done", { timeout: 20_000 });
  // The user had set the Offset by hand: the result does not replace it.
  expect(await offset(page)).toBeCloseTo(1, 2);
  // The result is kept: leaving and coming back does not search again.
  await page.locator("#tab-new").click();
  await page.locator("#tab-offset").click();
  expect(await state()).toBe("done");
});

const hand = (page: Page) => page.evaluate(() => (window as any).__handoff.latest());

test("Vergleichen runs the comparison and opens Vergleich with a result that used the confirmed Offset", async ({ page }) => {
  await toVersatz(page);
  await searchDone(page);
  await page.locator("#offset-compare").click();
  await expect(page.locator("#tab-compare")).toHaveAttribute("aria-selected", "true", { timeout: 90_000 });
  await expect(page.locator("#compare-view")).toHaveAttribute("data-state", "done", { timeout: 90_000 });
  await expect(page.locator("#body-compare")).toContainText("560,00 mm");
  const r = await page.evaluate(() => {
    const h = (window as any).__handoff.latest();
    return { offset: h.setup.offset, axis: h.setup.axis, marks: h.comparison.marks.length, places: h.places.length, ignored: h.setup.old.ignored.length, direction: h.timeDirection };
  });
  expect(r.offset).toBeCloseTo(560, 2);
  expect(r).toMatchObject({ axis: "y", ignored: 0, direction: "down" });
  expect(r.marks).toBeGreaterThan(0);
  expect(r.places).toBeGreaterThan(0);
  await shot(page, "vergleich-down.png");
  // A hand-set Offset is the one used.
  await page.locator("#tab-offset").click();
  await page.locator('[data-nudge="10"]').click();
  await page.locator("#offset-compare").click();
  await expect(page.locator("#compare-view")).toHaveAttribute("data-offset", "570.000", { timeout: 90_000 });
});

test("Vergleichen with an Ausgenommen box over a planted change leaves that Difference out", async ({ page }) => {
  await toVersatz(page);
  await searchDone(page);
  await page.locator("#offset-compare").click();
  await expect(page.locator("#compare-view")).toHaveAttribute("data-state", "done", { timeout: 90_000 });
  const before = await hand(page);
  const d1 = (b: { x0: number; y0: number; x1: number; y1: number }) => ({ cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 });
  const inD1 = (m: { box: { x0: number; y0: number; x1: number; y1: number }; plan: string }) => {
    const c = d1(m.box);
    return c.cx > 160 && c.cx < 305 && c.cy > 1620 && c.cy < 2200;
  };
  const marksBefore = before.comparison.marks.filter(inD1).length;
  expect(marksBefore).toBeGreaterThan(0);
  // Draw an Ausgenommen box over D1 in "Alter Plan": a band along the whole Body, so that it is the same band
  // in both Plans whatever the Offset (it is copied to "Neuer Plan" at the same place on the page).
  await page.locator("#tab-old").click();
  await page.keyboard.press("2");
  await spc(page, "centerOn", 594, 1800);
  await page.waitForTimeout(50);
  const a = await spc<{ x: number; y: number }>(page, "toClient", 120, 1650);
  const b = await spc<{ x: number; y: number }>(page, "toClient", 420, 1900);
  await page.mouse.move(a.x, a.y);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  // ... and stretch it over the whole length (the ⇕ bubble).
  // The bubbles come with the next frame.
  const bubble = async () => (await spc<{ name: string; x: number; y: number }[]>(page, "bubbles", "old")).find((x) => x.name === "Über die ganze Länge");
  await expect.poll(bubble).toBeTruthy();
  const full = (await bubble())!;
  await page.mouse.click(full.x, full.y);
  await page.locator('#body-old [data-action="next"]').click();
  await page.locator('#body-new [data-action="next"]').click();
  await expect(page.locator("#tab-offset")).toHaveAttribute("aria-selected", "true");
  await searchDone(page);
  await page.locator("#offset-compare").click();
  await expect(page.locator("#body-compare")).toContainText("1 alt / 1 neu", { timeout: 90_000 });
  await expect(page.locator("#compare-view")).toHaveAttribute("data-state", "done");
  const after = await hand(page);
  expect(after.setup.old.ignored).toHaveLength(1);
  expect(after.setup.new.ignored).toHaveLength(1);
  expect(after.comparison.marks.filter(inD1)).toHaveLength(0);
  expect(after.comparison.marks.length).toBeLessThan(before.comparison.marks.length);
});

test("dragging the overlay stays smooth on the 14 m Plan: frame times", async ({ page }) => {
  await toVersatz(page);
  await searchDone(page);
  const win = await page.evaluate(() => (window as any).__offset.inspect().window as [number, number]);
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
  const dragBy = async (y: number, mm: number, steps: number) => {
    const a = await spc<{ x: number; y: number }>(page, "toClient", 594, y);
    const zoom = await spc<number>(page, "zoom");
    await page.mouse.move(a.x, a.y);
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(a.x, a.y + mm * zoom, { steps });
    await page.mouse.up();
    await page.keyboard.up("Alt");
  };
  const results = [];
  await page.keyboard.press("1");
  results.push(await measure("drag the overlay, whole Plan (80 moves)", () => dragBy(6000, 3000, 80)));
  await page.keyboard.press("2");
  await spc(page, "centerOn", 594, win[0] + 2000);
  await page.waitForTimeout(300);
  results.push(await measure("drag the overlay, Plan width (80 moves)", () => dragBy(win[0] + 2000, 200, 80)));
  await page.keyboard.press("3");
  await spc(page, "centerOn", 594, win[0] + 2000);
  await page.waitForTimeout(600);
  results.push(await measure("drag the overlay, 1:1 (80 moves)", () => dragBy(win[0] + 2000, 60, 80)));
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/frame-times-offset.json", JSON.stringify(results, null, 2));
  console.log("FRAME TIMES (ms between frames):\n" + results.map((r) => `${r.name}: frames=${r.frames} p50=${r.p50} p95=${r.p95} max=${r.max}`).join("\n"));
  for (const r of results) expect(r.p95).toBeLessThan(60);
});
