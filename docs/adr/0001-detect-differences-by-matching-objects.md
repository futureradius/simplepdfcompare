# Detect Differences by matching drawn objects, not by comparing pixels

Differences are found by matching every drawn object (line, area, hatched area, letter) of the Old Plan with an identical object of the New Plan at the same place once the Offset is applied. Whatever is left over is a Difference. We chose this over the producer-agnostic raster comparison because on the synthetic pair it was exact (all planted changes, no false alarms, about 0.4 s for the 14 m Plan), and on a real pair it left 7–11 % of the objects over, clustered where the schedule was edited.

## Considered Options

- **Tolerant raster diff** (render both Plans, mark ink with no ink in the other Plan within a tolerance): 12 s for the 14 m Plan; thousands of false alarms on dashed lines whose dash phase moves with the Body; blind to changed text on hatched areas; any tolerance hides moves smaller than itself; a Difference is a pixel region, not an object.
- **Hybrid** (objects find candidates, raster confirms): not needed, since object matching was clean on its own.

## Consequences

- Matching is exact, so it needs the exact Offset. The Offset is found automatically by voting over identical shapes, and the user confirms it.
- It trusts the producer to emit unchanged drawing as identical objects. On the real pair the coordinates were exact (a match tolerance from 0.05 to 0.5 mm changed nothing). A producer that splits or rounds objects differently would need a new look.
- A second pass that ignores colour finds recoloured objects, which count as Differences.
- Text is compared letter by letter and reported per word, so a changed word is marked, not the whole label.
