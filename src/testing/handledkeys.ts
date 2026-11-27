// Reads which keys a source file handles, for the test that keeps "Tastenkürzel" in "Über"
// complete. It reads the code as text, so it knows the ways this code base looks at a key:
//   e.key === "x", e.key !== "x", case "x": inside switch (e.key), [...].includes(e.key),
//   a named key ("ArrowDown", "PageUp", "Escape", ...) as a string anywhere in the file (nudgeFromKey picks
//   its arrow in a ternary), and the modifiers read as e.ctrlKey / e.metaKey (both Strg),
//   e.shiftKey and e.altKey, unless only as a guard that ignores the key ("if (e.altKey) return",
//   "!e.altKey").
// Letters are given in upper case ("f" and "F" are one key).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

// Not "Alt", "Shift" ... here: "Alt" is also the German word for Old. Modifiers are found below.
const NAMED = /"(Arrow(?:Up|Down|Left|Right)|Page(?:Up|Down)|Home|End|Enter|Escape|Delete|Backspace|Tab|Insert|F\d{1,2})"/g;
const MODIFIER: Record<string, string> = { ctrlKey: "Control", metaKey: "Control", shiftKey: "Shift", altKey: "Alt" };

const norm = (k: string) => (/^[a-z]$/.test(k) ? k.toUpperCase() : k);

/** The keys one file's code handles. */
export function handledKeys(code: string): Set<string> {
  const keys = new Set<string>();
  const add = (k: string) => keys.add(norm(k));
  for (const m of code.matchAll(/\be\.key\s*[!=]==\s*"([^"]+)"/g)) add(m[1]!);
  for (const m of code.matchAll(/\[([^\]]*)\]\.includes\(e\.key\)/g)) for (const s of m[1]!.matchAll(/"([^"]+)"/g)) add(s[1]!);
  for (const block of switchBlocks(code)) for (const m of block.matchAll(/case\s+"([^"]+)"\s*:/g)) add(m[1]!);
  for (const m of code.matchAll(NAMED)) add(m[1]!);
  // Modifiers: drop the guards first, then every read that is left handles the modifier.
  const unguarded = code.replace(/if\s*\(([^;{}]*)\)\s*return\b[^;]*;/g, "").replace(/!e\.\w+Key\b/g, "");
  for (const m of unguarded.matchAll(/\be\.(ctrlKey|metaKey|shiftKey|altKey)\b/g)) add(MODIFIER[m[1]!]!);
  return keys;
}

/** The bodies of `switch (e.key) { ... }`. */
function switchBlocks(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/switch\s*\(e\.key\)\s*\{/g)) {
    let depth = 1,
      i = m.index! + m[0].length;
    const start = i;
    for (; i < code.length && depth > 0; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}") depth--;
    }
    out.push(code.slice(start, i - 1));
  }
  return out;
}

/** Every handled key of every source file under `dir` (tests and the testing helpers left out), by file name. */
export function handledKeysIn(dir: string, skip: string[] = []): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) {
        if (name !== "testing") walk(p);
      } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts") && !skip.includes(name)) {
        const keys = handledKeys(readFileSync(p, "utf8"));
        if (keys.size) out.set(basename(p), keys);
      }
    }
  };
  walk(dir);
  return out;
}
