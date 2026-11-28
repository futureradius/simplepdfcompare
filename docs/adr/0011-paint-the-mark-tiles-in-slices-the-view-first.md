# Paint the mark tiles in slices, the view's tiles first

ADR 0010 caches the marks zoomed out as tiles and paints a missing tile inside a frame, one per frame at rest, the coarse levels ahead one tile per task. Each tile drew every mark it covers in one go, and the canvas then rasterized it all at once. After a filter change, hiding a Place (H), turning the marks back on (M) or a display setting, every tile was dropped and painted again that way. On a much larger real Plan, checked locally only, that meant several seconds of long main-thread tasks after each change, each up to a few seconds: the page did not answer, and the first scroll of the list stuttered. The synthetic `dense` pair (`npm run samples`) shows the same: up to a second per task, a dozen of them.

## Decision

- **A tile is painted in slices.** Painting a tile is a job of small steps: the marks in batches, the halos, the Unchanged part, the changed words and the x–x–x each in batches, the layers laid on one step each. A batch draws as many items as fit in about 5 ms. It is made to rasterize at once (a one-pixel read), so the time it really took is known and the next batch is sized from it (`BatchSizer`). A runner (`SliceRunner`) steps the jobs for about 10 ms (about 4 ms while the view moves), then gives the page back until the next task.
- **Tiles are painted on in-memory canvases.** Each job paints on canvases kept in memory (`willReadFrequently`), so the read after a batch never waits for the GPU. The finished tile is copied once onto a canvas of its own, which frames draw. Tile canvases are used again rather than made new: a new canvas for every tile cost pauses of a few hundred ms.
- **The view's tiles come first.** The tiles in view are painted from the middle of the view out, before any tile painted ahead. A tile painted ahead that is half done waits and then goes on where it stopped, because each lane paints on its own canvases. Painting ahead still waits while the view moves.
- **Nothing is dropped on a change, only outdated.** A change to what the tiles show (the shown marks, outline, x–x–x, rings) makes every tile outdated and stops the painting under way. Until a tile is painted again, a frame draws the best picture there is (`pictureFor`): another level's up-to-date tiles, else the outdated tile, else another level's outdated tiles. M, the base Plan and the fade are not in the tiles and outdate nothing.
- **Outlines.** A tile in view first makes the outlines it needs that are not made yet, one per step, for up to 150 ms. A tile painted ahead takes the rough ones and is painted again once all are made (ADR 0010).
- A sharp picture of a Plan no longer drops the tiles under it. It marks them to be painted again at rest, and they are drawn until then.

On the synthetic `dense` pair (`RESPONSIVE=1 npx playwright test e2e/responsive.spec.ts`, headless Edge, 1600 × 1000), no main-thread task lasts over 50 ms after a filter change, H, M or a display setting, or after the busy window. Before, a dozen tasks of up to a second followed each change. The view shows the change complete within a few hundred ms. Until then the outdated tiles show. Panning and zooming stay at 60 fps, as before.

## Considered Options

- **Painting the tiles in a worker (OffscreenCanvas).** This would take all of it off the main thread. But the marks, the outlines and the Plans' pictures (for the changed words) would have to live in the worker too, and a worker is no faster at showing the view's tiles. Slicing was enough.
- **Smaller tiles for the levels painted ahead.** This would split the work of one tile, but not the work of a level. A coarse tile in view still covers every mark, so it still needs slicing.
- **Hiding the outdated tiles until painted again.** The marks would vanish for a moment on every change. That is worse than the old marks for a few hundred ms.

## Consequences

- After a change, the old marks show for a moment (a few hundred ms on the dense pair, longer on a larger Plan) before the new ones appear. Where the tiles in view are painted one after another, they appear one after another, from the middle out.
- Painting takes a little longer in all, because of the reads between batches and the copy at the end, but none of it blocks.
- This amends ADR 0010, which said tiles are dropped on a change, a missing tile is painted inside a frame, and tiles ahead are painted whole.
