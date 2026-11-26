// Named Vorlagen, whatever they hold (ADR 0009, adapted from simplepdfclipper's ADR 0015).
// Pure logic, no DOM: unique names and importing. What a Vorlage holds and its file format
// belong to its kind (the setup in src/zones/vorlagen.ts, the filter's later).

/** Anything with a name. */
export interface Named {
  name: string;
}

/** Trimmed name with inner whitespace collapsed. */
export const cleanName = (name: string) => name.trim().replace(/\s+/g, " ");

const sameName = (a: string, b: string) => a.localeCompare(b, "de", { sensitivity: "accent" }) === 0;

/** How names of one kind of Vorlage are checked: what it is called (German), and a built-in name nobody may take. */
export interface NameRules {
  noun: string;
  reserved?: string;
}

/** Why `name` can't be used (German, for the UI), or undefined if it can. `except` is the one being renamed. */
export function nameProblem(name: string, presets: readonly Named[], except: string | undefined, rules: NameRules): string | undefined {
  const n = cleanName(name);
  if (!n) return "Bitte einen Namen eingeben.";
  if (rules.reserved && sameName(n, rules.reserved)) return `„${rules.reserved}“ ist fest eingebaut; bitte einen anderen Namen wählen.`;
  if (presets.some((p) => sameName(p.name, n) && p.name !== except)) return `Es gibt schon eine ${rules.noun} „${n}“.`;
  return undefined;
}

/** `name`, or "name (2)", "name (3)", … whichever is still free. */
export function uniqueName(name: string, presets: readonly Named[], rules: NameRules): string {
  const base = cleanName(name) || rules.noun;
  if (!nameProblem(base, presets, undefined, rules)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})`;
    if (!nameProblem(candidate, presets, undefined, rules)) return candidate;
  }
}

/** Imported Vorlagen added to the existing ones; a name clash comes in renamed, never overwrites. */
export function importPresets<P extends Named>(existing: readonly P[], incoming: readonly P[], rules: NameRules): { presets: P[]; added: P[] } {
  const presets = [...existing];
  const added: P[] = [];
  for (const p of incoming) {
    const q = { ...p, name: uniqueName(p.name, presets, rules) };
    presets.push(q);
    added.push(q);
  }
  return { presets, added };
}

// ---- Dropdown state ----------------------------------------------------------------

/** Dropdown value of the built-in entry, and of the "… (geändert)" or "–" entry. */
export const BUILTIN_VALUE = "\u0000builtin";
export const PLACEHOLDER_VALUE = "\u0000changed";

export const byName = (a: Named, b: Named) => a.name.localeCompare(b.name, "de");

/**
 * The entries of the dropdown and the one that shows. With a built-in entry (the filter's "Alle") it
 * always leads the list; without one, "–" stands for none picked. A change by hand puts
 * "Name (geändert)" on top; picking the Vorlage again restores it.
 */
export function dropdownEntries(presets: readonly Named[], selected: string | undefined, changed: boolean, builtin?: string): { entries: { label: string; value: string }[]; value: string } {
  const placeholder = changed || (selected === undefined && !builtin);
  const entries: { label: string; value: string }[] = [];
  if (placeholder) entries.push({ label: changed ? `${selected ?? builtin} (geändert)` : "–", value: PLACEHOLDER_VALUE });
  if (builtin) entries.push({ label: builtin, value: BUILTIN_VALUE });
  for (const p of [...presets].sort(byName)) entries.push({ label: p.name, value: p.name });
  return { entries, value: placeholder ? PLACEHOLDER_VALUE : (selected ?? BUILTIN_VALUE) };
}
