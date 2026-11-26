# A Place carries every kind of change it has

A Place is one Activity (ADR 0005), and one Activity can change in several ways at once: it can start later and be recoloured, or have its label edited and its lines drawn thicker. Until now a Place had one kind of change, and its other changes could be filtered only through their marks. On a clipped real pair, 23 of 215 Places had more than one kind. In almost all of them the second kind was a recolour or a new line width beside the main change; in a few it was a label moved beside a changed shape.

## Decision

- **Every kind a Place has:** each Place has a **main kind**, decided as in ADR 0005 (timing from the shape; recolour and line width only when nothing else changed). It also lists every other kind it has. Each part of the Place has exactly one kind:
  - a recoloured part is Umgefärbt;
  - a part only drawn thicker or thinner is Strichstärke;
  - the label, leader and tags beside a changed shape are Text geändert or Beschriftung verschoben;
  - everything else has the main kind.
- **The filter matches any kind.** A Place shows when any of its kinds is checked. Each mark follows its own kind: with only Umgefärbt checked, a Place that is new and partly recoloured shows only its recoloured parts. The counts in the filter list count the Places that have that kind anywhere, so they can add up to more than the total. A line above the list says so.
- **The Art column** shows the main kind, then the others as small tags ("+ Umgefärbt"). A tag whose kind is filtered out stays in the row, struck through, so a Place never hides that it changed in another way too.
- Presets (Vorlagen) and the Wann / Wo ranges work as before; a preset such as "Nur Terminänderungen" now also hides the recolour and label marks inside the Places it keeps.

## Considered Options

- **Main kind plus "Auch":** the main kind alone decides whether a Place shows. Side changes get their own column and their own checkboxes that switch only their marks. Simpler counts, but "show me everything recoloured" misses the Places where the recolour is a side change (6 of 84 on the real pair).
- **One row per kind:** a Place with several kinds is split into rows (12a, 12b …), each with only its own marks, and the filter stays one kind per row. The list then counts rows, not Places (240 rows for 215 Places), and one Activity is selected, hidden and exported in pieces.

## Consequences

- "Sonstiges" is left for shapes that changed in no way the tool can name (one Place on the real pair), not for Places with several changes.
- The export's Art column (ADR 0007) lists every kind, the main one first ("Später, Umgefärbt"), whatever the filter. Um, Von and Bis still describe the main kind.
- Hiding works on the whole Place, as before.

Prototype (primary source, never merged): branch [`prototype/comparison-view`](https://github.com/futureradius/simplepdfcompare/tree/prototype/comparison-view), `prototypes/comparison/`, `?filt=A` (B and C are the considered options).
