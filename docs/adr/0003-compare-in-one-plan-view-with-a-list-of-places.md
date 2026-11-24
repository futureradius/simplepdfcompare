# Compare in one plan view with a list of Places

After the four setup steps (ADR 0002), the comparison opens as one view of the whole Plan with all Differences marked, and a sidebar that lists the **Places**: Differences that lie together, each with the **kind of change** it is. We chose one view plus a list over stepping through one Place at a time (the list is the overview a 14 m Plan needs) and over the Old and New Plan side by side (half the width each, and twice the rendering, which made it sluggish).

## Decision

- **Marks** as decided in ADR 0001: the object itself, Added red, Removed yellow, the Unchanged part grey. Removed is outlined with the dashed **x–x–x** line by default (a soft yellow outline can be chosen instead). The outline width (0–50 px) and the size of the x are set by the user; they stay the same on screen at any zoom, and Places smaller than 18 px get a ring, so nothing vanishes when zoomed out.
- **Under the marks** the New Plan, faded (Old, New or both can be chosen). Holding **Space** shows only the New Plan without marks, **Shift + Space** only the Old Plan.
- **Not compared** parts stay visible but dimmed: Header and Footer, and the **Overhang**, hatched and labelled "nur im neuen Plan" / "nur im alten Plan".
- **Places and kinds of change.** Differences that touch or lie a few mm apart form one Place, however long it is. A Place that only lost drawing and one that only gained the same drawing elsewhere are one Place: something moved. Each Place gets one kind of change from its geometry along and across the Time direction: Später, Früher (moved, same length), Verlängert, Verkürzt, Quer verschoben, Text geändert (an edit to a label in both Plans), Neu, Entfallen (also a whole label that appears or disappears, as it belongs to an Activity), Umgefärbt, Sonstiges. Amounts are in mm on the Plan for now.
- **Sidebar:** the count; a **Filter** by kind of change with a checkbox list like Excel's, and presets ("Vorlage") as in simplepdfclipper; the list of Places with a small picture each; display settings folded away and remembered in the browser. The sidebar can be dragged wider or narrower, down to the width the smallest pictures need.
- **Bottom bar:** ◀ ▶ with the selected Place's number and kind of change between them, at a fixed width so the arrows stay under the pointer. A strip along the view's edge shows every Place along the time axis.
- **Selection:** one set of Places, shared by list and plan, which may be empty. A click selects (in the list it also moves the plan there; on the plan the view stays). In the list, Ctrl and Shift work as in Windows Explorer. On the plan, a box selects as in CAD: dragged to the right it takes what lies fully inside, to the left what it touches; Shift adds, Ctrl removes. A click on empty plan or Esc clears it.
- **Hiding:** a Place that is no real change can be hidden (H, or the button on its row, for the whole selection). It leaves the plan, the list, ◀ ▶ and the export; the plan does not move and nothing stays selected. Hidden Places can be listed and shown again.
- **Export:** while comparing, the top-right button exports the list as shown (filter applied, hidden Places left out) as a table for Excel. This widens the scope, which had ruled out any export: exporting the marked drawing stays out.
- **Mouse:** the wheel zooms, the right or middle button pans, the left button selects. Space no longer pans anywhere, which changes ADR 0002.

## Considered Options

- **Stelle für Stelle:** always zoomed to one Place, big ◀ ▶ on top, a filmstrip of pictures below. Focused, but no overview; its pictures went into the list.
- **Alt | Neu:** the two Plans side by side, panned and zoomed together, a cross mirroring the pointer. Clear for a single Place, but half the width each and noticeably laggy.

## Consequences

- Naming what changed (the process, or its shape and place on the axes, and days instead of mm) is its own question, as are the export's contents and keeping the view smooth on a 14 m Plan (a zoomed-out frame took about 0.7 s in the prototype).
- Hidden Places are kept for the session and pair only, by kind and position, so they survive a rerun of the comparison but not a reload.

Prototype (primary source, never merged): branch [`prototype/comparison-view`](https://github.com/futureradius/simplepdfcompare/tree/prototype/comparison-view), `prototypes/comparison/`, variant A.
