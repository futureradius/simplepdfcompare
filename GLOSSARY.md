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

**Header**
The band at the top of a Plan (title block, column titles, time axis). It sits in the
same place in both Plans.

**Footer**
The band at the bottom of a Plan (legend, stamp). Like the Header, it does not move
between versions, but it sits higher or lower on the page when the Plans have a
different number of Rows.

**Row**
One horizontal line of the schedule between Header and Footer: one activity with its
table cells and its bar or milestone. Rows can be inserted or deleted anywhere, which
shifts every Row below by different amounts.
_Avoid_: line (a line is a drawn stroke)

## Result

**Difference**
Something drawn in one Plan and missing in the other, once the Plans are aligned. It is
about the drawing, not the meaning: a bar that moved by three days shows up as one
Removed and one Added Difference, not as "moved".

**Added**
A Difference that is in the New Plan but not in the Old Plan. Shown in red.
_Avoid_: new, inserted

**Removed**
A Difference that is in the Old Plan but not in the New Plan. Shown in yellow, outlined
with a dashed x–x–x line, as demolition is marked in German construction drawings.
_Avoid_: deleted, old
