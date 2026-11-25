# Name a Place by its Activity's label, and place it on the axes

Each Place in the list says *what* changed (the process, "Gleis 1 erneuern"), not only *how* (the kind of change). Since a Place is one Activity (ADR 0005), its name is the Activity's own **Label**, read whole. Where no Label can be found, the Place is named by its shape. Every Place is also placed on the Plan's axes: when (dates and hours) and where (km), and amounts are given in days and hours instead of mm.

## Decision

- **Name, in this order:**
  1. The Activity's own Label, from whichever Plan has one (the New Plan first). An Activity with no Label next to its shape takes the first Label in its colour that is drawn with it, within 30 mm.
  2. For an Activity without a Label, and for Differences outside any Activity: the text at the free end of a leader line in the same colour, else a text beside it (within 3 mm).
  3. A Label that changed on its own is named by its own text (the New one; the Old one as "vorher") and is placed where its leader leads back to.
  4. On a bar chart (time runs right, or with a Vorgänge zone): the row in the Header across from it. The text by the bar is then only a note.
  5. Otherwise its shape and where it lies: "Schraffur km 12,2–17,5, 03.06.–12.07.27" (Rechteck, Linie, Linienzug, Fläche, Schraffur, Raute, Kreis, Oval only when clearly oval, Text).
- **A Label is read whole,** over several lines. Lines belong to one Label when:
  - they have the same text size and colour;
  - they line up (same left edge, or centred on each other) and are at most 1 mm apart;
  - they follow each other in the drawing order (at most 4 objects apart).

  Every line has its own white background, so a background between two lines does not end the Label. Pieces on one line are joined only at the same text size, so an hour mark on the line is not part of the name. A single letter, a bare number, a km marker ("km 12,0 + 86") or a dimension is never a name.
- **Long names** are cut at 40 characters with "…"; the full name shows on hover and in the export.
- **When and where** come from the Plan's own axes:
  - **Dates** from the date labels along the time axis (TT.MM.JJ, KW, month and year), fitted to a scale in mm per day. **Hours** from the hour labels in a Zeitachse zone: each way a label can stand for its grid line is tried, and the consistent one closest to the dates wins.
  - **km** from Bahn-km labels ("12,0 + 86") or km inside upright Header labels. Where the scale changes between sections (squeezed on open track, stretched in stations), km are interpolated between neighbouring marks.
  - Wann shows a date range with times when a start or end is not on a day boundary ("03.06. 22:00 – 04.06.27 05:00"); Wo shows "km 12,4–15,6".
- **Amounts** of Später, Früher, Verlängert and Verkürzt are in days and hours ("1 Tag 8 Std.", "7 Std.") once the time axis is read, otherwise in mm. They snap to whole days only within 0.05 mm.
- **Axis zones (optional, step 2):** the user may mark a **Zeitachse**, a **Wegachse** and **Vorgänge** (row names) as light red zones. Dates, hours, km and rows are then read only there; without them they are found by search. Axis zones are only read, never left out of the comparison; Ignored areas may overlap them (a date column inside an ignored side strip).
- **The list is a table:** Nr | Was | Art | Um | Wann | Wo (refines ADR 0003). It sorts like Excel: a click makes a column the main key and keeps the earlier order inside it, and only the column clicked last shows its arrow. A Place keeps its number, and ◀ ▶ follow the table's order.

## Considered Options

- **Following the leader line for every Place** (before Places were Activities): it found the right name for few Places on the real pair. Labels span several lines and only one was taken, and Places mixed Activities. It also took 16 s on the real pair. Once a Place was one Activity, its own Label replaced it (40 ms), and leaders are followed only where there is no Label.
- **Three ways to show the name** (name first, one sentence, table): the table won, as it sorts and filters by Wann and Wo.
- **The Header row as the name** on a time-distance diagram: the Header text across from a Place is a km section, not its process. It is used only on bar charts or with a Vorgänge zone.

On the clipped real pair, 206 of 215 Places are named: 145 by their Activity's Label, 38 by a changed Label's own text, 13 by a text beside, 10 by a leader. The other 9 have no Label at all (unlabelled hatches, lines across the Plan at one moment) and are named by shape and place. All 215 have a date range and a km range.

## Consequences

- Names, dates and km depend on how the Plan software sets its labels and axes. Another producer may need other patterns (see "A different producer" on the map).
- Naming runs once when the comparison opens, about 0.2 s on the real pair, after the Activities are found (ADR 0005).
- Two Labels of different Activities stacked right on top of each other, in one colour and drawn one after the other, would read as one name. It did not happen on the real pair.
- What the export carries (full name, old text, dates and km as numbers) is still open: [What should the exported list of changes contain?](https://github.com/futureradius/simplepdfcompare/issues/10).

Prototype (primary source, never merged): branch [`prototype/comparison-view`](https://github.com/futureradius/simplepdfcompare/tree/prototype/comparison-view), `prototypes/comparison/naming.mjs`, `common.mjs` (`nameOne`), `activities.mjs` (`labelOf`), naming rounds 1–5.
