// What a finished comparison is: the seam between the setup tabs and the "Vergleich" tab.
// "Vergleichen" on the "Versatz" tab produces one of these and hands it over (src/ui/handoff.ts).

import type { Comparison, ComparisonSetup } from "./compare";
import type { TimeDirection } from "./objects";
import type { OffsetCandidate } from "./offset";
import type { AxisZones, Place } from "./places";

export interface ComparisonResult {
  timeDirection: TimeDirection;
  /**
   * The setup the comparison used, as the user confirmed it: the Time axis, the Offset, and per
   * Plan the Body (Header and Footer lines) and the Ausgenommen boxes, each in its own Plan's page mm.
   */
  setup: ComparisonSetup;
  /** The axis zones the user marked, per Plan in its own page mm; empty where none is marked. */
  axisZones: { old: AxisZones; new: AxisZones };
  /** The Differences, as marks in the Old frame. */
  comparison: Comparison;
  /** The Places formed from them, with Wann and Wo read from the axis zones where set. */
  places: Place[];
  /** The Offset candidates the search found, best first (empty if it was stopped or found none). */
  offsetCandidates: OffsetCandidate[];
  /** Milliseconds: matching, forming the Places, and moving the data between the workers. */
  ms: { compare: number; places: number; transfer: number };
}
