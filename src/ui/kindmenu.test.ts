import { describe, expect, it } from "vitest";
import { menuIndex } from "./kindmenu";

describe("menuIndex: which entry the keys move to", () => {
  it("arrow keys step down and up and stop at the ends", () => {
    expect(menuIndex(1, "ArrowDown", 4)).toBe(2);
    expect(menuIndex(1, "ArrowUp", 4)).toBe(0);
    expect(menuIndex(3, "ArrowDown", 4)).toBe(3);
    expect(menuIndex(0, "ArrowUp", 4)).toBe(0);
  });
  it("Home and End jump to the first and last entry", () => {
    expect(menuIndex(2, "Home", 4)).toBe(0);
    expect(menuIndex(1, "End", 4)).toBe(3);
  });
  it("other keys leave it where it is", () => {
    expect(menuIndex(2, "a", 4)).toBe(2);
  });
});
