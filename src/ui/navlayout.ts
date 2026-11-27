// Where the minimap of "Vergleich" sits: in the bottom-right corner, or lifted above the ◀ ▶
// bar when the two would overlap (a wide minimap, a narrow view). The bar keeps its place.

/** The minimap's distance from the right and bottom edges, px (as in the setup tabs). */
export const MINIMAP_INSET = 16;
/** The space kept between the bar and the minimap, px. */
const GAP = 10;

/** The minimap's `bottom`, px. The bar is centred in the view at `bar.bottom` from its foot. */
export function minimapBottom(a: { viewW: number; mapW: number; bar: { w: number; h: number; bottom: number } }): number {
  const barRight = a.viewW / 2 + a.bar.w / 2;
  const mapLeft = a.viewW - MINIMAP_INSET - a.mapW;
  return mapLeft < barRight + GAP ? a.bar.bottom + a.bar.h + GAP : MINIMAP_INSET;
}
