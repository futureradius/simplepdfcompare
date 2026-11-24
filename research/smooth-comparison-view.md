# How does the comparison view stay smooth on a 14 m Plan?

Research for issue #11 (2026-11-24). It covers the rendering setup for v1, with measured costs,
and ends with a [draft ADR](#draft-adr-0004). Vocabulary as in [`GLOSSARY.md`](../GLOSSARY.md).

Numbers marked **[measured]** come from the scripts in
[`research/smooth-comparison-view/`](smooth-comparison-view/), run in Edge 158 (headless,
GPU: Intel Iris Xe via ANGLE/D3D11, 16 logical cores) on this machine. The viewport is
1600 × 1000 device px (DPR 1) unless noted. Each number is the median of 3–5 runs, and runs
vary by about ±20 %. Raw output: [`results-synthetic-pair.json`](smooth-comparison-view/results-synthetic-pair.json),
[`results-dense-test-plan.json`](smooth-comparison-view/results-dense-test-plan.json).
Claims not checked against a source or a measurement are marked **(unverified)**.

Two inputs, both generated; no real Plan was opened:

- **Synthetic pair**: `samples/down-old.pdf` and `down-new.pdf` from `npm run samples`
  (1189 × 13,710 / 13,990 mm, Offset 560 mm). It has 50k drawn objects and 19k glyphs, plus
  **244 hatch patterns with 238k pattern cells**.
- **Dense Test Plan**: simplepdfclipper's generated stand-in for a real schedule
  (`npm run testplan` there, copied to `samples/sibling-test-plan.pdf`; used as both Old and
  New). It is 1189 × 14,271 mm with **787k drawn objects** and 180k glyphs, but only 29 hatch
  patterns (10k cells). Its density matches what is known of the real Plans: the detection
  ticket measured ~1.5 s per real Plan for the object pass (ADR 0001); this Plan's pass takes
  1.3 s **[measured]**.

## Short answer

The prototype is slow for two reasons. **Every frame renders both Plans again** with MuPDF on
the main thread. **Then a per-pixel loop paints the marks.** Fixing each in turn:

1. **MuPDF in Web Workers, one per Plan.** The page never blocks, and the two Plans render
   in parallel (1.6–1.8× faster than one worker doing both) **[measured]**. This is the
   sibling's worker (its ADR 0004/0010), copied with one change: two instances.
2. **A cached overview per Plan, plus the sibling's sharp layer, not a tile pyramid.**
   Each Plan is rendered whole once, at about 0.5 px/mm (4 Mpx, 17 MB; 0.27 s for both on the
   pair, 0.76 s on the dense Plan). While panning and zooming, every frame is just the
   cached bitmaps drawn by the GPU: **60 fps, under 1 ms of JavaScript per frame**
   **[measured]**. Views zoomed out to 0.5 px/mm or less never render again. Further in, the
   view plus a 25 % margin is rendered sharp once it rests 120 ms (sibling `viewer.ts`).
   A tile pyramid does not fit MuPDF.js: every render walks the whole display list
   (there is no scissor), so a 512 px tile costs as much as a whole view. One pyramid level at
   1.31 px/mm would take 38 s per dense Plan **[measured]**.
3. **Band display lists**: each Plan's display list is cut along the time axis into ~14
   bands (about 1 m each), so a render walks only the 1–2 bands it touches. On the dense Plan
   this cuts a sharp view from 243 ms to 50 ms and a thumbnail from 227 ms to 16 ms per Plan
   **[measured]**. The bands are built in one pass of a JS `Device`
   (1.2 s per Plan), which can be the same pass that extracts objects for the comparison.
   Without bands, the dense Plan costs ~0.4 s per sharp render and ~0.25 s per thumbnail per
   Plan, and the worker cannot be interrupted while one runs.
4. **Marks as vector shapes drawn by the canvas**, every frame, on top of the cached
   bitmaps. GPU compositing replaces the per-pixel loop: "darken" combines both Plans,
   "destination-in" finds the grey shared part, and "screen" tints the ink of changed words.
   A full frame with marks costs 6–9 ms including waiting for the GPU, against 36 ms for the
   prototype's marks alone on top of its 0.7 s render **[measured]**.
5. **Thumbnails rendered in the workers** (with bands, ~16 ms per Plan on the dense Plan,
   2 ms on the pair) at lower priority than the view. Marks are drawn on top as vectors.
   A crop of the cached overview can stand in until the render arrives. Cutting thumbnails
   from cached renders alone is not enough: the overview is 4× too coarse for a thumbnail
   (~2 px/mm), and the sharp layer covers only the current view.
6. **Do not skip sub-pixel objects.** On the pair, dropping objects under 1, 3 or 15 mm
   changes nothing: the zoomed-out cost is the 238k hatch cells (dropping the hatches:
   346 → 35 ms). On the dense Plan, dropping objects under 15 mm (96 % of them) does cut a
   whole-Plan render from 459 to 77 ms. The cached overview makes that unnecessary, and at
   overview resolution those objects are visible.

Expected frame times on the 14 m Plan with this setup **[measured parts, summed]**:

| What the user does | Synthetic pair | Dense Test Plan |
|---|---|---|
| Pan / zoom / Space peek / fade, any zoom | 60 fps, < 1 ms JS + marks (≤ 9 ms incl. GPU) | same |
| Sharp picture after the view rests (zoomed in beyond 0.5 px/mm) | 120 ms delay + ~35–75 ms (less with bands) | 120 ms + ~60 ms with bands (~390 ms without) |
| Whole Plan in view | no render (overview) | no render (overview) |
| One list thumbnail, both Plans | ~2 ms with bands (17 ms without) | ~16 ms with bands (~230 ms without) |
| Once, when the Plans open (in the workers) | display list 50 ms + overview ~0.25 s per Plan, in parallel | display list 0.7 s + overview 0.5 s + bands 1.2 s per Plan, in parallel |

## 1. Where the time goes

### The prototype (main thread)

[`prototypes/comparison/common.mjs`](../prototypes/comparison/common.mjs) on
`prototype/comparison-view` uses `compareViewer()` → `alignment/viewer.mjs`. The viewer shows
the last picture scaled while moving, then `render()` calls `paint()` 80–120 ms after the
last move. `paint()` renders both Plans with `renderGray()` on the main thread
(`alignment/engine.mjs`), then `paintCompare()` loops over every pixel. Two
`OffscreenCanvas` masks are read back with `getImageData`, and changed words get their own
pixel loops. A cache (`layerCache`) only helps when the view did not move.

On the synthetic pair, in the prototype page **[measured]**:

| Step | Whole Plan (0.066 px/mm) | Body across (1.31 px/mm) |
|---|---|---|
| `renderGray` both Plans, main thread | 692 ms | 70 ms |
| `paintCompare` without marks (fade loop) | 4.3 ms | 4.6 ms |
| `paintCompare` with marks | 36 ms | 37 ms |
| `drawThumb` (one list thumbnail) | 55 ms | |

This agrees with the issue's table (332 + 315 ms whole, 64 ms per thumbnail).

### MuPDF render cost: walk + rasterise, and it does not shrink with the pixel count

| Render, one Plan, in a worker | Synthetic pair | Dense Test Plan |
|---|---|---|
| Display list from the page (`toDisplayList`) | 49 ms | 694 ms |
| Walk only (16 × 16 px region) | 21 ms | 239 ms |
| Whole Plan in a 1600 × 1000 view | ~320 ms | ~450 ms |
| Body across, 1600 × 1000 | ~37 ms | ~255 ms |
| 1:1 (3.78 px/mm), 1600 × 1000 | ~24 ms | ~245 ms |
| Whole Plan at 0.125 / 0.5 / 1 px/mm (0.3 / 4 / 17 Mpx) | 279 / 246 / 315 ms | 488 / 505 / 530 ms |
| 512 × 512 tile, any scale | 20–35 ms | 240–260 ms |

- **Every render walks the whole display list.** MuPDF.js has no scissor:
  `DisplayList.run(device, matrix)` calls `_wasm_run_display_list` with only a device and a
  matrix (`node_modules/mupdf/dist/mupdf.js`, `class DisplayList`, `run`). The C side runs
  the list with an infinite rect (shown at tag 1.28.1 in
  [`research/vector-pdf-diff.md`](https://github.com/futureradius/simplepdfcompare/blob/research/vector-pdf-diff/research/vector-pdf-diff.md#1-mupdfjs-v128-facts)).
  The sibling measured the same, ~220 ms on its Test Plan (simplepdfclipper ADR 0003). On
  the dense Plan this floor, ~240 ms, is the cost of *any* render, even 16 × 16 px.
- **Zoomed out on the pair, the hatches dominate.** It has 244 tiling patterns covering
  238k pattern cells. A copy of the display list without them renders the whole Plan in
  35 ms instead of 346 ms (Body across: 29 instead of 41 ms) **[measured]**. A cell costs
  the same however small it is drawn, so the whole-Plan view pays for all 238k cells. The
  dense Plan has only 10k cells, and dropping them changes little there (463 → 435 ms).
  **How many hatch cells real Plans have is unknown** (see [open questions](#open-questions)).
- **Pixel count matters little.** RGBA and gray cost the same (gray is not cheaper). Copying
  the pixels out of the WASM heap is 2.5 ms for 1600 × 1000 RGBA. Transferring the buffer
  and `createImageBitmap(new ImageData(…))` add another 2.6 ms. A gray render needs an
  RGBA expansion loop first (+8 ms), so the worker should render RGBA, as the sibling does.

## 2. Web Workers: one per Plan

- The sibling runs MuPDF in a module worker (simplepdfclipper ADR 0004 "Consequences", ADR
  0008, `src/engine/worker.ts`, `src/engine/client.ts`). From `file://`, Edge refuses module
  workers from `blob:` URLs but accepts `data:` URLs, so `createEngineWorker()` forces Vite's
  inline worker to its `data:` path. If that fails too, the engine falls back to the main
  thread (ADR 0010). This carries over unchanged.
- Results come back as transferred `ArrayBuffer`s. MDN: "the memory resource that it points
  to is *literally* moved between contexts in a fast and efficient zero-copy operation"
  ([Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)).
  The round trip adds ~3 ms to a 1600 × 1000 render **[measured]**.
- **Two workers, one per Plan, render in parallel** **[measured]**:

  | Both Plans, 1600 × 1000 | one worker, one after the other | two workers in parallel |
  |---|---|---|
  | Pair, whole Plan | 638 ms | 410 ms |
  | Pair, Body across | 75 ms | 46 ms |
  | Dense, whole Plan | 894 ms | 527 ms |
  | Dense, Body across | 514 ms | 375 ms |

  Each worker holds its own MuPDF instance. Starting one takes ~60–80 ms here; the dev
  server serves the `.wasm`. The sibling's single-file build decodes the inlined WASM once
  per worker (`decodeWasm()` in `client.ts`). A compiled `WebAssembly.Module` "can be
  efficiently shared with Workers"
  ([MDN](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Module)),
  and the MuPDF Emscripten glue honours an `instantiateWasm` hook
  (`mupdf-wasm.js`), so compiling once is possible. That path is **(unverified)**.
  Memory per instance was not measured **(unverified)**.
- A worker call cannot be interrupted (sibling ADR 0012, "Busy window"). The worst queued
  job decides how long a view waits. Hence bands (§4), and a small queue with priorities
  (view first, then thumbnails) that drops outdated view requests, like the sibling's
  `rendering` / `renderAgain` flags in `renderSharp()`.
- The comparison's object extraction (`prototypes/detection/extract.mjs`, a JS `Device`
  pass) also belongs in each Plan's worker, so the two Plans are extracted in parallel.
  Matching needs both Plans and runs after that. Where matching runs is not part of this
  ticket.

## 3. Cached overview + sharp layer (the sibling's viewer), not a tile pyramid

What the sibling does (`src/ui/viewer.ts` at c7c9666):

- `setPlan(widthMm, heightMm, overview)`: the overview `ImageBitmap` is the base layer. It
  comes from `renderPreview()` in `src/engine/core.ts`, which renders the whole Plan
  800 px wide, about 0.67 px/mm for a 1189 mm wide Plan.
- `viewUpdated()` redraws at once from the layers it has (via `requestAnimationFrame`).
  After `RENDER_DELAY_MS = 120` it calls `renderSharp()`. That returns early when the
  overview is sharp enough (`want <= this.base.pxPerMm * 1.01`) or when a kept layer already
  covers the view at the needed scale. Otherwise it renders the visible area plus a 25 %
  margin, shrinking the margin to stay under `MAX_RENDER_PIXELS = 16_000_000`.
- It keeps up to `KEEP_LAYERS = 4` sharp layers, evicting the oldest while the total is over
  `KEEP_PIXELS = 4 × 16 Mpx`. `draw()` paints the base, then the layers from coarse to sharp,
  with `imageSmoothingQuality = "high"`. A render that comes back for an older Plan is
  dropped.
- The minimap (`src/ui/minimap.ts`) draws the same overview bitmap (`drawImage(preview…)`),
  at most 1/3 of the view (`MINIMAP_SHARE`), hidden while the whole Plan is in view
  (`showsWholePlan`).

Measured for the comparison (both Plans' bitmaps drawn every frame: white, Old, New with
`"darken"` = the darker of the two, then a white veil for "Plan blass"):

| Frame from cached bitmaps, 90 frames of panning | rAF rate | JS per frame | incl. waiting for GPU |
|---|---|---|---|
| Overview 0.5 px/mm, whole Plan | 60 fps | 0.2–0.5 ms | 2–3 ms |
| Overview 0.5 px/mm scaled up to Body across, smoothing "high" | 60 fps | 0.2 ms | 30 ms |
| Same, smoothing "low" | 60 fps | 0.2 ms | 8 ms |
| Sharp layer at 1:1 (view + 25 %) | 60 fps | 0.1 ms | 2.7 ms |

"darken" "retains the darkest pixels of both layers"
([MDN globalCompositeOperation](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/globalCompositeOperation)).
For grey ink on white that is the prototype's `Math.min(gO, gN)`, done by the GPU.
Smoothing "high" holds 60 fps but costs far more GPU time when scaling up 2.6×. Use
"medium" or "low" while moving and "high" only at rest **(only "high" and "low" measured)**.

Cost of the overview, per Plan, once **[measured]**:

| Overview | Size | Bitmap memory | Render (pair / dense) |
|---|---|---|---|
| 0.25 px/mm | 297 × 3568 | 4 MB | 227 / 469 ms |
| **0.5 px/mm** | 594 × 7135 | 17 MB | 246 / 505 ms |
| 1 px/mm | 1189 × 14,271 | 68 MB | 315 / 530 ms |

Both overviews in two workers in parallel: 266 ms (pair), 756 ms (dense). **0.5 px/mm**
(or the sibling's 800 px width, 0.67 px/mm) is the sweet spot. Up to 0.5 device px/mm,
which covers the whole Plan and most of the zoom range below "Body across", no render is
needed at all. Rendering finer costs little more time but 4× the memory. Edge on this
machine reports a WebGL `MAX_TEXTURE_SIZE` of 16,384 **[measured]**. Keep each bitmap's
sides under that: 14,271 px still worked. MDN only says that exceeding the canvas maximum
"renders the canvas unusable"
([`<canvas>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/canvas)),
and the Chromium source checked (`html_canvas_element.cc`) has no explicit area constant.

The sharp layer (view + 25 % margin, both Plans in parallel) **[measured]**:

| | DPR 1 (2400 × 1500) | DPR 1.5 (3600 × 2250) |
|---|---|---|
| Pair, 0.6 px/mm | 74 ms | 83 ms |
| Pair, Body across | 54 ms | 73 ms |
| Dense, Body across, full list | 388 ms | 355 ms |
| Dense, Body across, 14 bands | ~60 ms per Plan (§4) | (not measured) |

Memory to watch: at DPR 1.5 one sharp layer is 32 MB per Plan. With two Plans the sibling's
4-layer budget would reach ~260 MB. Two kept layers per Plan are enough for going back and
forth.

**Why not a tile pyramid / tile cache.** Tiles pay off when a tile costs less than a view.
With no scissor, a 512 × 512 tile costs 20–35 ms on the pair and 240–260 ms on the dense
Plan, about the same as a whole view. Covering the dense Plan **[measured, extrapolated]**:
28 tiles at 0.5 px/mm take 7 s, 148 at 1.31 px/mm take 38 s, and 954 at 1:1 take 228 s.
Rendering that ahead would keep the worker busy for minutes; the user also asked that
nothing heavy run before its result is shown. Rendering tiles on demand still pays the walk
for every tile in view. With band lists (§4) a tile would cost ~1/14 of the walk, but one
view-sized render per rest, cached as a layer, is still simpler and as fast. The overview is
the "cached overview for the whole Plan" the issue asks for.

## 4. Band display lists: cutting the walk

`DisplayListDevice` records into a new `DisplayList`, and a JS `Device` receives every
drawing call (`mupdf.d.ts`: `class DisplayListDevice`, `interface DeviceFunctions`). So one
pass over a Plan's list can forward each object to the band lists its box reaches. Clips,
groups, masks and tiles go to every band, so nesting stays intact. To render, run only the
bands that overlap the region, each inside a clip to its band, so an object in two bands is
not drawn twice (`bands()` and `renderBands()` in
[`worker.mjs`](smooth-comparison-view/worker.mjs)).

Measured on the dense Test Plan, one Plan **[measured]**:

| Render | Full list | 14 bands (1.02 m each) | 28 bands |
|---|---|---|---|
| Build (one pass) | | 1.2 s | 1.2 s |
| 0.6 px/mm, view | 257 ms | 62 ms (2 bands) | 62 ms (4) |
| Body across, view | 243 ms | 50 ms (2) | 33 ms (2) |
| Body across, view + 25 % | 252 ms | 60 ms (2) | 62 ms (4) |
| 1:1, view | 230 ms | 38 ms (2) | 25 ms (2) |
| Thumbnail 220 × 150 at 2 px/mm | 227 ms | 16 ms (1) | 9.5 ms (1) |
| Pixels differing from the full list (Body across, 6.4 M bytes) | | 10 bytes, max 10/255 | same |

On the pair the walk is cheap anyway (Body across 33 → 18 ms; thumbnail 17 → 1.6 ms), and
22k bytes differ by at most 12/255 where hatches meet a band edge (anti-aliasing, invisible).

- The build costs about as much as the plain object pass (census: 1.3 s). Done in the same
  `Device` pass as the comparison's object extraction, it adds little: the bounds
  (`getBounds`) and the JS callback per object are the bulk, and the extraction pays for
  those anyway. That combined pass is **(unverified)**: the extraction code was not changed.
- Bands are cut along the Time direction (the long side), so a view at a working zoom
  touches 1–2 bands. With Time direction → (the "right" Plans, ~0.6 m long) bands matter
  little; cut along the long side.
- The whole-Plan overview still walks everything once (~0.5 s per dense Plan). That is the
  one render bands cannot help.

## 5. Marks: vector overlay, not a per-pixel loop

`paintCompare()` costs 31–33 ms more with marks than without, at any zoom, because it reads
back two full-view masks and blends every pixel (`common.mjs` l. 207–332). The same picture
from canvas operations ([`proto-bench.mjs`](smooth-comparison-view/proto-bench.mjs),
`vectorFrame`) **[measured]**:

- Plans: cached bitmaps, "darken", white veil (as in §3).
- Changed objects: Removed on one layer (yellow), Added on another (red). Both are drawn
  onto the view, then their overlap is turned grey for the "Unchanged part": a third layer
  takes a copy of the Removed layer, `"destination-in"` with the Added layer, then a
  `"source-in"` grey fill. Halos are the same paths stroked wider at 30 % opacity.
- Changed words: inside the word's box, the Plan's own bitmap with the mark colour on top
  in `"screen"` mode. Screen inverts, multiplies and inverts again (MDN), so black ink takes
  the colour and white stays white: the glyphs are tinted with no pixel loop.
- The x–x–x outline is already canvas paths in the prototype (`setLineDash`,
  `"destination-out"`, × strokes). It moves over unchanged, minus the final `getImageData`.

| Synthetic pair | Prototype `paintCompare` with marks | Vector frame (Plans + marks + words) |
|---|---|---|
| Whole Plan, 71 items | 36 ms (+ 692 ms render) | 8.6 ms incl. waiting for the GPU |
| Body across, 16 items | 37 ms (+ 70 ms render) | 6.3 ms |

This runs every frame, so the marks move with the picture while panning instead of
appearing 120 ms later. The cost grows with the number of visible marks. With many marks
(say thousands), cache the marks layer per rested view like a sharp layer **(unverified;
not measured beyond 71 items)**. WebGL is not needed at these counts. Avoid `getImageData`
on the view canvas: MDN notes that frequent read-backs (`willReadFrequently`) "force the use
of a software … 2D canvas"
([getContext](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext)).

## 6. Thumbnails

The prototype's `drawThumb()` renders both Plans on the main thread: 55 ms each **[measured]**.

- In a worker with bands, a 220 × 150 thumbnail at 2 px/mm costs 16 ms per Plan (dense) or
  under 2 ms (pair). Without bands it costs ~230 ms (dense) or 17 ms (pair) **[measured]**.
- Cutting from cached renders works only as a stand-in. The overview has 0.5 px/mm, a
  thumbnail wants ~2 px/mm (4× blurry). The sharp layer covers only the current view, so
  it can serve a thumbnail only for a place inside it.
- So: the prototype's `IntersectionObserver` queue (variant A) sends thumbnail jobs to both
  workers at lower priority than view renders. It shows an overview crop at once and
  swaps in the sharp one, with marks drawn on top as vectors (§5). Cache per place and the
  settings that change the picture, as the prototype's `thumbKey` does. 12 places cost
  ~0.2 s of worker time on the dense Plan with bands, ~2.8 s without.

## 7. Skipping objects smaller than a pixel

Measured with a coarse display list that leaves out every object whose box is smaller than
a threshold in both directions (`coarse()` in `worker.mjs`) **[measured]**:

| Dropped | Pair: objects / whole-Plan render | Dense: objects / whole-Plan render |
|---|---|---|
| none | 50k / 346 ms | 787k / 459 ms |
| < 1 mm | 0 / no change | 0 / no change |
| < 3 mm | 30 / no change | 1.4k / no change |
| < 15 mm (1 px of the whole view) | 2.9k / 336 ms | 759k / **77 ms** |
| hatch patterns | 244 / **35 ms** | 29 / 435 ms |

The median object is 37 mm on the pair and 5 mm on the dense Plan. Skipping helps only for
the whole-Plan view of a dense Plan. That view is served by the cached overview, rendered
once at 0.5 px/mm (2 mm per pixel), where those objects are visible and dropping them would
change the picture. **Not worth it for v1.**

## 8. What to copy from simplepdfclipper

| Sibling file | Take | Change for simplepdfcompare |
|---|---|---|
| `src/engine/client.ts` | Worker start, `data:` URL workaround on `file://`, main-thread fallback, id-based `call()` with transfer | Two engines (Old, New); a small priority queue (view before thumbnails, drop stale view jobs) |
| `src/engine/worker.ts`, `protocol.ts` | Dispatch with transferred pixel buffers | Ops: open Plan, overview, render region (through bands), extract objects + build bands in one pass |
| `src/engine/core.ts` | `renderRegion()` (RGBA, `DrawDevice` matrix in mm), `renderPreview()`, display list once at open | Run band lists for regions; overview by px/mm (≈ 0.5–0.67) and capped at 16,384 px per side |
| `src/ui/viewer.ts` | Layer model (base overview + sharp layers), `renderSharp()` (120 ms, 25 % margin, 16 Mpx cap, coalescing, stale check), rAF `draw()` | Two Plans' layers per frame ("darken", fade veil, Space peek picks one); New Plan's layers drawn at +Offset; vector marks overlay; at most 2 layers per Plan; smoothing "low"/"medium" while moving. Left-drag selects (comparison ADR 0003) instead of panning. |
| `src/ui/minimap.ts` | Size rules, hidden while the whole Plan is in view, click / drag to pan | Draw the overview of the Plan shown under the marks |
| `src/ui/busy.ts` | Busy window for opening Plans and comparing | none |
| Vite single-file build (`virtual:mupdf-wasm`, inline worker; ADR 0010) | As is | none |

Render each Plan in its own page mm and apply the Offset only when drawing (a translation).
Then confirming a different Offset, Space / Shift + Space, the "Plan blass" slider and the
base switch (Alt / Neu / Beide) cost no render at all. The setup steps (ADR 0002) show each
Plan whole too and can use the same overview from the start.

## Open questions

- **Real Plans' hatch cells and walk floor.** The pair is hatch-heavy, the dense Test Plan
  object-heavy; real Plans may be either. This is a counts-only check, like the detection
  ticket's: [`bench.html`](smooth-comparison-view/bench.html) has two file inputs. Serve it
  with `node research/smooth-comparison-view/serve.mjs`, open
  `http://127.0.0.1:5219/research/smooth-comparison-view/bench.html`, pick an Old and a New
  Plan and press "Measure". It shows only timings, counts (objects, glyphs, hatch patterns
  and cells, objects per size) and page sizes in mm. The PDFs are read by the browser and
  never reach the server.
- **If a real Plan's overview is slow** (many hatch cells), its first render could draw each
  hatch flat in its average tone when the cells are below a pixel. That would replace a tile
  in the coarse list with a fill of its area. Not needed if the one-off ~0.5 s is acceptable.
- Memory of two MuPDF instances holding a dense Plan each, plus band lists **(not measured)**.
- Headless Edge with the GPU on; a headed window on a DPR 1.25–1.5 laptop screen renders
  1.5–2.3× the pixels. The sharp-layer row above shows that costs +10–40 % on the pair and
  nothing on the dense Plan, where the walk dominates.

## Draft ADR 0004

> Not added to `docs/adr/`; the parent ticket records the decision.

```markdown
# Render the comparison view from cached pictures, with MuPDF in one worker per Plan

The comparison view stays smooth on a 14 m Plan by never rendering on the main thread and
almost never while the view moves. Each Plan has its own Web Worker with MuPDF.js (as in
simplepdfclipper, ADR 0004/0010). When a Plan opens, its worker builds the display list,
renders a whole-Plan overview at about 0.5 px/mm, and cuts the display list into about
14 bands along the Time direction, in the same pass that extracts objects for the
comparison. The viewer is simplepdfclipper's: every frame draws the cached overview and
sharp layers of both Plans with the GPU ("darken" for both Plans, a white veil for the
fade), the New Plan moved by the Offset. 120 ms after the view rests, the visible area plus
25 % is rendered sharp through the bands it touches. Differences are drawn every frame as
vector shapes on top, never by a per-pixel loop. List thumbnails are rendered in the
workers at lower priority, with an overview crop until they arrive.

Measured in Edge on the synthetic 14 m pair and on simplepdfclipper's denser Test Plan
(787k objects): panning and zooming run at 60 fps with under 1 ms of JavaScript per frame;
a frame with marks takes 6–9 ms; a sharp view arrives about 60 ms after the delay (bands,
dense Plan; about 390 ms without bands); a thumbnail costs about 16 ms per Plan.

## Considered Options

- **Render both Plans for every view on the main thread** (prototype): 0.7 s per
  zoomed-out frame, page blocked.
- **One worker for both Plans**: no blocking, but the Plans render one after the other
  (1.6–1.8× slower than two workers).
- **Tile cache / zoom pyramid**: MuPDF.js has no scissor, so every tile walks the whole
  display list; a 512 px tile costs as much as a whole view, and one zoom level of the
  dense Plan would take 38 s.
- **Skipping objects smaller than a pixel when zoomed out**: no effect on the synthetic
  pair (its zoomed-out cost is hatch pattern cells); on the dense Plan it helps only the
  whole-Plan view, which the cached overview already covers.
- **WebGL for the marks**: not needed at the measured counts; canvas paths and
  composite operations are fast enough.

## Consequences

- Opening a Plan takes longer up front (dense Plan: display list 0.7 s, overview 0.5 s,
  bands 1.2 s, both Plans in parallel), shown in the busy window; afterwards no
  interaction waits on MuPDF.
- Changing the Offset, Space / Shift + Space, the fade and the base Plan need no render.
- Two MuPDF instances use twice the memory; sharp layers are capped at two per Plan.
- A worker call cannot be interrupted, so jobs stay small (bands) and the queue puts the
  view before thumbnails and drops outdated view requests.
```

## Method

`node research/smooth-comparison-view/run.mjs [all|bench|proto|…] [--dense]` starts the
local server (`serve.mjs`, 127.0.0.1, static files only, synthetic samples only), launches
Edge through the sibling's Playwright, and prints JSON.

- `bench.mjs` + `worker.mjs`: main-thread vs one worker vs two workers per view; walk-only
  render; bitmap conversion; overviews; 512 px tiles; thumbnails; census of objects, glyphs
  and hatch cells; coarse lists (small objects or hatches dropped); compositing frame rate;
  sharp layer with margin at DPR 1 and 1.5; band lists with a pixel check against the full
  list.
- `proto-bench.mjs`: opens the prototype (`view.html?demo=down&go=1`), waits for the
  comparison, then times `renderGray`, `paintCompare` with and without marks, `drawThumb`,
  and the vector replacement `vectorFrame`.

## Sources

- MuPDF.js 1.28.1: `node_modules/mupdf/dist/mupdf.d.ts` (`DisplayList.run`,
  `DisplayListDevice`, `Device` callbacks, `Path.getBounds`), `mupdf.js` (`run` →
  `_wasm_run_display_list`; `$libmupdf_wasm_Module`), `mupdf-wasm.js` (`instantiateWasm`).
- simplepdfclipper at c7c9666: `src/ui/viewer.ts`, `src/ui/minimap.ts`,
  `src/engine/{client,worker,core,protocol}.ts`, `docs/adr/0003`, `0004`, `0008`, `0010`,
  `0012`, `CONTEXT.md` ("Test Plan"), `scripts/make-test-plan.mjs`.
- This repo: `prototypes/comparison/common.mjs`, `prototypes/alignment/{viewer,engine,shared}.mjs`,
  `prototypes/detection/extract.mjs` (branch `prototype/comparison-view`); ADR 0001–0003;
  `research/vector-pdf-diff.md` (branch `research/vector-pdf-diff`).
- MDN: [Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects),
  [createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap),
  [globalCompositeOperation](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/globalCompositeOperation),
  [getContext (willReadFrequently)](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext),
  [WebAssembly.Module](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Module),
  [`<canvas>` maximum size](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/canvas).
- Chromium: `third_party/blink/renderer/core/html/canvas/html_canvas_element.cc` (no
  explicit maximum-area constant; per-side parse limit only).
