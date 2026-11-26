import { describe, expect, it } from "vitest";
import { cleanName, importPresets, nameProblem, uniqueName, type NameRules } from "./presets";

const rules: NameRules = { noun: "Vorlage", reserved: "Alle" };
const list = (...names: string[]) => names.map((name) => ({ name }));

describe("names of Vorlagen", () => {
  it("trims and collapses white space", () => {
    expect(cleanName("  Strecke   A ")).toBe("Strecke A");
  });
  it("refuses an empty name, a clash (ignoring case) and the reserved name", () => {
    expect(nameProblem("  ", [], undefined, rules)).toMatch(/Namen/);
    expect(nameProblem("strecke a", list("Strecke A"), undefined, rules)).toMatch(/schon/);
    expect(nameProblem("ALLE", [], undefined, rules)).toMatch(/Alle/);
  });
  it("tells accents apart and lets a Vorlage keep its own name when renamed", () => {
    expect(nameProblem("Cafe", list("Café"), undefined, rules)).toBeUndefined();
    expect(nameProblem("Strecke A", list("Strecke A"), "Strecke A", rules)).toBeUndefined();
  });
  it("numbers a clash: (2), (3) ...", () => {
    expect(uniqueName("A", list("B"), rules)).toBe("A");
    expect(uniqueName("A", list("A"), rules)).toBe("A (2)");
    expect(uniqueName("A", list("A", "A (2)"), rules)).toBe("A (3)");
  });
  it("import adds every entry, never overwrites", () => {
    const { presets, added } = importPresets(list("A"), list("A", "A", "C"), rules);
    expect(presets.map((p) => p.name)).toEqual(["A", "A (2)", "A (3)", "C"]);
    expect(added).toHaveLength(3);
  });
});
