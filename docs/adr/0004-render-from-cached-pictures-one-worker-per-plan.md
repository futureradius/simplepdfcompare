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
- Not yet measured on real Plans: how many hatch pattern cells they have (the synthetic
  pair's zoomed-out cost is almost all hatch cells). The research branch has a counts-only
  check for two local PDFs.

Findings and measurements: branch `research/smooth-comparison-view`,
`research/smooth-comparison-view.md` (ticket "How does the comparison view stay smooth on a
14 m Plan?", #11).
