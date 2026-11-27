// "Exportieren" at the top of the "Vergleich" tab (ADR 0007): every Place, whatever the list's
// filter, hidden ones marked, as an .xlsx with an Info sheet. The Save-as dialog opens on the
// click, before the file is written (clipper ADR 0009); the busy window shows if writing takes
// a moment. Nothing is prepared before the click.

import { changeRows, changesWorkbook, exportFileName, infoRows, type InfoPlan } from "../export/changes";
import { xlsx, XLSX_MIME } from "../export/xlsx";
import type { ComparisonResult } from "../compare/result";
import type { BusyWindow } from "./busy";
import { h, icon } from "./dom";
import type { PlacesState } from "./placesstate";
import { chooseSaveTarget } from "./save";

export interface ExportDeps {
  state: PlacesState;
  /** The comparison shown in "Vergleich". */
  result: () => ComparisonResult | undefined;
  /** The Plans it compared: their Documents' file names and pages. */
  plans: () => { old: InfoPlan | undefined; new: InfoPlan | undefined };
  busy: BusyWindow;
}

const DOWNLOAD = () => icon('<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>');

/** The bar with "Exportieren", to put at the top of the "Vergleich" sidebar. */
export function createExportBar(deps: ExportDeps): HTMLElement {
  const error = h("div", { class: "cmp-export-error", role: "alert" });
  const button = h(
    "button",
    { class: "btn", type: "button", title: "Alle Stellen als Tabelle (.xlsx) speichern, unabhängig vom Filter", data: { action: "export" } },
    DOWNLOAD(),
    h("span", {}, "Exportieren"),
  );
  button.id = "cmp-export";

  async function run(): Promise<void> {
    const r = deps.result(),
      { old: o, new: n } = deps.plans();
    const { state } = deps;
    if (!r || !o || !n || r.places !== state.places || deps.busy.active) return;
    error.textContent = "";
    const write = await chooseSaveTarget(exportFileName(o.fileName, n.fileName), "Excel-Tabelle", XLSX_MIME, ".xlsx");
    if (!write) return; // cancelled
    await deps.busy.start("Liste wird exportiert…", { button });
    try {
      const rows = changeRows(state.places, { isHidden: (p) => state.isHidden(p), setup: r.setup });
      const info = infoRows({ old: o, new: n, offset: r.setup.offset, timeDirection: r.timeDirection, places: rows.length, hidden: rows.filter((x) => x.hidden).length, exported: new Date() });
      await write(xlsx(changesWorkbook(rows, info)));
    } catch (e) {
      error.textContent = `Die Liste konnte nicht gespeichert werden: ${String(e)}`;
    } finally {
      await deps.busy.end();
    }
  }
  button.addEventListener("click", () => void run());
  return h("div", { class: "cmp-export" }, button, error);
}
