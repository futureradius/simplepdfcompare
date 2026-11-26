// Opening the two Plans: which box a dropped file fills, swapping, and when the page
// picker opens. Pure logic, no DOM (unit-tested).

export type Role = "old" | "new";

export interface Sides<T> {
  old: T;
  new: T;
}

const ORDER: Role[] = ["old", "new"];

/**
 * Which boxes the dropped files fill, in the order of the files. A PDF dropped anywhere
 * fills the first empty box; two dropped at once fill both, in order. Files beyond the
 * empty boxes are ignored. A single file dropped on a box replaces that box (`onBox`).
 */
export function dropTargets(filled: Sides<boolean>, fileCount: number, onBox?: Role): Role[] {
  if (fileCount === 1 && onBox) return [onBox];
  return ORDER.filter((r) => !filled[r]).slice(0, fileCount);
}

/** The Old and the New side exchanged. */
export function swapped<T>(s: Sides<T>): Sides<T> {
  return { old: s.new, new: s.old };
}

/** The page picker opens by itself only for a Document with several pages (clipper ADR 0014). */
export function needsPagePicker(pageCount: number): boolean {
  return pageCount > 1;
}

export function isPdf(f: { name: string; type: string }): boolean {
  return /\.pdf$/i.test(f.name) || f.type === "application/pdf";
}
