import { describe, expect, it } from "vitest";
import { KINDS, type KindOfChange } from "../compare/kinds";
import { setupFromJson, setupToJson } from "../zones/vorlagen";
import { defaultFilter, setAllKinds, setKind, setRange, type PlaceFilter } from "./placefilter";
import { nameProblem, uniqueName } from "./presets";
import { checkedKinds, FILTER_FILE_NAME, FILTER_NAMES, filterFromJson, filterToJson, loadFilters, readFilterList, sameKinds, savable, storeFilters, withKinds } from "./filtervorlagen";

const ranged: PlaceFilter = setRange(setRange(defaultFilter(), "when", [20000, 20010]), "where", [12.4, 14.5]);

describe("what a filter Vorlage holds", () => {
  it("the checked kinds, in the order of the filter list, and not Wann or Wo", () => {
    const f = setKind(setKind(ranged, "recoloured", false), "earlier", false);
    expect(checkedKinds(f)).toEqual(["later", "longer", "shorter", "movedAcross", "textChanged", "new", "gone", "lineWidth", "labelMoved", "other"]);
  });

  it("applies its kinds and keeps the Wann and Wo ranges", () => {
    const f = withKinds(ranged, ["new", "gone"]);
    expect(checkedKinds(f)).toEqual(["new", "gone"]);
    expect(f.when).toEqual([20000, 20010]);
    expect(f.where).toEqual([12.4, 14.5]);
  });

  it("the built-in Alle checks every kind", () => {
    const f = withKinds(setKind(ranged, "new", false), undefined);
    expect(f.off).toEqual([]);
    expect(f.when).toEqual([20000, 20010]);
  });
});

describe("same kinds", () => {
  it("compares the checked kinds only, in any order; the built-in Alle is every kind", () => {
    expect(sameKinds(["new", "gone"], ["gone", "new"])).toBe(true);
    expect(sameKinds(["new", "gone"], ["new"])).toBe(false);
    expect(sameKinds(["new"], ["gone"])).toBe(false);
    expect(sameKinds([...KINDS], undefined)).toBe(true);
    expect(sameKinds(["new"], undefined)).toBe(false);
  });
});

describe("what can be saved", () => {
  it("the checked kinds, or a German reason when none is checked", () => {
    expect(savable(setKind(ranged, "new", false))).toEqual({ value: KINDS.filter((k) => k !== "new") });
    expect(savable(setAllKinds(ranged, false))).toEqual({ problem: expect.stringMatching(/Art/) });
  });
});

describe("names", () => {
  it("Alle is built in: it can't be used as a name, in any case", () => {
    expect(nameProblem("Alle", [], undefined, FILTER_NAMES)).toMatch(/fest eingebaut/);
    expect(nameProblem(" alle ", [], undefined, FILTER_NAMES)).toMatch(/fest eingebaut/);
    expect(nameProblem("Alle Termine", [], undefined, FILTER_NAMES)).toBeUndefined();
    expect(uniqueName("Alle", [], FILTER_NAMES)).toBe("Alle (2)");
  });
});

describe("file format", () => {
  const list = [{ name: "Nur Termine", kinds: ["later", "earlier", "longer", "shorter"] as KindOfChange[] }];
  it("round-trips, under its own kind, holding only the kinds", () => {
    const json = filterToJson(list);
    const data = JSON.parse(json);
    expect(data.kind).toBe("simplepdfcompare-filter-vorlagen");
    expect(data.version).toBe(1);
    expect(data.presets).toEqual([{ name: "Nur Termine", kinds: ["later", "earlier", "longer", "shorter"] }]);
    expect(filterFromJson(json)).toEqual(list);
    expect(FILTER_FILE_NAME).toBe("simplepdfcompare-Filter-Vorlagen.json");
  });
  it("refuses what is not a filter Vorlagen file, a setup Vorlagen file among them, with a German message", () => {
    expect(() => filterFromJson("nope")).toThrow(/kein gültiges JSON/);
    expect(() => filterFromJson(setupToJson([]))).toThrow(/keine Filter-Vorlagen-Datei/);
    expect(() => filterFromJson(JSON.stringify({ kind: "simplepdfclipper-presets", version: 1, presets: [] }))).toThrow(/keine Filter-Vorlagen-Datei/);
    // and the other way round
    expect(() => setupFromJson(filterToJson(list))).toThrow(/keine Vorlagen-Datei/);
  });
  it("drops what is unusable and cleans the rest", () => {
    const read = readFilterList([
      null,
      { name: "  ", kinds: ["new"] },
      { name: "keine Arten" },
      { name: "leer", kinds: [] },
      { name: "unbekannt", kinds: ["bogus"] },
      { name: "  Neu   und  entfallen ", kinds: ["gone", "bogus", "new", "new"], when: [1, 2], where: [3, 4] },
    ]);
    expect(read).toEqual([{ name: "Neu und entfallen", kinds: ["new", "gone"] }]);
    expect(readFilterList({})).toEqual([]);
  });
});

describe("storage", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  it("keeps the list in the browser, apart from the setup Vorlagen", () => {
    const store = memory();
    storeFilters([{ name: "Neu", kinds: ["new"] }], store);
    expect(loadFilters(store)).toEqual([{ name: "Neu", kinds: ["new"] }]);
    expect([...store.m.keys()]).toEqual(["simplepdfcompare.filterVorlagen"]);
  });
  it("gives none when nothing is stored, the stored data is broken, or storage fails", () => {
    expect(loadFilters(memory())).toEqual([]);
    const broken = memory();
    broken.setItem("simplepdfcompare.filterVorlagen", "{not json");
    expect(loadFilters(broken)).toEqual([]);
    const failing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadFilters(failing)).toEqual([]);
    expect(() => storeFilters([], failing)).not.toThrow();
  });
});
