// "Tastenkürzel" in "Über" (ADR 0009, the clipper's ADR 0012): every key and mouse gesture of
// this app, by tab. The About window's table is built from this list, and a test reads the keys
// the code handles and fails when one is missing here (src/ui/shortcuts.test.ts).
//
// `keys` are the KeyboardEvent.key values a row stands for (letters in upper case; "Control",
// "Shift" and "Alt" for a held modifier); mouse rows have none. `sources` are the files whose
// keys a chapter covers. In `show`, [x] is drawn as a key cap.

import { h } from "./dom";

export interface ShortcutRow {
  keys: string[];
  show: string;
  text: string;
}
export interface ShortcutGroup {
  title: string;
  sources: string[];
  rows: ShortcutRow[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Startseite",
    sources: ["main.ts"],
    rows: [{ keys: ["Enter", " "], show: "[Enter] oder [Leertaste]", text: "Im Feld „Alter Plan“ oder „Neuer Plan“ (mit [Tab] erreicht): Datei auswählen" }],
  },
  {
    title: "Alter Plan, Neuer Plan",
    sources: ["setuptabs.ts", "zoneeditor.ts", "kindmenu.ts", "presetmenu.ts"],
    rows: [
      { keys: ["1"], show: "[1]", text: "Ganzen Plan zeigen" },
      { keys: ["2"], show: "[2]", text: "Ganze Planbreite zeigen" },
      { keys: ["3"], show: "[3]", text: "Originalgröße (1:1)" },
      { keys: ["F"], show: "[F]", text: "Gewählten Bereich zeigen, sonst den ganzen Plan" },
      { keys: ["Delete"], show: "[Entf]", text: "Gewählten Bereich entfernen" },
      { keys: [], show: "Ziehen auf dem Plan", text: "Neuen Bereich aufziehen; Kanten und Ecken ziehen: Größe ändern, innen ziehen: verschieben. Klick auf einen Bereich wählt ihn" },
      { keys: ["Alt"], show: "[Alt] beim Ziehen", text: "Frei ziehen, ohne Einrasten" },
      {
        keys: ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape", "Tab"],
        show: "[↑] [↓] [Pos1] [Ende], [Enter], [Esc]",
        text: "In der Art eines Bereichs (Ausgenommen, Zeitachse …): Liste öffnen, Eintrag wählen, übernehmen ([Enter] oder [Leertaste]), schließen ([Esc] oder [Tab])",
      },
      { keys: ["Enter", "Escape"], show: "[Enter], [Esc]", text: "Im Fenster „Vorlagen“: Name übernehmen, Umbenennen abbrechen" },
    ],
  },
  {
    title: "Versatz",
    sources: ["offsettab.ts", "offsetmodel.ts", "offsetoverlay.ts"],
    rows: [
      { keys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"], show: "[↑] [↓], waagerecht [←] [→]", text: "Neuen Plan um 0,1 mm verschieben" },
      { keys: ["Control"], show: "[Strg] + Pfeiltaste", text: "Um 1 mm verschieben" },
      { keys: ["PageUp", "PageDown"], show: "[Bild ↑] [Bild ↓]", text: "Um 10 mm verschieben" },
      { keys: ["1", "2", "3"], show: "[1] [2] [3]", text: "Ganzer Plan, ganze Planbreite, Originalgröße (1:1)" },
      { keys: [], show: "Ziehen auf dem Plan", text: "Neuen Plan verschieben; er rastet bei den gefundenen Versätzen ein" },
      { keys: ["Alt"], show: "[Alt] beim Ziehen", text: "Frei verschieben, ohne Einrasten" },
      { keys: ["Enter", "Escape"], show: "[Enter], [Esc]", text: "Im Feld „Versatz“: getippten Wert übernehmen, verwerfen" },
    ],
  },
  {
    title: "Vergleich",
    sources: ["compareview.ts", "placesui.ts", "placespanel.ts", "filterpanel.ts"],
    rows: [
      { keys: ["ArrowRight", "J"], show: "[→] oder [J]", text: "Nächste Stelle" },
      { keys: ["ArrowLeft", "K"], show: "[←] oder [K]", text: "Vorige Stelle" },
      { keys: ["H"], show: "[H]", text: "Ausgewählte Stellen ausblenden" },
      { keys: ["Escape"], show: "[Esc]", text: "Auswahl aufheben; schließt auch die Filterliste" },
      { keys: ["M"], show: "[M]", text: "Markierungen aus oder an" },
      { keys: [" "], show: "[Leertaste] halten", text: "Nur den neuen Plan zeigen, ohne Markierungen" },
      { keys: ["Control"], show: "[Strg] + [Leertaste] halten", text: "Nur den alten Plan zeigen, ohne Markierungen" },
      { keys: ["1"], show: "[1]", text: "Ganzen Plan zeigen" },
      { keys: ["2"], show: "[2]", text: "Ganze Planbreite zeigen" },
      { keys: ["3"], show: "[3]", text: "Originalgröße (1:1)" },
      { keys: ["F"], show: "[F]", text: "Ausgewählte Stellen zeigen, sonst den ganzen Plan" },
      { keys: [], show: "Klick auf eine Stelle", text: "Auswählen (auf dem Plan oder in der Liste); Klick daneben hebt die Auswahl auf" },
      { keys: [], show: "Kasten ziehen", text: "Nach rechts: Stellen, die ganz darin liegen; nach links: Stellen, die er berührt" },
      { keys: ["Shift", "Control"], show: "[Umschalt] / [Strg] + Klick oder Kasten", text: "Auf dem Plan: zur Auswahl dazu / aus der Auswahl weg" },
      { keys: ["Control", "Shift"], show: "[Strg] / [Umschalt] + Klick", text: "In der Liste: dazu oder weg / alles bis hierher" },
      { keys: ["Enter", "Escape"], show: "[Enter], [Esc]", text: "Im Filter einer Spalte (Wann, Wo): übernehmen, schließen" },
    ],
  },
  {
    title: "Überall",
    sources: ["sidebar.ts"],
    rows: [
      { keys: [], show: "Mausrad", text: "Vergrößern, verkleinern" },
      { keys: [], show: "Rechte oder mittlere Maustaste + Ziehen", text: "Ansicht verschieben" },
      { keys: [], show: "Klick oder Ziehen in der Übersicht", text: "Ansicht dorthin verschieben" },
      { keys: ["ArrowLeft", "ArrowRight"], show: "[←] [→]", text: "Am Rand der Seitenleiste (mit [Tab] erreicht): schmaler, breiter. Doppelklick: zurück auf die Standardbreite" },
      { keys: [], show: "[Esc]", text: "Schließt ein Fenster (Über, Seite wählen, Vorlagen)" },
    ],
  },
];

/** `show` or `text` with every [x] as a key cap. */
export function withKeys(s: string): (Node | string)[] {
  return s.split(/\[([^\]]+)\]/).map((part, i) => (i % 2 ? h("kbd", {}, part) : part));
}

/** Fills the About window's key table: a heading row per tab, then its rows. The key column is 30 %. */
export function renderShortcuts(table: HTMLTableElement): void {
  table.replaceChildren(
    // The table's layout is fixed, so the widths come from here, not from the first (heading) row.
    h("colgroup", {}, h("col", { style: "width:30%" }), h("col")),
    ...SHORTCUT_GROUPS.flatMap((g) => [
      h("tr", { class: "group" }, Object.assign(h("th", {}, g.title), { colSpan: 2 })),
      ...g.rows.map((r) => h("tr", {}, h("td", {}, ...withKeys(r.show)), h("td", {}, ...withKeys(r.text)))),
    ]),
  );
}
