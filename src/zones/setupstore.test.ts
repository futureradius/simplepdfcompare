import { describe, expect, it } from "vitest";
import { SetupStore } from "./setupstore";

describe("SetupStore: a separate setup per Time direction", () => {
  it("starts empty for a direction that has none yet", () => {
    const s = new SetupStore<{ n: number }>();
    expect(s.get("y", "old")).toBeUndefined();
    s.put("y", "old", { n: 1 });
    expect(s.get("x", "old")).toBeUndefined();
  });

  it("gives back an earlier direction's setup unchanged after switching away and back", () => {
    const s = new SetupStore<{ n: number }>();
    const a = { n: 1 },
      b = { n: 2 };
    s.put("y", "old", a);
    s.put("y", "new", b);
    s.put("x", "old", { n: 3 });
    expect(s.get("y", "old")).toBe(a);
    expect(s.get("y", "new")).toBe(b);
  });

  it("forgets a role in both directions when its Plan is another one, and only that role", () => {
    const s = new SetupStore<{ n: number }>();
    expect(s.syncPlan("old", 1)).toBe(true); // the first time it is new
    expect(s.syncPlan("new", 7)).toBe(true);
    s.put("y", "old", { n: 1 });
    s.put("x", "old", { n: 2 });
    s.put("y", "new", { n: 3 });
    expect(s.syncPlan("old", 1)).toBe(false); // the same Plan: everything stays
    expect(s.get("x", "old")).toBeDefined();
    expect(s.syncPlan("old", 2)).toBe(true);
    expect(s.get("y", "old")).toBeUndefined();
    expect(s.get("x", "old")).toBeUndefined();
    expect(s.get("y", "new")).toBeDefined();
  });
});
