// The rows of the exported list (ADR 0007) on the synthetic pairs: every Place whatever the
// filter, in the order of Nr, hidden ones marked, with the values the ground truth gives.
import { describe, expect, it } from "vitest";
import { compare } from "../compare/compare";
import { axisOf } from "../compare/objects";
import { findPlaces, type Place } from "../compare/places";
import { objectsOf, pair } from "../testing/groundtruth";
import { place } from "../testing/place";
import { unzipStored } from "../testing/unzip";
import { changeRows, changesWorkbook, exportFileName, infoRows, type ChangeRow, type Moment } from "./changes";
import { xlsx } from "./xlsx";

function placesOf(name: string) {
  const gt = pair(name);
  const oldObjs = objectsOf(gt.old.file),
    newObjs = objectsOf(gt.new.file);
  const setup = { axis: axisOf(gt.timeDirection), offset: gt.offsetMm, old: { body: gt.old.bodyMm, ignored: [] }, new: { body: gt.new.bodyMm, ignored: [] } };
  const comparison = compare(oldObjs, newObjs, setup);
  const places = findPlaces({ old: oldObjs, new: newObjs, setup, comparison, axisZones: { old: gt.old.axisZonesMm, new: gt.new.axisZonesMm } });
  return { gt, setup, places };
}

/** A moment as the list's reader would write it: "2027-01-07 08:00", or "2027-01-07" for a whole day. */
const iso = (m: Moment | null) => {
  if (!m) return null;
  const s = new Date(Math.round(m.day * 1440) * 60000).toISOString();
  return m.time ? `${s.slice(0, 10)} ${s.slice(11, 16)}` : s.slice(0, 10);
};

const activities = placesOf("activities"),
  down = placesOf("down"),
  right = placesOf("right");
const none = () => false;
const rowsOf = (isHidden: (p: Place) => boolean = none) => changeRows(activities.places, { isHidden, setup: activities.setup });
const find = (rows: ChangeRow[], name: string, art: string) => rows.find((r) => r.was === name && r.art.startsWith(art));

describe("the exported rows", () => {
  it("are every Place, in the order of Nr", () => {
    const rows = rowsOf();
    expect(rows.map((r) => r.no)).toEqual(activities.places.map((_, i) => i + 1));
    expect(rows.length).toBe(activities.gt.changes.length);
  });

  it("name each Place in full, with its old text when its Label changed, and every kind, the main one first", () => {
    const rows = rowsOf();
    expect(find(rows, "Kabeltrog verlegen", "Text")).toMatchObject({ vorher: "Kabeltrog herstellen", art: "Text geändert" });
    expect(find(rows, "Gleis 1 erneuern", "Später")).toMatchObject({ vorher: "", art: "Später, Beschriftung verschoben" });
    expect(find(rows, "Kabeltrog verlegen", "Verlängert")).toMatchObject({ vorher: "", art: "Verlängert, Umgefärbt" });
    expect(rows.filter((r) => r.vorher).length).toBe(1);
  });

  it("give Um in days with a sign: + later and longer, − earlier and shorter, empty for the other kinds", () => {
    const rows = rowsOf();
    expect(find(rows, "Gleis 1 erneuern", "Später")!.um).toBeCloseTo(8 / 24, 4);
    expect(find(rows, "Gleis 2 erneuern mit Schotter", "Verlängert")!.um).toBeCloseTo(1.25, 4);
    expect(find(rows, "Kabeltrog verlegen", "Verlängert")!.um).toBe(1);
    expect(find(rows, "Mast umbauen", "Quer")!.um).toBeNull();
    expect(find(rows, "Signal einbauen", "Neu")!.um).toBeNull();
    const earlier = changeRows(down.places, { isHidden: none, setup: down.setup }).filter((r) => r.art.startsWith("Früher"));
    expect(earlier.map((r) => r.um)).toEqual([-1]);
  });

  it("give Von and Bis as the list reads them: the first and the last day covered, with the times when not on a day boundary", () => {
    const rows = rowsOf();
    const vonBis = (name: string, art: string) => {
      const r = find(rows, name, art)!;
      return [iso(r.von), iso(r.bis)];
    };
    expect(vonBis("Mast umbauen", "Quer")).toEqual(["2027-01-10", "2027-01-11"]); // 10.01.–11.01.27
    expect(vonBis("Gleis 1 erneuern", "Später")).toEqual(["2027-01-07 08:00", "2027-01-09 08:00"]); // 07.01. 08:00 – 09.01.27 08:00
    expect(vonBis("Gleis 2 erneuern mit Schotter", "Verlängert")).toEqual(["2027-01-13 00:00", "2027-01-16 06:00"]); // 13.01. 00:00 – 16.01.27 06:00
    expect(vonBis("Schraffur km 13,5–14,5, am 22.01.27", "Neu")).toEqual(["2027-01-22", "2027-01-22"]); // a milestone
  });

  it("leave Um, Von, Bis, km von and km bis empty when no axis was read", () => {
    const [r] = changeRows([place({ kind: "later", kinds: ["later"], amount: { along: true, mm: 4, days: null, km: null } })], { isHidden: none, setup: activities.setup });
    expect(r).toMatchObject({ um: null, von: null, bis: null, kmVon: null, kmBis: null });
  });

  it("give km von and km bis as numbers", () => {
    const r = find(rowsOf(), "Mast umbauen", "Quer")!; // km 14,5–15,1
    expect(r.kmVon).toBeCloseTo(14.5, 1);
    expect(r.kmBis).toBeCloseTo(15.1, 1);
  });

  it("place each Place by the top-left corner of its box in the New Plan's frame, mm with one decimal", () => {
    const rows = rowsOf();
    const at = (id: string) => activities.gt.changes.find((c) => c.id === id)!.differences[0]!.boxMm;
    const gone = find(rows, "Kabeltrog rückbauen", "Entfallen")!; // only on the Old Plan: moved by the Offset (48 mm)
    expect(gone.x).toBeCloseTo(at("A9").x0, 0);
    expect(gone.y).toBeCloseTo(at("A9").y0 - 48, 0);
    const added = find(rows, "Signal einbauen", "Neu")!; // only on the New Plan
    expect(added.x).toBeCloseTo(at("A8").x0, 0);
    expect(added.y).toBeCloseTo(at("A8").y0, 0);
    expect(rows.every((r) => Number.isInteger(Math.round(r.x * 10 * 1e6) / 1e6) && Number.isInteger(Math.round(r.y * 10 * 1e6) / 1e6))).toBe(true);
    // Time to the right: the Offset (36 mm) moves x.
    const r4 = right.gt.changes.find((c) => c.id === "R4")!.differences[0]!.boxMm;
    const signal = changeRows(right.places, { isHidden: none, setup: right.setup }).find((r) => r.art.startsWith("Entfallen"))!;
    expect(signal.x).toBeCloseTo(r4.x0 - 36, 0);
    expect(signal.y).toBeCloseTo(r4.y0, 0);
  });

  it("mark the Hidden Places and keep them", () => {
    const hidden = new Set([2, 5]);
    const rows = rowsOf((p) => hidden.has(p.no));
    expect(rows.length).toBe(activities.places.length);
    expect(rows.filter((r) => r.hidden).map((r) => r.no)).toEqual([2, 5]);
  });
});

describe("the file name", () => {
  it("names both Plans, each without .pdf and cut to its first 20 characters", () => {
    expect(exportFileName("Beispielplan Abschnitt Nord Stand 03.pdf", "Beispiel neu.PDF")).toBe("Änderungen Beispielplan Abschni → Beispiel neu.xlsx");
    expect(exportFileName("alt.pdf", "neu.pdf")).toBe("Änderungen alt → neu.xlsx");
  });
});

describe("the Info sheet", () => {
  const info = (pages: [number, number]) =>
    infoRows({
      old: { fileName: "alt.pdf", page: 1, pages: pages[0] },
      new: { fileName: "neu.pdf", page: 0, pages: pages[1] },
      offset: 48,
      timeDirection: "down",
      places: 12,
      hidden: 2,
      exported: new Date(2027, 0, 25, 14, 30),
    });

  it("names both Plans, the export date, the Offset, the Time direction and the counts", () => {
    expect(info([1, 1])).toEqual([
      ["Alter Plan", "alt.pdf"],
      ["Neuer Plan", "neu.pdf"],
      ["Exportiert am", { date: Date.UTC(2027, 0, 25, 14, 30) / 86400000, time: true }],
      ["Versatz (mm)", { num: 48, fmt: "0.00" }],
      ["Zeitrichtung", "senkrecht"],
      ["Stellen", { num: 12 }],
      ["Ausgeblendete Stellen", { num: 2 }],
    ]);
  });

  it("names each Plan's page for a Document with several pages", () => {
    const rows = info([3, 2]);
    expect(rows[0]).toEqual(["Alter Plan", "alt.pdf", "Seite 2 von 3"]);
    expect(rows[1]).toEqual(["Neuer Plan", "neu.pdf", "Seite 1 von 2"]);
  });
});

describe("the workbook", () => {
  /** The cells of a sheet's XML: reference to its style, type and value (or inline text). */
  const cellsOf = (xml: string) =>
    new Map(
      [...xml.matchAll(/<c r="([A-Z]+\d+)"(?: s="(\d+)")?(?: t="(\w+)")?>(.*?)<\/c>/g)].map(([, ref, s, t, inner]) => [
        ref!,
        { s: s ?? "0", t: t ?? "n", v: t === "inlineStr" ? /<t[^>]*>(.*?)<\/t>/.exec(inner!)![1]! : /<v>(.*?)<\/v>/.exec(inner!)![1]! },
      ]),
    );
  const file = async () => {
    const hidden = new Set([3]);
    const sheets = changesWorkbook(rowsOf((p) => hidden.has(p.no)), [["Alter Plan", "alt.pdf"]]);
    return unzipStored(new Uint8Array(await xlsx(sheets).arrayBuffer()));
  };

  it("has the sheets Änderungen and Info", async () => {
    const f = await file();
    expect([...f.get("xl/workbook.xml")!.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])).toEqual(["Änderungen", "Info"]);
  });

  it("heads the Änderungen sheet with the columns of ADR 0007, frozen and with an autofilter over every Place", async () => {
    const xml = (await file()).get("xl/worksheets/sheet1.xml")!;
    const cells = cellsOf(xml);
    expect("ABCDEFGHIJKL".split("").map((c) => cells.get(`${c}1`)?.v)).toEqual(["Nr", "Was", "vorher", "Art", "Um (Tage)", "Von", "Bis", "km von", "km bis", "x (mm)", "y (mm)", "Ausgeblendet"]);
    expect(xml).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(xml).toContain(`<autoFilter ref="A1:L${activities.places.length + 1}"/>`);
  });

  it("writes numbers and dates as numbers, with their formats, and text as text", async () => {
    const f = await file();
    const cells = cellsOf(f.get("xl/worksheets/sheet1.xml")!);
    const styles = f.get("xl/styles.xml")!;
    const formatOf = (s: string) => {
      const xf = [...styles.split("<cellXfs")[1]!.matchAll(/<xf numFmtId="(\d+)"/g)][Number(s)]![1]!;
      return /^\d+$/.test(xf) && Number(xf) < 164 ? xf : new RegExp(`<numFmt numFmtId="${xf}" formatCode="([^"]+)"`).exec(styles)![1]!;
    };
    const r = rowsOf().find((x) => x.was === "Gleis 1 erneuern")!; // later by 8 hours, 07.01. 08:00 – 09.01.27 08:00
    const at = (col: string) => cells.get(`${col}${r.no + 1}`);
    expect(at("A")).toMatchObject({ t: "n", v: String(r.no) });
    expect(at("B")).toMatchObject({ t: "inlineStr", v: "Gleis 1 erneuern" });
    expect(at("D")).toMatchObject({ t: "inlineStr", v: "Später, Beschriftung verschoben" });
    expect(Number(at("E")!.v)).toBeCloseTo(1 / 3, 6);
    expect(formatOf(at("E")!.s)).toBe("+0.00;-0.00;0.00");
    // Excel's serial days: 2027-01-07 08:00 is 46394 + 8/24
    expect(Number(at("F")!.v)).toBeCloseTo(46394 + 8 / 24, 6);
    expect(formatOf(at("F")!.s)).toBe("dd.mm.yyyy hh:mm");
    expect(Number(at("G")!.v)).toBeCloseTo(46396 + 8 / 24, 6);
    expect(Number(at("H")!.v)).toBeCloseTo(10.4, 1);
    // km to the metre, shown with one decimal as in the list
    expect(at("H")!.v).toMatch(/^\d+(\.\d{1,3})?$/);
    expect(formatOf(at("H")!.s)).toBe("0.0");
    expect(formatOf(at("J")!.s)).toBe("0.0");
    expect(at("L")).toBeUndefined();
    const whole = rowsOf().find((x) => x.was === "Mast umbauen")!; // 10.01.–11.01.27, whole days
    expect(cells.get(`F${whole.no + 1}`)!.v).toBe("46397");
    expect(formatOf(cells.get(`F${whole.no + 1}`)!.s)).toBe("dd.mm.yyyy");
    expect(cells.get(`E${whole.no + 1}`)).toBeUndefined();
    expect(cells.get("L4")).toMatchObject({ t: "inlineStr", v: "ja" });
  });

  it("escapes text for XML", async () => {
    const sheets = changesWorkbook([], [["Alter Plan", 'A & B <"alt">.pdf']]);
    const xml = unzipStored(new Uint8Array(await xlsx(sheets).arrayBuffer())).get("xl/worksheets/sheet2.xml")!;
    expect(xml).toContain("A &amp; B &lt;&quot;alt&quot;&gt;.pdf");
  });
});
