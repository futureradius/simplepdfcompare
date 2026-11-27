import { describe, expect, it } from "vitest";
import { minimapBottom } from "./navlayout";

// The ◀ ▶ bar sits at the bottom centre; the minimap at the bottom right moves up over it
// only when they would overlap.
describe("minimapBottom", () => {
  const bar = { w: 440, h: 38, bottom: 22 };

  it("keeps the minimap in its corner when it is clear of the bar", () => {
    expect(minimapBottom({ viewW: 1500, mapW: 200, bar })).toBe(16);
  });

  it("lifts the minimap above the bar when they would overlap", () => {
    // Bar right edge 750 + 220 = 970; minimap left 1500 - 16 - 600 = 884.
    expect(minimapBottom({ viewW: 1500, mapW: 600, bar })).toBe(22 + 38 + 10);
  });

  it("treats a small gap between them as touching", () => {
    // Bar right edge 970; minimap left 1500 - 16 - 510 = 974: 4 px apart.
    expect(minimapBottom({ viewW: 1500, mapW: 510, bar })).toBe(70);
    expect(minimapBottom({ viewW: 1500, mapW: 400, bar })).toBe(16);
  });
});
