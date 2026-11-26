# Set up a comparison in four steps before comparing

Before anything is compared, the user goes through four steps that unlock one after another: **Time direction**, **Old Plan** (Header, Footer and Ignored areas), **New Plan** (the same areas, copied from the Old Plan) and **Offset**. Only then does the comparison open. We chose a guided sequence over one screen that does everything, because each step shows exactly one question on one full view of the Plan, and a 14 m Plan leaves no room for a second view next to it.

## Decision

- **Start page:** a short introduction, two boxes for the Old and New Plan (drop a file or click). Full file names stay readable, even very long ones. A swap button between the boxes fixes a pair picked the wrong way round, and "Weiter" starts the setup.
- **Steps:** done steps and the current one can be clicked; later steps are greyed out until the one before is confirmed. "Vergleichen" is available from the Offset step. Going back does not lock later steps again.
- **1 Time direction:** suggested from the page shape (tall: down, wide: right). One view of a Plan with an Old/New switch (the words themselves are the switch) and a swap bubble, next to the file name.
- **2 Old Plan:** one full view, freely zoomable, no Difference marks. Header, Footer and each Ignored area are zones, shaded blue, with a name tag, their size in mm and a separate × bubble that deletes them.
  - The Header and Footer lines are always shown as thick blue lines, even when their zone is deleted. Pull the line from the Plan's edge to bring the zone back.
  - Dragging anywhere draws a free zone. Its edges and corners have handles like the Clip in simplepdfclipper, and dragging inside moves it. A ⇕ bubble stretches it over the whole length of the Plan (a sidebar) and back.
  - **Snap:** Header and Footer lines snap to lines that run across the Plan. Zone edges snap to a drawn straight line at least 2 mm long (not text) that runs alongside the edge within 8 px. An amber guide shows the snap, and Alt switches it off.
  - Reset: back to the detected Header and Footer, with no other zones.
- **3 New Plan:** the same view of the New Plan. The Old Plan's zones are copied: the Header with the same height, the Footer with the same distance from the end (it moves with the end of the Body), and the other areas at the same place on the page. Where the zones lay in the Old Plan is shown hatched with a dashed outline and labelled "alter Plan". Reset copies them again.
- **4 Offset:** one view of both Plans on top of each other. Ink both Plans share is grey to black, ink only the Old Plan has is blue, ink only the New Plan has is red. The detected candidates are buttons with a bar for their match count. The Offset is set by dragging the Plan (it snaps to the candidates, Alt: free), with ±0.1/1/10 mm buttons, the arrow keys, or by typing.
- **Navigation in every view:** the wheel zooms. A left drag edits (draws or changes a zone, slides the Plan), so panning is the right or middle mouse button. (Space + drag panned at first; ADR 0003 dropped it, as Space now shows the New Plan.) This differs from simplepdfclipper, where a left drag pans.
- **Work only when it is needed:** the Offset search and the comparison start at the Offset step and stop when the user goes back. Rerunning them after every change in step 2 cost about 0.5 s on the 14 m Plan and made editing zones lag.
- **Remembered** in the browser for the next pair: the Time direction, the Header height, the Footer's distance from the end and the Old Plan's Ignored areas (boxes relative to the Header line). The Offset is not remembered; it is found anew for every pair.

## Considered Options

- **Side by side** (both Plans next to each other, scrolled together by the Offset, slid against each other at a grip in the gap; a dashed line under the pointer runs through both): every edit possible on one screen, but each Plan gets half the width.
- **No setup step** (one overlay that opens with guessed lines and the detected Offset, Differences marked live, corrected in place): fastest when the guesses are right, but everything happens on one crowded view, and recomputing after each edit makes it sluggish.

## Consequences

- An Ignored box inside the Body keeps its page position in the New Plan. When the Offset is not 0, it covers different drawing in each Plan, and the drawing that crosses its edges shows up as Differences. This has not been seen on real Plans; it is left as it is until it is.
- Snapping needs an index of straight segments per Plan; it is built once, on first use.

Prototype (primary source, never merged): branch [`prototype/alignment`](https://github.com/futureradius/simplepdfcompare/tree/prototype/alignment), `prototypes/alignment/`, variant A.
