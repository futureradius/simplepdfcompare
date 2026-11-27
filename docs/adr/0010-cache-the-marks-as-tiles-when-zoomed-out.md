# Cache the marks as tiles when zoomed out

ADR 0004 draws the Differences every frame as vector shapes. On a full-size Plan with many Differences that does not hold: zoomed out, rasterizing every mark (and the x–x–x) every frame took a few hundred ms, so a zoom showed a new picture only every few hundred ms. Zoomed in, few marks are in view and live drawing stays fast.

## Decision

- **Zoomed out, the marks are pictures.** Up to 2 device px per mm they are painted once into tiles of 1024 px at levels 2^¼ apart, and a frame only draws those tiles, as it does with the Plans' pictures. Zoomed in further, the marks are still drawn live.
- **Sizes kept on screen stay within ±9 %.** A tile sizes the outline, the x–x–x and the thinnest line for the middle of the zooms it is drawn at. Thin lines are a little softer than live, as the Plans' pictures are.
- **Nothing waits for a tile.**
  - While the view moves, a missing tile is stood in for by the nearest level's tiles that are there. At rest, one missing tile is painted per frame.
  - The levels that show the whole Plan in a few tiles are painted ahead while the view rests, and rasterized then, so that the first zoom out does not pay for them.
- **Tiles follow what they show.**
  - They are dropped when the filter, hiding or the display settings change (not for the base Plan or the fade, which lie under them).
  - Tiles sharper than a Plan's overview are painted again when a sharp picture of that Plan arrives, for the changed words' own ink.
  - Tiles painted before all outlines were made are painted again at rest.
- **The outlines** (one per Place and colour, ADR 0003) are made once each: as many as fit in 250 ms while the busy window is up, the rest in short slices while the view rests. Outlines smaller than a ring on screen are left to the ring; those that are not made yet show as the rounded box around their marks.

Measured in headless Edge (1600 × 1000, `e2e/frames.spec.ts` with `FRAMES=1`): zooming and panning the synthetic 14 m pair stay at 60 fps with no dropped frames. A much larger real Plan, checked locally only, now also stays at 60 fps zoomed out, where it took a few hundred ms a frame before.

## Considered Options

- **Drawing fewer marks zoomed out** (skip those under a pixel): the cost is rasterizing, and most marks are larger than a pixel at Planbreite.
- **One picture per zoom, re-painted at rest**: a full repaint costs a 300 ms stall on the first move after rest.
- **Painting the tiles in a worker (OffscreenCanvas)**: would keep even the first tile off the main thread. Not needed at the measured cost; it would need the marks and outlines in the worker as well.

## Consequences

- Up to 40 tiles are kept (4 MB each), the least recently drawn dropped first; painting ahead leaves room for the tiles in view.
- A tile painted with rough outlines shows them as rounded boxes for a few seconds after "Vergleichen" on a very large Plan, until all outlines are made.
