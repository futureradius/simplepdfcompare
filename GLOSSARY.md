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

**Ignored area**
A part of the Body that is not compared, like the Header and Footer: usually a
sidebar along the whole Body, sometimes a single box. It is usually in the same place in
every version of a Plan, but not always.
_Avoid_: mask, exclusion, sidebar (only one kind)

**Body**
The part of a Plan between Header and Footer, where the schedule itself is drawn,
including the time labels along its edge. The only part that is compared. Its length
differs between versions when they cover a different timespan.

**Activity**
A piece of work drawn in the Body, at a place over a span of time: a line, or a hatched
stripe, sometimes with a **foot** at its start and end for the staging area.
_Avoid_: bar (only one of its shapes), task

**Label**
The text that names an Activity, often over several lines, with a leader line to its
shape or set beside it. It is the name of the Activity's Place.
_Avoid_: caption, annotation

**Axis zone**
A part of the Plan the user marks in step 2 to say where the time axis (dates, hours),
the location axis (km) or the row names (on a bar chart) are: Zeitachse, Wegachse,
Vorgänge. Only read, never left out of the comparison. Optional: without it they are
found by search.

## Alignment

**Snap**
While a Header or Footer line or an edge of an Ignored area is dragged, it jumps to a
straight line drawn in the Plan nearby, as Clip edges do in simplepdfclipper. Alt drags
without it.

**Offset**
How far the New Plan's Body is shifted along the Time direction so that it lies exactly
on the Old Plan's Body. One Offset for the whole Body, found from the drawing and
confirmed by the user. Often 0, when both Plans cover the same timespan.
_Avoid_: shift, registration

**Overhang**
The part of one Body that has no counterpart in the other Body once the Offset is
applied, because that Plan covers a longer timespan. Shown, but not compared: it holds
no Differences.

## Result

**Difference**
A drawn object or a word that is not identical in both Plans once they are aligned: it
moved, changed shape or colour, appeared, disappeared, or its text changed. It is about
the drawing, not the meaning: an Activity that moved by three days shows as its Removed
part, its Added part and its Unchanged part, not as "moved".

**Added**
The part of a Difference that only the New Plan draws; also a recoloured object and a
new or replaced word. Shown in red.
_Avoid_: new, inserted

**Removed**
The part of a Difference that only the Old Plan draws; also a deleted word or a word
that only lost letters. Shown in yellow, outlined with a dashed x–x–x line, as
demolition is marked in German construction drawings.
_Avoid_: deleted, old

**Unchanged part**
The part of a Difference that both Plans draw in the same place, such as the common
stretch of a hatched stripe that was extended. Shown in a neutral grey.
_Avoid_: overlap, kept

## Comparison

**Place**
The Differences of one Activity, looked at as one: its shape, leader and label (and the
km markers on it), in both Plans; "Stelle" in the user interface. Outside any Activity, a
note or a line drawn in one colour is a Place of its own. A Place that only lost drawing
and one that only gained the same drawing elsewhere are one Place: something moved.
_Avoid_: issue, item, hit

**Kind of change**
What happened at a Place, read from its drawing: later, earlier, longer, shorter, moved
across, text changed, label moved, new, gone, recoloured, thicker or thinner lines, or
other (Später, Früher, Verlängert, Verkürzt, Quer verschoben, Text geändert, Beschriftung
verschoben, Neu, Entfallen, Umgefärbt, Strichstärke, Sonstiges). Timing is read from the
Activity's shape, never from its label or leader. A Place can have several: its **main
kind**, and the kinds of the parts that changed beside it (recoloured, thicker, its label);
each part of a Place has one kind.
_Avoid_: category, type

**Hidden Place**
A Place the user marked as no real change: left out of the plan and the list until
shown again, but kept in the export, marked as hidden. Unlike an Ignored area, it was
compared.
_Avoid_: deleted, ignored
