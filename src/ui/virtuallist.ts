// A long list with fixed row heights builds only the rows in the page and a few beside them
// (many hundreds of Places must scroll smoothly). Pure arithmetic; the sidebar draws the rows.

export interface WindowInput {
  scrollTop: number;
  viewH: number;
  rowH: number;
  count: number;
  /** Rows built beyond each edge of the view. */
  overscan: number;
}

export interface RowWindow {
  /** The first row built, and the one after the last. */
  first: number;
  end: number;
  /** The height of the whole list, px. */
  total: number;
}

export function rowWindow({ scrollTop, viewH, rowH, count, overscan }: WindowInput): RowWindow {
  const total = count * rowH;
  const top = Math.max(0, Math.min(scrollTop, Math.max(0, total - viewH)));
  const first = Math.max(0, Math.floor(top / rowH) - overscan);
  const end = Math.min(count, Math.ceil((top + viewH) / rowH) + overscan);
  return { first, end: Math.max(first, end), total };
}

/** The scroll position that shows a row with the least movement; null when it is in view already. */
export function scrollToShow({ scrollTop, viewH, rowH, index }: { scrollTop: number; viewH: number; rowH: number; index: number }): number | null {
  const top = index * rowH,
    bottom = top + rowH;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewH) return bottom - viewH;
  return null;
}
