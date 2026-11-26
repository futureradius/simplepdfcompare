# Export every Place as an .xlsx table

The exported list of changes is an internal record: the user keeps one per comparison, so that later rounds can be set side by side (a process that slips with every update) and, some day, read back and laid over a newer Plan. So the export is a complete, sortable table of every Place, not a report of what the list happens to show. It is an .xlsx file, opened in LibreOffice Calc and in Excel. This refines the export in ADR 0003, which exported a CSV of the list as shown, with the filter applied and hidden Places left out.

## Decision

- **Format:** one .xlsx file with two sheets and no pictures.
- **Sheet "Änderungen":** one row per Place, for **every** Place, whatever the list's filter shows. The header row is frozen and has an autofilter. The rows are in the order of Nr. The columns are:

  `Nr | Was | vorher | Art | Um (Tage) | Von | Bis | km von | km bis | x (mm) | y (mm) | Ausgeblendet`

  - **Was:** the full name (ADR 0006), not cut at 40 characters.
  - **vorher:** the old text of a Label that changed ("Text geändert"); empty otherwise.
  - **Art:** the kind of change.
  - **Um (Tage):** decimal days with a sign: + for Später and Verlängert, − for Früher and Verkürzt, so that a slip adds up over the rounds. It is empty for the other kinds and when no time axis was read.
  - **Von / Bis:** date-and-time cells, empty when no time axis was read.
  - **km von / km bis:** numbers.
  - **x / y:** the top-left corner of the Place's box, in mm from the top-left corner of the New Plan's page, with one decimal. A Place only on the Old Plan is moved into the New Plan's frame by the Offset.
  - **Ausgeblendet:** "ja" for a Hidden Place, otherwise empty. A spreadsheet filter on it hides them again.
- **Sheet "Info":**
  - "Alter Plan" and "Neuer Plan", with their full file names. The Stand of each Plan is only what its file name says; the title block is not read.
  - the export date
  - the Offset in mm
  - the Time direction
  - the number of Places and of Hidden Places
- **File name:** `Änderungen <alter Plan> → <neuer Plan>.xlsx`, each Plan's file name without ".pdf", cut to its first 20 characters with no "…".
- **Across rounds,** Was is the key: Nr is only valid within one comparison.
- **Left out:** the debug columns of the prototype ("Name gefunden über", "Objekte", "Neu / weg", "Detail"), and the full setup (Header and Footer lines, Ignored areas, Axis zones), which would only serve reading an export back.

## Considered Options

- **CSV:** what the prototype wrote. It has no room for a head without breaking sorting, and its dates and decimal commas depend on the locale of whichever computer opens it. The same file has to work in LibreOffice Calc and in Excel.
- **A report (PDF / HTML) with the small pictures:** suits sending to others, but the list is for internal tracking, and a report can't be sorted or filtered.
- **The list as shown (filter applied, hidden Places left out):** each export would then hold a different, partial selection, and rounds could not be compared. Filtering is left to the spreadsheet.
- **Writing the full setup so a later version can restore the session:** reading an export back is out of scope for v1 ([Idea (after v1): reopen a comparison from its exported list](https://github.com/futureradius/simplepdfcompare/issues/17)). A format chosen before that feature is designed would probably be wrong, so exports made by v1 can't be reopened.

## Consequences

- An .xlsx has to be written offline in the browser: a small zip writer, or a library inlined into the single HTML file.
- Names, dates and km are only as good as the naming (ADR 0006). When the axes aren't read, Um, Von and Bis stay empty, and x / y still locate the Place.
- Positions in the New Plan's frame are what a later overlay on a newer Plan would need.
- The prototype still exports the old CSV; it is not changed.

Decided in [What should the exported list of changes contain?](https://github.com/futureradius/simplepdfcompare/issues/10).
