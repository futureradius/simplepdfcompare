// A small .xlsx writer (ADR 0007): sheets of text, numbers and dates, the header row frozen and
// filtered. Hand-written SpreadsheetML (ECMA-376) in a stored ZIP (zip.ts); no library.
// Text is written inline (no shared strings); numbers and dates are real numbers with a format.

import { zip } from "./zip";

/** The number formats a cell can have. "+0.00" shows the sign of a positive number too. */
export type NumFormat = "0.0" | "0.00" | "+0.00";

/**
 * A cell: empty, text, a number (General unless a format is given), or a moment in days since
 * 1970-01-01 as the wall clock reads it, shown as a date, or with `time` as a date and time.
 */
export type Cell = null | string | { num: number; fmt?: NumFormat } | { date: number; time: boolean };

export interface Sheet {
  name: string;
  rows: Cell[][];
  /** The first row is a header: bold, frozen, and with an autofilter over the table. */
  header?: boolean;
  /** Column widths, in characters. */
  widths?: number[];
}

// ---- Styles: the order of `cellXfs` -----------------------------------------------------

const FORMATS: Record<NumFormat | "date" | "datetime", { id: number; code: string }> = {
  "0.0": { id: 164, code: "0.0" },
  "0.00": { id: 2, code: "0.00" }, // built in
  "+0.00": { id: 165, code: "+0.00;-0.00;0.00" },
  date: { id: 166, code: "dd.mm.yyyy" },
  datetime: { id: 167, code: "dd.mm.yyyy hh:mm" },
};
/** Style 0 is plain, 1 the bold header, then one per format. */
const STYLE_KEYS = ["0.0", "0.00", "+0.00", "date", "datetime"] as const;
const styleOf = (key: (typeof STYLE_KEYS)[number]) => 2 + STYLE_KEYS.indexOf(key);

function stylesXml(): string {
  const custom = Object.values(FORMATS).filter((f) => f.id >= 164);
  const xfs = STYLE_KEYS.map((k) => `<xf numFmtId="${FORMATS[k].id}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`);
  return (
    XML_HEAD +
    `<styleSheet xmlns="${NS}">` +
    `<numFmts count="${custom.length}">${custom.map((f) => `<numFmt numFmtId="${f.id}" formatCode="${esc(f.code)}"/>`).join("")}</numFmts>` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${2 + xfs.length}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>${xfs.join("")}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}

// ---- XML -----------------------------------------------------------------------------

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

/** Text for XML: escaped, and without the control characters XML 1.0 cannot hold. */
const esc = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** "A", "B", ... "Z", "AA" ... */
export function columnName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Days since 1970-01-01 to an Excel serial date (1900 date system). */
const EXCEL_1970 = 25569;
const serial = (day: number) => Math.round((day + EXCEL_1970) * 86400) / 86400;

/** A number as XML text: finite, without the float noise past 10 significant decimals. */
const numText = (v: number) => String(Math.round(v * 1e10) / 1e10);

function cellXml(c: Cell, ref: string, header: boolean): string {
  if (c === null) return "";
  if (typeof c === "string") {
    if (!c) return "";
    const s = header ? ' s="1"' : "";
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(c)}</t></is></c>`;
  }
  if ("date" in c) return `<c r="${ref}" s="${styleOf(c.time ? "datetime" : "date")}"><v>${numText(serial(c.date))}</v></c>`;
  if (!Number.isFinite(c.num)) return "";
  const s = c.fmt ? ` s="${styleOf(c.fmt)}"` : "";
  return `<c r="${ref}"${s}><v>${numText(c.num)}</v></c>`;
}

const lastRef = (sheet: Sheet) => `${columnName(Math.max(1, ...sheet.rows.map((r) => r.length)) - 1)}${Math.max(1, sheet.rows.length)}`;

function sheetXml(sheet: Sheet): string {
  const views = sheet.header
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>`
    : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  const cols = sheet.widths?.length ? `<cols>${sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
  const rows = sheet.rows.map((r, i) => `<row r="${i + 1}">${r.map((c, j) => cellXml(c, `${columnName(j)}${i + 1}`, !!sheet.header && i === 0)).join("")}</row>`);
  const filter = sheet.header ? `<autoFilter ref="A1:${lastRef(sheet)}"/>` : "";
  return XML_HEAD + `<worksheet xmlns="${NS}" xmlns:r="${REL_NS}"><dimension ref="A1:${lastRef(sheet)}"/>${views}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows.join("")}</sheetData>${filter}</worksheet>`;
}

/** A sheet's name as a formula reads it: quoted, with ' doubled. */
const sheetRef = (name: string) => `'${name.replace(/'/g, "''")}'`;
const absolute = (ref: string) => ref.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2");

function workbookXml(sheets: readonly Sheet[]): string {
  const names = sheets
    .map((s, i) => (s.header ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${esc(sheetRef(s.name))}!${absolute(`A1:${lastRef(s)}`)}</definedName>` : ""))
    .join("");
  return (
    XML_HEAD +
    `<workbook xmlns="${NS}" xmlns:r="${REL_NS}"><bookViews><workbookView/></bookViews><sheets>` +
    sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
    `</sheets>${names ? `<definedNames>${names}</definedNames>` : ""}</workbook>`
  );
}

/** The .xlsx file's bytes, as a ZIP. */
export function xlsx(sheets: readonly Sheet[], when = new Date()): Blob {
  const enc = new TextEncoder();
  const sheetType = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
  const contentTypes =
    XML_HEAD +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${sheetType}"/>`).join("") +
    `</Types>`;
  const rootRels =
    XML_HEAD + `<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const bookRels =
    XML_HEAD +
    `<Relationships xmlns="${PKG_REL_NS}">` +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`;
  const parts: [string, string][] = [
    ["[Content_Types].xml", contentTypes],
    ["_rels/.rels", rootRels],
    ["xl/workbook.xml", workbookXml(sheets)],
    ["xl/_rels/workbook.xml.rels", bookRels],
    ["xl/styles.xml", stylesXml()],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)] as [string, string]),
  ];
  return zip(
    parts.map(([name, text]) => ({ name, data: enc.encode(text) })),
    when,
  );
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
