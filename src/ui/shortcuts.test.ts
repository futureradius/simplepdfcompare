import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { handledKeys, handledKeysIn } from "../testing/handledkeys";
import { SHORTCUT_GROUPS } from "./shortcuts";

/**
 * Keys the code handles that "Tastenkürzel" leaves out on purpose, with the reason.
 * Keep this short: a key the user can press belongs in "Über".
 */
const NOT_LISTED: { file: string; key: string; why: string }[] = [
  { file: "busy.ts", key: "Escape", why: "Esc presses the busy window's Abbrechen, and no job in v1 offers one (taken over from the clipper for when one does)" },
];

const handled = handledKeysIn(resolve(__dirname, ".."), ["shortcuts.ts"]);

describe("reading the handled keys from the code", () => {
  it("finds keys compared to e.key, the cases of switch (e.key), includes(e.key) and named keys", () => {
    const code = `
      if (e.key === "Enter" || e.key === " ") go();
      if (e.key !== "Escape") return;
      switch (e.key) { case "1": a(); break; case "f": case "F": { b(); break; } }
      else if (["Home", "End"].includes(e.key)) c();
      const forward = axis === "y" ? "ArrowDown" : "ArrowRight";`;
    expect([...handledKeys(code)].sort()).toEqual([" ", "1", "ArrowDown", "ArrowRight", "End", "Enter", "Escape", "F", "Home"].sort());
  });

  it("counts a modifier only where it changes what happens, not where it makes the key ignored", () => {
    expect([...handledKeys(`if (!down || e.ctrlKey || e.metaKey || e.altKey) return;`)]).toEqual([]);
    expect([...handledKeys(`else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === "1") fit();`)]).toEqual(["1"]);
    expect([...handledKeys(`const step = e.ctrlKey ? 1 : 0.1;`)]).toEqual(["Control"]);
    expect([...handledKeys(`mode: e.metaKey ? "remove" : e.shiftKey ? "add" : "replace"`)].sort()).toEqual(["Control", "Shift"]);
    expect([...handledKeys(`snap(x, e.altKey)`)]).toEqual(["Alt"]);
  });

  it("finds the keys of this app (the scan is not empty by mistake)", () => {
    expect(handled.get("placesui.ts")).toEqual(new Set(["ArrowRight", "J", "ArrowLeft", "K", "H", "M", "Escape"]));
    expect(handled.get("setuptabs.ts")).toEqual(new Set(["1", "2", "3", "F", "Delete"]));
    expect(handled.get("offsetmodel.ts")).toEqual(new Set(["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "PageDown", "PageUp", "Control"]));
  });
});

describe("Tastenkürzel in Über", () => {
  it("lists every key the code handles, in a chapter that covers the file that handles it", () => {
    const missing: string[] = [];
    for (const [file, keys] of handled)
      for (const key of keys) {
        if (NOT_LISTED.some((n) => n.file === file && n.key === key)) continue;
        const listed = SHORTCUT_GROUPS.some((g) => g.sources.includes(file) && g.rows.some((r) => r.keys.includes(key)));
        if (!listed) missing.push(`${file}: ${JSON.stringify(key)}`);
      }
    expect(missing).toEqual([]);
  });

  it("lists no key that the files of its chapter do not handle", () => {
    const stale: string[] = [];
    for (const g of SHORTCUT_GROUPS)
      for (const r of g.rows)
        for (const key of r.keys) if (!g.sources.some((f) => handled.get(f)?.has(key))) stale.push(`${g.title}: ${JSON.stringify(key)}`);
    expect(stale).toEqual([]);
  });

  it("names as sources only files that handle keys", () => {
    for (const g of SHORTCUT_GROUPS) for (const f of g.sources) expect(handled.has(f), `${g.title}: ${f}`).toBe(true);
  });
});
