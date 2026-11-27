// Hidden Places (GLOSSARY: Hidden Place; ADR 0003): Places the user marked as no real change.
// They are kept by kind and position (mm, rounded), so they stay hidden when the comparison runs
// again and the numbers change; for the session and the pair of Plans only.

import type { Place } from "../compare/places";

export const placeKey = (p: Pick<Place, "kind" | "box">): string => `${p.kind}|${[p.box.x0, p.box.y0, p.box.x1, p.box.y1].map(Math.round).join(",")}`;

export class HiddenPlaces {
  private readonly keys = new Set<string>();

  has(p: Pick<Place, "kind" | "box">): boolean {
    return this.keys.has(placeKey(p));
  }

  hide(places: readonly Pick<Place, "kind" | "box">[]): void {
    for (const p of places) this.keys.add(placeKey(p));
  }

  show(places: readonly Pick<Place, "kind" | "box">[]): void {
    for (const p of places) this.keys.delete(placeKey(p));
  }

  /** How many of these Places are hidden. */
  count(places: readonly Pick<Place, "kind" | "box">[]): number {
    return places.filter((p) => this.has(p)).length;
  }

  clear(): void {
    this.keys.clear();
  }
}
