import { describe, expect, it } from "vitest";
import { DIRECTION_LABEL, preselectedDirection } from "./direction";

describe("preselectedDirection", () => {
  it("a tall Plan runs down, a wide one to the right", () => {
    expect(preselectedDirection(420, 594)).toBe("down");
    expect(preselectedDirection(590, 210)).toBe("right");
  });
  it("a square Plan counts as wide", () => {
    expect(preselectedDirection(300, 300)).toBe("right");
  });
  it("names the directions in German", () => {
    expect(DIRECTION_LABEL).toEqual({ down: "senkrecht", right: "waagerecht" });
  });
});
