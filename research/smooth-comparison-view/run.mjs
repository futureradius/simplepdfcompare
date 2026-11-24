// RESEARCH (throwaway) for issue #11: runs the measurements headlessly in Edge.
//
//   npm run samples                     (the synthetic pair; never use real Plans here)
//   node research/smooth-comparison-view/run.mjs [all|bench|proto|mainThread|workers|compositing|sharp|bands] [--dense] [--headed]
//
// --dense: the bench on simplepdfclipper's generated Test Plan (~787k objects, the density
// of a real schedule) instead of this repo's pair; copy it first:
//   (in simplepdfclipper) npm run testplan  ->  samples/test-plan.pdf  ->  samples/sibling-test-plan.pdf here
//
// Playwright is borrowed from the sibling checkout (simplepdfclipper), as this repo has none.
import { serve } from "./serve.mjs";
import { protoBench } from "./proto-bench.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT || "file:///C:/code/simplepdfclipper/node_modules/playwright/index.mjs");
const what = process.argv[2] || "all";
const headless = !process.argv.includes("--headed");

const server = await serve();
const browser = await chromium.launch({ channel: "msedge", headless });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
page.on("pageerror", (e) => console.error("[page]", e));
const result = { browser: browser.version(), headless };
try {
  const sections = ["mainThread", "workers", "compositing", "sharp", "bands"];
  if (what === "bench" || what === "all" || sections.includes(what)) {
    await page.goto("http://127.0.0.1:5219/research/smooth-comparison-view/bench.html");
    await page.waitForFunction(() => typeof window.bench === "function");
    const src = process.argv.includes("--dense") ? "dense" : "down";
    result.bench = await page.evaluate(([w, s]) => window.bench(w, s), [sections.includes(what) ? [what] : sections, src]);
  }
  if (what === "proto" || what === "all") result.proto = await protoBench(page);
  result.gpu = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl");
    const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
    return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown", maxTextureSize: gl && gl.getParameter(gl.MAX_TEXTURE_SIZE) };
  });
} finally {
  console.log(JSON.stringify(result, null, 1));
  await browser.close();
  server.close();
}
