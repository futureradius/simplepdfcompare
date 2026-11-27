// A synthetic Place for the tests of the list, filter and selection (no real data).

import type { Place } from "../compare/places";

export const place = (over: Partial<Place> = {}): Place => ({
  no: 1,
  kind: "later",
  kinds: ["later"],
  marks: [0, 1],
  partKinds: ["later", "later"],
  box: { x0: 0, y0: 0, x1: 10, y1: 10 },
  name: null,
  nameFrom: null,
  oldName: null,
  note: null,
  shape: "Linie",
  when: null,
  where: null,
  amount: null,
  ...over,
});
