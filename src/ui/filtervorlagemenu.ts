// "Vorlage: [▾] [✎]" beside the filter in "Vergleich" (ADR 0009): the shared PresetMenu, driven by
// the filter's kind of Vorlage. It only reads and sets the filter held by PlacesState, so applying
// a Vorlage does what checking the boxes by hand does: the Plan and the list stay where they are.

import type { KindOfChange } from "../compare/kinds";
import { ALL_KINDS, FILTER_FILE_NAME, FILTER_NAMES, filterFromJson, filterToJson, loadFilters, sameKinds, savable, storeFilters, withKinds, type NamedFilter } from "./filtervorlagen";
import type { PlacesState } from "./placesstate";
import { PresetMenu } from "./presetmenu";

export function filterVorlagen(state: PlacesState): PresetMenu<NamedFilter, KindOfChange[]> {
  return new PresetMenu<NamedFilter, KindOfChange[]>({
    prefix: "filter-vorlage",
    rules: FILTER_NAMES,
    plural: "Filter-Vorlagen",
    builtin: ALL_KINDS,
    fileName: FILTER_FILE_NAME,
    overwriteLabel: (name) => `„${name}“ mit der aktuellen Auswahl überschreiben`,
    changedTitle: "Filter geändert. Vorlage erneut wählen, um sie wiederherzustellen.",
    sameTitle: "Der aktuelle Filter entspricht schon dieser Vorlage.",
    current: () => savable(state.filter),
    valueOf: (p) => p.kinds,
    make: (name, kinds) => ({ name, kinds }),
    apply: (kinds) => state.setFilter(withKinds(state.filter, kinds)),
    same: sameKinds,
    // The picked one is not remembered (see loadFilters): every start shows "Alle", like the filter.
    load: () => ({ presets: loadFilters(), selected: undefined }),
    store: (s) => storeFilters(s.presets),
    toJson: filterToJson,
    fromJson: filterFromJson,
  });
}
