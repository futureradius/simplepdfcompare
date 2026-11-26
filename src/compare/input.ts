// The comparison's input from the user's setup (ADR 0002): each Plan's Body is what lies
// between its Header and Footer lines, the Ausgenommen zones are not compared, and the axis
// zones (Zeitachse, Wegachse, Vorgänge) say where the Places read Wann and Wo.

import { effectiveBox, type PageMm, type PlanZones } from "../zones/model";
import type { ComparisonSetup, PlanSetup } from "./compare";
import type { Axis, Box } from "./objects";
import type { AxisZones } from "./places";

/** One Plan's setup as the setup tabs hold it. */
export interface PlanSetupZones {
  page: PageMm;
  zones: PlanZones;
}

export interface ComparisonInput {
  setup: ComparisonSetup;
  axisZones: { old: AxisZones; new: AxisZones };
}

function planSetup(axis: Axis, p: PlanSetupZones): PlanSetup {
  const ignored: Box[] = p.zones.zones.filter((z) => z.kind === "area").map((z) => effectiveBox(z, axis, p.page));
  return { body: [p.zones.header, p.zones.footer], ignored };
}

function axisZonesOf(axis: Axis, p: PlanSetupZones): AxisZones {
  const boxes = (kind: "time" | "path" | "rows") => p.zones.zones.filter((z) => z.kind === kind).map((z) => effectiveBox(z, axis, p.page));
  const time = boxes("time"),
    location = boxes("path"),
    rows = boxes("rows");
  return { ...(time.length && { time }), ...(location.length && { location }), ...(rows.length && { rows }) };
}

/** The setup of the comparison and the axis zones, from both Plans' setups and the confirmed Offset. */
export function comparisonInput(axis: Axis, offset: number, old: PlanSetupZones, nu: PlanSetupZones): ComparisonInput {
  return {
    setup: { axis, offset, old: planSetup(axis, old), new: planSetup(axis, nu) },
    axisZones: { old: axisZonesOf(axis, old), new: axisZonesOf(axis, nu) },
  };
}
