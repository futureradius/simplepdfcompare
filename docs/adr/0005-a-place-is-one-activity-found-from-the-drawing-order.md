# A Place is one Activity, found from the drawing order

A **Place** is one **Activity**: its shape (a line, possibly with bends, or an outlined shape with its hatch), its leader and its label, in both Plans. Some Activities have neither leader nor label. Grouping Differences by nearness did not work on a real pair: neighbouring Activities touch corner to corner, and long link lines of the same colour cross the Plan, so nearness chained whole sequences into one Place. The Plan software draws each Activity in one go (white underlay, hatch, outline, centre line, symbols, label background, label, leader), so the drawing order separates them where the drawing cannot.

## Decision

- **Finding Activities** (once per Plan, when the comparison opens): an Activity starts at a hatched shape, a white underlay followed by a hatch with the same box. It takes the following objects of its colour (or white) that touch it (chained, within 0.6 mm), until the next start. It also takes:
  - a text block of that run within 5 mm (a label set beside its shape, without a leader);
  - any part of its colour inside its shape (a mark that does not reach the outline).
- **Shape and label:** the label begins at the first white label background followed by text. The shape comes before it in the drawing order (underlay, hatch, outline, symbols, link lines); the label, its leader and the tags after it come after.
- **Places:**
  - The Differences of one Activity form one Place. An Old and a New Activity are one Place when matched objects link them; a moved Activity is paired as before (ADR 0003).
  - Differences outside any Activity are grouped by Plan, colour and touching: a note over several lines is one Place, and so is a line Activity drawn without hatch.
  - km markers and dimensions (black, with text, drawn in their own pass) join the Activity Place they lie on, within 3 mm.
  - A pair whose Plans have no Activities drawn this way keeps grouping by nearness.
- **Name:** the Activity's own label, its longest text block. Following leader lines is needed only outside Activities.
- **Kind of change** comes from what really changed:
  - Später, Früher, Verlängert and Verkürzt are read from the shape alone.
  - A label that only changed text, or only moved (with its leader), is "Text geändert" or "Beschriftung verschoben".
  - Recoloured or thicker parts decide the kind only when nothing else changed. Then it is "Umgefärbt", or **"Strichstärke"** for a width change alone (a new kind). Their marks follow that filter, also inside a Place of another kind.
- **Matching, two refinements found on the real pair:**
  - A line at the same position is matched regardless of its width (most "Sonstiges" were lines drawn 0.2 → 0.3 mm, often recoloured too).
  - At the edge of the compared Body each Plan clips a shape differently, so there the same lines cut into other pieces also count as the same ink in another colour. Only at the edge: elsewhere a moved Activity can land on lines of another colour.

### Also decided in the same review (refines ADR 0003)

- **Keys:** hold Ctrl + Space (not Shift + Space) to see the Old Plan alone. Pressing Shift repeatedly turns on Windows Sticky Keys.
- **Table:** Wann and Wo are separate columns. Wo sorts by km. Both have a range filter (von / bis, like Excel's "between"; "wie Auswahl" takes the extent of the Places selected on the plan). The range is part of the filter, so a Vorlage keeps a region of interest. A Place shows when it overlaps the range.
- **Columns:** they are reordered by dragging their titles (kept in the browser, ↺ restores). Each has a minimum width; below it the list scrolls sideways instead of squeezing.
- **◀ ▶ fly to the next Place** (smooth zoom and pan, after van Wijk and Nuij, 2003) instead of jumping, so it shows whether the next change is near or elsewhere. Instant with "reduce motion".
- **Export:** Wann and Wo are separate columns.

## Considered Options

On a clipped real pair (6,030 Differences once side tables are ignored):

- **Nearness** (everything within about 5–10 mm, chained): 27 Places, the biggest with 4,913 Differences, up to 111 Activities in one Place.
- **Connected drawing of one colour** (the whole Plan): 141 Places, the biggest with 721; up to 19 Activities joined, 16 cut apart.
- **Drawing order** (chosen): about 220 Places, none holding two Activities of one Plan. With Umgefärbt and Strichstärke filtered out, most marks left are real changes (user).

## Consequences

- It depends on the Plan software drawing each Activity in one go, with a white underlay under each hatched shape. Plans from another producer may not; they fall back to nearness (see "A different producer" on the map).
- Finding the Activities takes about 0.4–0.6 s per Plan, once, when the comparison opens; grouping then takes about 40 ms. Places are formed only when the view reads them, never while the Offset is set.
- Naming no longer searches leader lines for every Place (16 s → 40 ms on the real pair).

Prototype (primary source, never merged): branch [`prototype/comparison-view`](https://github.com/futureradius/simplepdfcompare/tree/prototype/comparison-view), `prototypes/comparison/activities.mjs` and `prototypes/alignment/engine.mjs` (`quickCompare`).
