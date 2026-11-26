import { describe, expect, it } from "vitest";
import { dropdownEntries } from "./presets";

const names = ["B", "A"].map((name) => ({ name }));

describe("what the Vorlage dropdown shows", () => {
  it("shows – while none is picked, then the Vorlagen sorted", () => {
    const d = dropdownEntries(names, undefined, false);
    expect(d.entries.map((e) => e.label)).toEqual(["–", "A", "B"]);
    expect(d.value).toBe(d.entries[0]!.value);
  });
  it("shows the picked one, and no – ", () => {
    const d = dropdownEntries(names, "B", false);
    expect(d.entries.map((e) => e.label)).toEqual(["A", "B"]);
    expect(d.value).toBe("B");
  });
  it("shows 'Name (geändert)' on top after a change by hand", () => {
    const d = dropdownEntries(names, "B", true);
    expect(d.entries.map((e) => e.label)).toEqual(["B (geändert)", "A", "B"]);
    expect(d.value).toBe(d.entries[0]!.value);
  });
  it("a built-in entry (the filter's Alle) replaces –", () => {
    const d = dropdownEntries(names, undefined, false, "Alle");
    expect(d.entries.map((e) => e.label)).toEqual(["Alle", "A", "B"]);
    expect(dropdownEntries(names, undefined, true, "Alle").entries.map((e) => e.label)).toEqual(["Alle (geändert)", "Alle", "A", "B"]);
  });
});
