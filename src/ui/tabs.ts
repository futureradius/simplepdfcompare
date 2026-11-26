// The tabs of the sidebar (ADR 0009, ADR 0002): a tab can be clicked once the one before it
// is confirmed; later ones are greyed out; going back locks nothing. Pure logic, unit-tested.

import type { Direction } from "./direction";

export type TabId = "open" | "old" | "new" | "offset" | "compare";
export const TABS: readonly TabId[] = ["open", "old", "new", "offset", "compare"];

/** The reach is the index of the furthest tab that can be clicked. */
export type Reach = number;

export const initialReach = (): Reach => 0;

export const isTabEnabled = (tab: TabId, reach: Reach): boolean => TABS.indexOf(tab) <= reach;

/** Confirming a tab unlocks the next one. Confirming an earlier tab again changes nothing. */
export function confirmTab(reach: Reach, tab: TabId): Reach {
  return Math.min(TABS.length - 1, Math.max(reach, TABS.indexOf(tab) + 1));
}

/** A change in "Öffnen" locks every tab after it again. */
export const lockAfterOpen = (_reach: Reach): Reach => 0;

/** What "Öffnen" decided: which page of which file is the Old and the New Plan, and the Time direction. */
export interface OpenSignature {
  old: { file: string; page: number } | undefined;
  new: { file: string; page: number } | undefined;
  direction: Direction;
}

const same = (a: OpenSignature["old"], b: OpenSignature["old"]) => a?.file === b?.file && a?.page === b?.page;

/** True when a file, a page, the order or the direction differs. */
export const signatureChanged = (a: OpenSignature, b: OpenSignature): boolean =>
  !same(a.old, b.old) || !same(a.new, b.new) || a.direction !== b.direction;
