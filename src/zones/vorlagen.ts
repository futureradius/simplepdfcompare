// Vorlagen of the setup (ADR 0009, adapted from simplepdfclipper's clippresets.ts): the Header
// and Footer lines and the zones of one Plan, saved under a name. Never the Offset, never the
// Time direction: a Vorlage says "along" and "across" the Time direction, so it applies in either.
// Nothing is stretched: zones keep their mm distance from the Header line, the Footer its distance
// from the end. Pure logic, no DOM; storage may be unavailable, so every access is guarded.

import type { Axis } from "../compare/objects";
import { cleanName, type Named, type NameRules } from "../ui/presets";
import type { PageMm, PlanZones, ZoneKind } from "./model";
import { applyRemembered, toRemembered, type KeyValueStore, type RememberedZone } from "./remember";

/** What a Vorlage holds. */
export interface SetupVorlage {
  /** Where the Header ends, mm along the Time direction. */
  header: number;
  /** The Footer's distance from the end of the Plan. */
  footerFromEnd: number;
  /** In the order they were drawn; `a` across the Time direction, `t` along it, mm after the Header line. */
  zones: RememberedZone[];
}

export interface NamedSetup extends Named {
  setup: SetupVorlage;
}

export const SETUP_NAMES: NameRules = { noun: "Vorlage" };
export const SETUP_FILE_NAME = "simplepdfcompare-Vorlagen.json";
const FILE_KIND = "simplepdfcompare-setup-vorlagen";

/** The setup of a Plan, ready to be saved. */
export function setupOf(pz: PlanZones, axis: Axis, length: number): SetupVorlage {
  const { header, footerFromEnd, zones } = toRemembered(pz, axis, length);
  return { header, footerFromEnd, zones };
}

/** The zones this Vorlage gives a Plan of this page size when time runs along `axis`. */
export function applySetup(v: SetupVorlage, axis: Axis, page: PageMm, nextId: () => number): PlanZones {
  return applyRemembered({ axis, ...v }, axis, page, nextId)!;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.1;

/** Whether two setups draw the same: lines and zones within 0.1 mm, in the same order. */
export function sameSetup(a: SetupVorlage, b: SetupVorlage): boolean {
  return (
    near(a.header, b.header) &&
    near(a.footerFromEnd, b.footerFromEnd) &&
    a.zones.length === b.zones.length &&
    a.zones.every((z, i) => {
      const o = b.zones[i]!;
      return z.kind === o.kind && z.full === o.full && near(z.a0, o.a0) && near(z.a1, o.a1) && near(z.t0, o.t0) && near(z.t1, o.t1);
    })
  );
}

// ---- Validation and the file format ------------------------------------------------

const KINDS: readonly ZoneKind[] = ["area", "time", "path", "rows"];
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function readZone(raw: unknown): RememberedZone | undefined {
  const z = raw as Partial<Record<keyof RememberedZone, unknown>> | null;
  if (!z || typeof z !== "object" || !KINDS.includes(z.kind as ZoneKind)) return undefined;
  if (!isNum(z.a0) || !isNum(z.a1) || !isNum(z.t0) || !isNum(z.t1)) return undefined;
  return {
    kind: z.kind as ZoneKind,
    full: z.full === true,
    a0: Math.min(z.a0, z.a1),
    a1: Math.max(z.a0, z.a1),
    t0: Math.min(z.t0, z.t1),
    t1: Math.max(z.t0, z.t1),
  };
}

/** One setup read from anything; undefined if the lines are not numbers. Zones that are not valid are dropped. */
export function readSetup(raw: unknown): SetupVorlage | undefined {
  const s = raw as { header?: unknown; footerFromEnd?: unknown; zones?: unknown } | null;
  if (!s || typeof s !== "object" || !isNum(s.header) || !isNum(s.footerFromEnd) || s.header < 0 || s.footerFromEnd < 0) return undefined;
  const zones = Array.isArray(s.zones) ? s.zones.map(readZone).filter((z): z is RememberedZone => !!z) : [];
  return { header: s.header, footerFromEnd: s.footerFromEnd, zones };
}

/** A stored or imported list: entries without a usable name or setup are dropped. */
export function readSetupList(raw: unknown): NamedSetup[] {
  if (!Array.isArray(raw)) return [];
  const out: NamedSetup[] = [];
  for (const item of raw) {
    const p = item as { name?: unknown; setup?: unknown } | null;
    if (!p || typeof p !== "object" || typeof p.name !== "string" || !cleanName(p.name)) continue;
    const setup = readSetup(p.setup);
    if (setup) out.push({ name: cleanName(p.name), setup });
  }
  return out;
}

export function setupToJson(presets: readonly NamedSetup[]): string {
  return JSON.stringify({ kind: FILE_KIND, version: 1, presets }, null, 2) + "\n";
}

/** Reads a Vorlagen file. Throws an Error with a German message if it isn't one. */
export function setupFromJson(text: string): NamedSetup[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Die Datei ist keine Vorlagen-Datei (kein gültiges JSON).");
  }
  const d = data as { kind?: unknown; presets?: unknown } | null;
  if (!d || typeof d !== "object" || d.kind !== FILE_KIND || !Array.isArray(d.presets)) throw new Error("Die Datei ist keine Vorlagen-Datei für den Aufbau eines Plans.");
  return readSetupList(d.presets);
}

// ---- Storage -----------------------------------------------------------------------

const LIST_KEY = "simplepdfcompare.vorlagen";
/** The picked one is remembered per Time direction, like the setup itself. */
const pickedKey = (axis: Axis) => `simplepdfcompare.vorlagen.picked.${axis}`;

export function loadSetups(axis: Axis, store: KeyValueStore = localStorage): { presets: NamedSetup[]; selected: string | undefined } {
  try {
    const raw = store.getItem(LIST_KEY);
    const presets = raw ? readSetupList(JSON.parse(raw)) : [];
    const picked = store.getItem(pickedKey(axis));
    return { presets, selected: presets.some((p) => p.name === picked) ? (picked ?? undefined) : undefined };
  } catch {
    return { presets: [], selected: undefined };
  }
}

export function storeSetups(axis: Axis, s: { presets: readonly NamedSetup[]; selected: string | undefined }, store: KeyValueStore = localStorage): void {
  try {
    store.setItem(LIST_KEY, JSON.stringify(s.presets));
    store.setItem(pickedKey(axis), s.selected ?? "");
  } catch {
    // not remembered; the Vorlagen still work
  }
}
