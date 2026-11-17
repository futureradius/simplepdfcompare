# How can two vector PDF pages be compared for drawn Differences in the browser?

Research for issue #3 (2026-11-17). Facts, not a decision: the decision is the
prototype ticket's (#4). Vocabulary as in [`GLOSSARY.md`](../GLOSSARY.md).

Sources are primary where possible: the MuPDF.js v1.28.1 typings and JS glue
(`node_modules/mupdf/dist/` in the sibling simplepdfclipper), MuPDF C source at tag
`1.28.1`, vendor manuals, tool source code. Numbers marked **[measured]** come from
experiments run for this note (see [Method](#method-of-the-experiments)).
Anything not checked against a primary source is marked **(unverified)**.

## Short answer

- MuPDF.js has **no comparison feature**. It provides the two building blocks:
  rendering any region of a display list to a pixmap with an arbitrary matrix, and a
  JS `Device` that receives every path, text, image, clip and tiling-pattern call with
  its transform and colour.
- Two families work in the browser, plus hybrids:
  1. **Raster diff** of both Plans rendered in the same frame (New translated by the
     Offset). An exact per-pixel diff is never clean, even when the geometry is
     identical; a **tolerance** (dilate one image by r px, then compare: a Hausdorff
     test) makes it clean, but hides real moves smaller than r.
  2. **Object matching**: fingerprint every drawn object (shape, paint, form relative
     to an anchor point) and match Old and New objects at `position − Offset`
     within a tolerance. On the Test Plan this is exact and fast, and it can
     **refine a by-eye Offset automatically**. Its failure modes come from the
     producer: objects split or merged differently, long lines whose length changes,
     things hidden under other things.
- **Hatching:** in PDF the pattern phase is tied to the page (pattern matrix ×
  the page's *initial* CTM), not to the hatched shape. If the producer moves a
  hatched stripe without moving its pattern origin, the stripe's hatch lines shift
  relative to the stripe after the Offset. A raster diff then sees the hatch as
  changed unless the tolerance is about half the hatch spacing. Object matching does
  not see it at all if it compares the stripe's outline and tile content and ignores
  the phase. Whether the real producer moves the origin with the stripe is
  **unknown**: it needs two real Plans.
- **Cost on the 14.27 m page [measured]:** display list 0.7 s per Plan. Raster:
  ~0.3–0.45 s per 11–16 Mpx band at 4 px/mm, so ~7 s per Plan for the whole page in
  17 bands, or ~0.3 s per Plan for just the visible area. Objects: ~1.3–2 s per Plan
  for a fingerprint walk of all ~787k objects, ~2 s to match them, 60 ms to refine
  the Offset.

## 1. MuPDF.js v1.28 facts

### Rendering a region at a chosen scale and translation

- `new DrawDevice(matrix, pixmap)` + `displayList.run(device, matrix)` draws into a
  `Pixmap(colorspace, bbox, alpha)`. The matrix can carry any scale and translation,
  so "New shifted by the Offset" is just a different `f` (y translation) in the
  matrix. The sibling does exactly this in `src/engine/core.ts` (`renderRegion`):
  `[s, 0, 0, s, -x0*s - xMm*pxPerMm, -y0*s - yMm*pxPerMm]`.
- `getPixels()` returns the raw bytes; `Pixmap.tint(black, white)`, `invert()`,
  `gamma()` and `convertToColorSpace()` exist (typings `mupdf.d.ts` l. 215–243).
- **No scissor in the JS API.** `wasm_run_display_list` calls
  `fz_run_display_list(..., fz_infinite_rect, NULL)` (`platform/wasm/lib/mupdf.c`
  l. 633–635 at 1.28.1). Every render walks the whole display list. The draw device
  then skips what lies outside the pixmap, so cost depends on the page, not only on the
  region. The sibling measured ~220 ms for that walk and ~300 ms for 2400 × 1500 px
  (its ADR 0003).
- Bounds include `/UserUnit`: the Test Plan's page bounds come out as 1188.9 ×
  14270.9 mm **[measured]**.
- The WASM build is wasm32 with `-sALLOW_MEMORY_GROWTH=1` and no explicit maximum
  (`platform/wasm/tools/build.sh` at 1.28.1). Emscripten's default ceiling with growth
  is 2 GB **(unverified for this build)**. A whole-page RGB pixmap at 4 px/mm would be
  4756 × 57084 × 3 B ≈ 0.8 GB per Plan, so whole-page rendering at that resolution
  has to be done in bands.

### Walking a page / display list with a custom Device

- `new mupdf.Device({...callbacks})` creates a JS device (`mupdf.js` l. 1240 ff.;
  C side `js_device` in `platform/wasm/lib/mupdf.c`). Callbacks (`DeviceFunctions`,
  typings l. 853 ff.):
  `fillPath(path, evenOdd, ctm, colorspace, color, alpha)`,
  `strokePath(path, stroke, ctm, colorspace, color, alpha)`, `clipPath`,
  `clipStrokePath`, `fillText(text, ctm, colorspace, color, alpha)`, `strokeText`,
  `clipText`, `ignoreText`, `fillShade(shade, ctm, alpha)`, `fillImage(image, ctm, alpha)`,
  `fillImageMask`, `clipImageMask`, `popClip`, `beginMask`/`endMask`,
  `beginGroup(bbox, cs, isolated, knockout, blendmode, alpha)`/`endGroup`,
  `beginTile(area, view, xstep, ystep, ctm, id, doc_id) → number`/`endTile`,
  `beginLayer`/`endLayer`, `close`, `drop`.
- Geometry stays in object space; the `ctm` maps it to device space. `Path.walk`
  gives `moveTo/lineTo/curveTo/closePath`. `Text.walk` gives
  `beginSpan(font, trm, wmode, …)`, `showGlyph(font, trm, gid, unicode, wmode, bidi)`
  and `endSpan`. `StrokeState` gives line width, caps, joins, dashes. Colour arrives
  as a colourspace plus a component array. `Image` gives size, colourspace and
  `toPixmap()`.
- Every callback wraps the C object in a new JS object (`new Path(...)`, `new
  StrokeState(...)`, `new ColorSpace(...)` in `globalThis.$libmupdf_device`,
  `mupdf.js` l. 3197 ff.). Each wrapper registers with a `FinalizationRegistry`
  (`Userdata`, l. 503 ff.). Calling `destroy()` on them inside the callback freed
  memory promptly: rss 249 MB vs 760+ MB without **[measured]**.
- **Tiling patterns** reach the device as `clipPath(shape)` → `beginTile(area, view,
  xstep, ystep, ctm)` → the tile's content once → `endTile` → `popClip`. `area` is in
  *pattern* space, `view` is the pattern BBox, and `ctm` maps pattern space to device
  space. This follows from `pdf_show_pattern` in `source/pdf/pdf-op-run.c` at 1.28.1:
  the cached-tile branch is taken when "a whole repeat is required in at least one
  direction", the pattern has no blending and the device has no `FZ_NO_TILING`
  hint. The JS API cannot set device hints. If `beginTile` returns 0 (the JS glue's
  default), the content is replayed. Otherwise MuPDF loops over the tiles itself and
  the device sees every repeat as an ordinary path. On the Test Plan, all 29 hatch
  zones arrived as `beginTile` with one `clipPath` each **[measured]**. The sibling's
  ADR 0011 notes the same pattern-space `area`.
- `StructuredText` (`page.toStructuredText(options)`) gives characters with quad,
  font, size and colour. With option `vectors` it also gives `onVector(bbox, flags,
  color)`: bounding boxes only, no geometry (`fz_parse_stext_options`,
  `source/fitz/stext-device.c` at 1.28.1).

### Anything built in for comparing?

No. The typings have no diff, compare or hash function. The closest building blocks:

- Blend modes on groups, including `"Difference"` and `"Multiply"` (`Device.BLEND_*`).
  In principle one could draw Old, open a `beginGroup(..., "Difference", 1)` on the
  same `DrawDevice`, draw New, and get |Old − New| computed in C **(untested)**.
- `Pixmap.tint` for Overlay-style colouring (Old → yellow, New → red, then multiply).
- In the browser, Canvas 2D `globalCompositeOperation` also offers `"difference"` and
  `"multiply"` (HTML spec, blend modes from W3C Compositing and Blending Level 1).

## 2. Measurements

Test Plan of the sibling (`npm run testplan`, 1188.9 × 14270.9 mm, /UserUnit 2.8092,
4.2 MB): 764,794 strokes, 5,413 fills, 17,356 text objects, 29 tiling-pattern fills,
5 images. These are 787,481 drawn objects, but only **6,232 distinct forms** once
position is factored out. Node 24.20 on the author's Windows 11 laptop, mupdf 1.28.1,
single thread. Edge should behave similarly (same V8/WASM) **(unverified)**.

| Step | Time | Note |
|---|---|---|
| Open + load page | 5 ms | |
| `toDisplayList` | 0.69–0.70 s | per Plan; matches sibling ADR 0003 |
| JS device walk, callbacks that only count | 1.26 s | JS↔WASM crossing ≈ 1.6 µs per call |
| Fingerprint walk (walk every path/glyph, hash) | 1.3–2.0 s | with `destroy()`; heap 29 MB, rss 249 MB |
| Object match Old ↔ New (787k each) | ~2.0–2.4 s | JS `Map`, string keys; not optimised |
| Offset refinement from a guess ±5 mm | 56–64 ms | see §3.2 |
| Render 4756 × 2400 px band (4 px/mm, 600 mm) | 0.32–0.45 s | |
| Render 16 Mpx band (4 px/mm, 841 mm) | 0.42 s | 17 bands per Plan → ~7 s per Plan |
| Render whole page at 1 px/mm (17 Mpx) | 0.64 s | 1 px/mm is too coarse for 0.12 mm lines |

Memory: an RGB pixmap costs 3 B/px (4 with alpha). A 1-byte ink mask of the whole page
at 4 px/mm is ~271 MB per Plan. At 2 px/mm it is ~68 MB.

## 3. Approaches and their failure modes

### 3.1 Raster diff

Render Old and New in the same frame: New's matrix translated by the Offset. Then
classify pixels: **Added** = ink in New and none in Old; **Removed** = the reverse.

Measured on a 600 mm band of the Test Plan (4 px/mm, 700,968 ink pixels). "New" was
the Old Plan's content moved 37.3 mm down with a `cm` (see §4). "Ink" means the
darkest channel is below 200. "Dilate r" means Old's ink is grown by r px before
testing New, and vice versa.

| Offset error | dilate 0 | dilate 1 px (0.25 mm) | dilate 2 px (0.5 mm) |
|---|---|---|---|
| 0 (geometry identical) | 3.9k / 4.4k px differ | 0 / 0 | 0 / 0 |
| 0.1 mm | 5.8k / 190k | 0 / 1.5k (band edge) | 0 / 1.5k (band edge) |
| 0.25 mm | 247k / 247k | 3.2k / 4.7k | 0 / 1.5k (band edge) |

(added / removed pixels; the remaining 1.5k is the strip at the band's edge that
has no counterpart, not a real failure.)

Failure modes, observed or from the sources:

- **No exact match even when the geometry is identical.** MuPDF works in single
  precision. At 14 m and 4 px/mm, device coordinates reach ~57,000 px, so the same
  edge anti-aliases slightly differently after a translation. Hence 0.6 % of ink
  pixels differ at "error 0" **[measured]**. Any raster method needs a tolerance.
- **Sensitivity to the Offset.** A by-eye Offset that is 0.25 mm off turns a third of
  all ink into Differences unless the tolerance is ≥ the error **[measured]**.
- **The tolerance hides real changes.** With dilate r, an Activity that moved by less
  than r, or a line that got slightly thicker, is not reported. This is the
  Hausdorff-distance trade-off: a dilate-and-test compare is a thresholded Hausdorff
  test (Huttenlocher, Klanderman, Rucklidge 1993).
- **Thin lines vs resolution.** The hatch strokes are 0.12 mm, i.e. 0.48 px at 4 px/mm.
  They survive as anti-aliased grey only because they are dark red. A light-grey
  hairline can fall under any ink threshold. Higher resolution costs quadratically,
  and every band costs a full display-list walk.
- **Occlusion.** Raster sees only what is visible: a change under an opaque label box
  is invisible. Painting-order changes are (correctly) not Differences.
- **Overlap of Added and Removed.** Where a moved bar overlaps its old position the
  overlapping part is "unchanged". The Difference shows as two partial shapes.
- **Text.** A changed digit shows as a few pixels. Small text needs ≥ ~4 px/mm to be
  legible as a Difference.
- **Pixels are not objects.** To draw a Removed outline (dashed x–x–x) or to list or
  jump to Differences, pixels must be grouped into regions afterwards (Bluebeam uses
  a grid of cells, see §5).

### 3.2 Object-level matching

Walk both display lists with a JS device. For each drawn object compute a
fingerprint: kind (fill/stroke/text/image), paint (colour, alpha, line width, dash),
form (all coordinates relative to its first point, quantised to 0.01 mm), and an
anchor (first point). For text use glyph unicodes, size and glyph offsets. Then
match New objects at `anchor − Offset` against Old objects with the same fingerprint
within a positional tolerance, as a multiset. Unmatched New = Added; unmatched
Old = Removed.

Results on the Test Plan, using the same shifted copy:

| Case | Added | Removed |
|---|---|---|
| exact Offset, tolerance 0.02 mm | 0 | 0 |
| Offset 0.05 or 0.2 mm off, tolerance 0.02 mm | 787,481 | 787,481 |
| Offset 0.05 or 0.2 mm off, tolerance 0.30 mm | 0 | 0 |
| Offset 1 mm off, tolerance 0.30 mm | all | all |

**Offset refinement** **[measured]**: start from a guess (0.8 mm or 3.2 mm off).
For every New object whose fingerprint occurs ≤ 200 times in Old, vote for
`dy = yNew − yOld` among Old objects with the same fingerprint, the same x (±0.02 mm)
and dy within ±5 mm of the guess. The histogram peak was exactly 37.30 mm with 19,642
votes, against a runner-up of 158, in ~60 ms. A by-eye Offset is then only a starting
point. Raster can do the same by cross-correlating the two images
**(not measured)**.

Failure modes:

- **Producer-dependent object boundaries.** The method assumes that the same drawing
  is emitted as the same objects. A new export may split a polyline differently,
  merge subpaths, change the order of points, use a rectangle instead of four lines,
  or split text spans at different places (kerning, font changes). Each such change
  becomes Removed + Added even though nothing visible changed. The Test Plan cannot
  show this: both "versions" come from one file. **Needs two real Plans (#4).**
- **Objects that span the Overlap boundary.** A line that runs the whole Body length
  (e.g. a location gridline along the Time direction) has a different length when
  the Plans cover different timespans. As one object it becomes Removed + Added in
  full. Fix: compare collinear segments as covered intervals, as the sibling already
  merges ~2,800 row pieces of one gridline (ADR 0003, Snap targets).
- **Coordinate rounding.** Quantisation boundaries need a neighbour search (done
  here) or tolerance-based matching. Real exports may round to a coarser grid than
  0.01 mm **(unverified)**.
- **Invisible objects count.** Objects fully covered by others, clipped away or drawn
  in white still match or differ. Clips must be applied (`clipPath`/`popClip` stack)
  or Differences may appear outside the visible drawing.
- **Many identical objects.** Grid pieces and symbols repeat thousands of times
  (787k objects → 6,232 forms). Matching must be a multiset with spatial
  indexing, not a key lookup.
- **Tiling patterns** must be fingerprinted as clip shape + tile content (+ phase,
  if wanted), not as their content (see §4).
- **Cost** grows with the object count, not with resolution. ~2 s walk + ~2 s match
  per pair on 787k objects in un-optimised JS **[measured]**.
- **Grouping for display** is easier than for raster: each Difference is an object
  with a shape that can be outlined, filled red or yellow, listed, and jumped to.

### 3.3 Hybrids

- **Objects find, raster shows:** match objects, then render only the unmatched
  objects (a filtered device that forwards only those to a `DrawDevice`) in red or
  yellow over a faint render of the Plan. This avoids pixel noise entirely. It
  inherits the object approach's producer sensitivity.
- **Raster finds, objects explain:** a tolerant raster diff gives candidate regions.
  Objects whose bbox meets a region are then reported or outlined. This is robust to
  re-segmentation, but has the tolerance trade-off.
- **Objects refine the Offset, raster compares.** Use object votes (§3.2) to turn
  the by-eye Offset into an exact one, then run a raster diff with a small
  tolerance (1 px).
- **Overlay without detection** (Bluebeam Overlay Pages): draw Old tinted yellow and
  New tinted red with multiply. Unchanged = dark, Differences = coloured. Zero
  detection logic, nothing to list or jump to, and the eye has to find small changes.

## 4. Hatching whose phase is tied to the page

**What the PDF format says.** The pattern matrix maps pattern space to the default
coordinate space of the pattern's parent content stream: the page, or the form
XObject. CTM changes inside the content stream (`cm`) do *not* move the pattern
(PDF Reference 1.7 §4.6.1 / ISO 32000-1 §8.7.3.1, paraphrased; corroborated by
iText/Apryse API docs). MuPDF implements this: `ptm = fz_concat(pat->matrix,
pat_gstate->ctm)`, where `pat_gstate` is the parent gstate recorded when the pattern
colour was set (`mat->gstate_num = pr->gparent`), not the CTM of the fill
(`pdf-op-run.c` at 1.28.1).

**What producers do.** The sibling found that the real schedule has one pattern
object per hatched area, "mostly the same tile with a different origin" (1,625
pattern definitions, 66 distinct contents; sibling ADR 0011). So the real producer
sets a per-area origin via `/Matrix`. **Unknown:** whether that origin moves with the
area between versions (zone-tied) or comes from a fixed grid (page-tied). Two real
Plans will tell.

**Experiment.** New = Old content wrapped in `q 1 0 0 1 0 −t cm … Q`
(t = Offset 37.3 mm). This moves every object but no pattern, i.e. **page-tied**
phase. A second copy also shifted every pattern `/Matrix` by t: **zone-tied**.
Observed tile phase along the time axis (mod the 1.5 mm cell): Old 1.000 mm;
page-tied New 1.200 mm (0.2 mm off); zone-tied New 1.001 mm **[measured]**.

| Approach | Zone-tied phase | Page-tied phase |
|---|---|---|
| Raster, no tolerance | only AA noise (3.9k px) | hatch differs (28k px at worst phase, Offset 36.75 mm) |
| Raster, dilate 1 px (0.25 mm) | clean | **6.3k px remain** at worst phase (all hatch) |
| Raster, dilate 2 px (0.5 mm) | clean | clean: tolerance ≥ ~half the line spacing (45° lines every 1.5 mm/√2 ≈ 1.06 mm) |
| Objects: clip shape + tile content | match | match |
| Objects: + phase (ctm translation mod step) | match | mismatch (only if phase is compared) |

So with page-tied hatching:

- a raster diff reports every unchanged hatched stripe as changed, unless its
  tolerance is about half the hatch spacing (~0.5 mm here). That also hides real
  moves below 0.5 mm;
- object matching ignores the problem if it compares the stripe's outline, paint
  and tile content and treats the phase as irrelevant;
- a hybrid can render pattern fills differently, e.g. as a flat tint of the clip
  shape, for the raster comparison only.

## 5. Prior art

| Tool | How it compares | Notes |
|---|---|---|
| **Bluebeam Revu – Compare Documents** | Raster: rasterises at a DPI (default 72, "144 for finer comparisons"). Splits the page into **Grid Size** cells; a cell differs when the share of differing pixels exceeds **Pixel Density**; **Color Sensitivity** and **Pixel Proximity Allowance** (looks at adjoining pixels) set the tolerance. Output: cloud markups. Alignment: auto, or an entered **Offset**. | Bluebeam recommends it for scanned/raster drawings ([manual: Compare documents](https://support.bluebeam.com/user-manual/menus/document/compare-documents.html)). |
| **Bluebeam Revu – Overlay Pages** | No detection: each PDF gets a colour, the layers are stacked and blend; where colours stack they "blend to create a darker color", so unchanged content is dark. Page Align / Auto Align / Manual Align (three points). | "Works well for PDFs with vector graphics" ([manual: Overlay pages](https://support.bluebeam.com/user-manual/menus/document/overlay-pages.html)). |
| **diff-pdf** (vslavik) | Raster via Poppler + Cairo at 300 dpi default; per-channel tolerance (`--channel-tolerance`, 0–255), per-page pixel count tolerance, `--dpi`. GUI can shift pages against each other with Ctrl+arrows. Output PDF marks differences. | Source: [`diff-pdf.cpp`](https://github.com/vslavik/diff-pdf/blob/master/diff-pdf.cpp). Our page at 300 dpi would be 14,042 × 168,554 px, beyond Cairo's 32,767 px image limit **(limit unverified here)**. |
| **vdiff** ([graphitedesignlabs/visualdiff](https://github.com/graphitedesignlabs/visualdiff)) | Raster: both PDFs to greyscale (ImageMagick/Ghostscript/Poppler), output with additions blue, subtractions red, unchanged grey. | Small shell tool. It is a guess that this is the "visualdiff" meant in the ticket. |
| **i-net PDFC** | Structural, "not pixel-by-pixel": compares text, lines, shapes, images with tolerances. "Standard" mode tolerates shifts caused by inserted elements, "strict" requires identical positions ([whitepaper](https://inetsoftware.de/en/i-net-pdfc/whitepaper)). | Its own limitations page: "Technical drawings will compare each line separately, parts and components cannot be identified"; diagrams are compared "as composition of lines and text" ([limitations](https://docs.inetsoftware.de/pdfc/help/pdfc.limitations/p/limitations)). |
| **Diff GT** (CSCI) | Hybrid: text at content level, "all graphical elements … with digital precision for visual differences" (pixel); deletions red, additions blue ([product page](https://www.csci.de/en/diffgt/)). | Notes that pure pixel comparison breaks on reflowed text. |

Papers: the tolerant raster compare is the classic Hausdorff-distance image comparison
(D. P. Huttenlocher, G. A. Klanderman, W. J. Rucklidge, "Comparing images using the
Hausdorff distance", IEEE TPAMI 15(9):850–863, 1993, doi:10.1109/34.232073). I found
no peer-reviewed paper on matching vector primitives between revisions of PDF
drawings. Cao, Li & Liang (Automation in Construction 14(3), 2005) extract version
*labels* from CADD drawings, not geometric changes. Vendor pages (Bluebeam, i-net,
Diff GT) are the main prior art. They split the same way: raster with grid/tolerance,
structural with tolerance, or overlay.

## 6. Speed and memory on the 14 m page (summary)

- Per Plan once: display list 0.7 s.
- Raster, visible area only: ~0.3 s per Plan per view at ~3–4 Mpx. That is two renders
  per view change, plus the pixel pass. A full-page Difference overview at 4 px/mm is
  2 × 17 bands × ~0.42 s ≈ 14 s plus the pixel passes. The memory limit forces bands
  (0.8 GB RGB per Plan at 4 px/mm).
- Objects, whole page: fingerprint walk 1.3–2 s per Plan, match ~2 s (un-optimised),
  Offset refinement 60 ms. Memory stays small if wrappers are `destroy()`ed
  (heap 29 MB, rss 249 MB). Changing the Offset only repeats the match, not the
  walks.
- All of this runs in the Web Worker (sibling ADR 0010 has a main-thread fallback for
  file://).

## Method of the experiments

Scripts (not committed) ran in Node 24.20 against the sibling's
`node_modules/mupdf` 1.28.1 and `samples/test-plan.pdf`. "New" Plans were made with
MuPDF.js itself. The page's `/Contents` was wrapped in `q 1 0 0 1 0 −t cm … Q`, with
t = Offset in default user-space units (mm / (25.4/72) / UserUnit). For the zone-tied
variant, each `/Pattern`'s `/Matrix` f was also reduced by t. Both copies shift the
*whole* page, Header included, and are otherwise identical to Old. They test alignment,
noise and pattern phase, **not** how a real producer re-exports a changed schedule.

## Implications for the decision

Viable approaches, with trade-offs (no choice made here; that is #4):

1. **Tolerant raster diff** (render both in the same frame, dilate r px, classify
   ink).
   - **+** Producer-agnostic and simple. It sees exactly what is drawn, including
     length changes of long lines, and is immune to object re-segmentation.
   - **−** Needs a tolerance; noise appears even at perfect alignment. Hides changes
     below r. Page-tied hatching needs r ≈ half the hatch spacing. Every band or view
     re-walks the whole display list. A full-page overview takes ~14 s at 4 px/mm.
     Differences are pixels and must be grouped into regions for outlines and
     navigation.
2. **Object matching** (fingerprints + spatial multiset match at `− Offset`).
   - **+** Exact and noise-free on identical geometry. A few seconds for the whole
     page. Can refine the by-eye Offset automatically. Ignores hatch phase if
     designed to. Each Difference is a shape that can be outlined, listed and
     jumped to.
   - **−** Trusts that the producer emits unchanged drawing as unchanged objects
     (unknown until tested on two real Plans). Long lines crossing the Overhang need
     interval logic. Clips and occlusion need handling. More code.
3. **Hybrid**: objects for the Offset and for candidates, raster for confirmation or
   display; or raster for candidates, objects to outline them. Combines robustness
   and exactness at the cost of building both.
4. **Overlay only** (tinted Old and New, multiply): trivial and fast, honest about
   what is drawn. But it detects nothing, so there is nothing to list or count, and
   small changes on a 14 m page are easy to miss.

Open facts that only two real Plans can settle (input for #4): whether unchanged
Activities come out as identical objects across exports, whether the hatch pattern
origin moves with the stripe, and how much a by-eye Offset is off.
