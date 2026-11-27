// Stepping with ◀ ▶ (ADR 0003): to the next or previous Place of the list as shown, round the
// ends. The cursor is the Place stepped from, or a gap in the list where Places were hidden.

/** Where ◀ ▶ go on from: a Place, or the gap before the Place at this index of the list. */
export type Cursor = { no: number } | { before: number } | null;

export function step(order: readonly number[], cursor: Cursor, dir: 1 | -1): number | null {
  const n = order.length;
  if (!n) return null;
  const at = cursor && "no" in cursor ? order.indexOf(cursor.no) : -1;
  if (cursor && "before" in cursor) return order[dir > 0 ? cursor.before % n : (cursor.before - 1 + n) % n]!;
  if (at < 0) return order[dir > 0 ? 0 : n - 1]!;
  return order[(at + dir + n) % n]!;
}

/** After hiding, ◀ ▶ go on from where the first hidden Place was in `order` (the list before). */
export function cursorAfterHide(order: readonly number[], hidden: ReadonlySet<number>): Cursor {
  const first = order.findIndex((no) => hidden.has(no));
  return first < 0 ? null : { before: first };
}
