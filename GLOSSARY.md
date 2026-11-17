# simplepdfcompare: Glossary

A simple, offline, in-browser tool that opens two versions of a construction schedule
(vector PDF) and shows on screen what was added and what was removed between them.
Sibling of simplepdfclipper, whose glossary defines **Plan** and **UserUnit**.

## Inputs

**Plan**
One version of a schedule as a PDF: vector graphics and text, not scanned. Same meaning
as in simplepdfclipper.

**Old Plan**
The earlier version: the reference that the comparison starts from.
_Avoid_: original, base, A

**New Plan**
The later version that is checked against the Old Plan.
_Avoid_: revision, B

## Structure of a Plan

**Time direction**
The direction in which time runs on the Plan: downwards (the usual case here, a
time-distance diagram with time down and locations across) or to the right (a classic
bar chart). It decides which way the Body shifts between versions.

**Header**
The fixed band before the Body (at the top when time runs down): title, km or location
axis, column titles. Not compared.

**Footer**
The fixed band after the Body (at the bottom when time runs down): legend, stamp. Not
compared. It moves with the end of the Body, so each Plan has its own Footer position.

**Body**
The part of a Plan between Header and Footer, where the schedule itself is drawn,
including the time labels along its edge. The only part that is compared. Its length
differs between versions when they cover a different timespan.

**Activity**
A piece of work drawn in the Body, at a place over a span of time: a line, or a hatched
stripe, sometimes with a **foot** at its start and end for the staging area.
_Avoid_: bar (only one of its shapes), task

## Alignment

**Offset**
How far the New Plan's Body is shifted along the Time direction so that it lies exactly
on the Old Plan's Body. One Offset for the whole Body, set by the user by eye.
_Avoid_: shift, registration

**Overhang**
The part of one Body that has no counterpart in the other Body once the Offset is
applied, because that Plan covers a longer timespan. Shown, but not compared: it holds
no Differences.

## Result

**Difference**
Something drawn in one Plan and missing in the other, once the Plans are aligned. It is
about the drawing, not the meaning: an Activity that moved by three days shows up as one
Removed and one Added Difference, not as "moved".

**Added**
A Difference that is in the New Plan but not in the Old Plan. Shown in red.
_Avoid_: new, inserted

**Removed**
A Difference that is in the Old Plan but not in the New Plan. Shown in yellow, outlined
with a dashed x–x–x line, as demolition is marked in German construction drawings.
_Avoid_: deleted, old
