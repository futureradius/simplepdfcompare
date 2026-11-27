// "Vorlage: [▾] [✎]" and its window (save, overwrite, rename, delete, export, import), one
// component for every kind of Vorlage: the setup in "Alter Plan" and the filter in "Vergleich"
// (ADR 0009). Adapted from simplepdfclipper's presetmenu.ts (ADR 0015) with two differences:
// it builds its own elements instead of finding them in the page, and it is not tied to one
// place, so a kind only says what a Vorlage holds and how it is applied and compared.

import { BUILTIN_VALUE, byName, cleanName, dropdownEntries, importPresets, nameProblem, PLACEHOLDER_VALUE, type Named, type NameRules } from "./presets";
import { saveFile } from "./save";

export interface PresetKind<P extends Named, T> {
  /** Prefix of the element ids: `${prefix}-select`, `-edit`, `-dialog`, `-list`, `-name`, `-save`, ... */
  prefix: string;
  rules: NameRules;
  /** "Vorlagen", for the window and messages. */
  plural: string;
  /** Label of a built-in entry that is always in the dropdown (the filter's "Alle"); none: "–" stands for none picked. */
  builtin?: string;
  fileName: string;
  /** Text of the overwrite button for the picked Vorlage. */
  overwriteLabel(name: string): string;
  /** Tooltip of the dropdown while the picked Vorlage is changed. */
  changedTitle: string;
  /** Tooltip of the disabled overwrite button. */
  sameTitle: string;
  /** What would be saved now, or why there is nothing to save (German). */
  current(): { value: T } | { problem: string };
  valueOf(p: P): T;
  make(name: string, value: T): P;
  /** Applies a Vorlage's value, or the built-in one (undefined). */
  apply(value: T | undefined): void;
  /** Whether `current` equals `saved` (undefined: the built-in value). */
  same(current: T, saved: T | undefined): boolean;
  load(): { presets: P[]; selected: string | undefined };
  store(s: { presets: readonly P[]; selected: string | undefined }): void;
  toJson(presets: readonly P[]): string;
  /** Throws an Error with a German message if the file isn't one. */
  fromJson(text: string): P[];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, id = "", className = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (id) e.id = id;
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

export class PresetMenu<P extends Named, T> {
  /** The row "Vorlage: [▾] [✎]" to put into the page. The window is added to the page by itself. */
  readonly el: HTMLElement;
  private presets: P[] = [];
  /** The Vorlage last picked; undefined: the built-in entry, or none. */
  private selected: string | undefined;
  private readonly select: HTMLSelectElement;
  private readonly dialog: HTMLDialogElement;
  private readonly list: HTMLUListElement;
  private readonly empty: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly message: HTMLElement;
  private readonly overwriteButton: HTMLButtonElement;
  private readonly exportButton: HTMLButtonElement;
  /** The Vorlage being renamed in the list. */
  private renaming: string | undefined;

  constructor(private readonly kind: PresetKind<P, T>) {
    const id = (s: string) => `${kind.prefix}-${s}`;
    this.el = el("div", id("row"), "preset-row");
    const label = el("label", "", "", "Vorlage");
    this.select = el("select", id("select"));
    this.select.setAttribute("aria-label", "Vorlage");
    label.htmlFor = this.select.id;
    const input = el("div", "", "input");
    input.append(this.select);
    const edit = el("button", id("edit"), "btn", "✎");
    edit.type = "button";
    edit.title = `${kind.plural} verwalten`;
    edit.setAttribute("aria-label", edit.title);
    this.el.append(label, input, edit);

    this.dialog = el("dialog", id("dialog"), "preset-dialog");
    this.dialog.setAttribute("aria-labelledby", id("title"));
    const body = el("div", "", "body");
    this.list = el("ul", id("list"), "preset-list");
    this.empty = el("p", id("empty"), "muted", `Noch keine ${kind.plural}.`);
    this.nameInput = el("input", id("name"));
    this.nameInput.type = "text";
    this.nameInput.placeholder = "Name der neuen Vorlage";
    this.nameInput.setAttribute("aria-label", "Name");
    const save = el("button", id("save"), "btn primary", "Aktuelle Einstellungen als neue Vorlage speichern");
    this.overwriteButton = el("button", id("overwrite"), "btn");
    for (const b of [save, this.overwriteButton]) b.type = "button";
    const fresh = el("div", "", "preset-new");
    fresh.append(this.nameInput, save, this.overwriteButton);
    this.message = el("p", id("msg"), "muted");
    this.message.setAttribute("role", "status");
    this.message.hidden = true;
    body.append(el("h2", id("title"), "", kind.plural), this.list, this.empty, fresh, this.message);

    const foot = el("div", "", "foot");
    this.exportButton = el("button", id("export"), "btn", "Exportieren…");
    const importButton = el("button", id("import"), "btn", "Importieren…");
    const close = el("button", id("close"), "btn primary", "Schließen");
    for (const b of [this.exportButton, importButton, close]) b.type = "button";
    const file = el("input", id("file"));
    file.type = "file";
    file.accept = ".json,application/json";
    file.hidden = true;
    foot.append(this.exportButton, importButton, close, file);
    this.dialog.append(body, foot);
    document.body.append(this.dialog);

    // Wiring.
    this.select.addEventListener("change", () => {
      const v = this.select.value;
      if (v === PLACEHOLDER_VALUE) return;
      const name = v === BUILTIN_VALUE ? undefined : v;
      // Already in effect: nothing to do (Chrome fires "change" again on blur once the options were rebuilt).
      if (name === this.selected && !this.isChanged()) return;
      this.pick(name);
    });
    edit.addEventListener("click", () => this.open());
    close.addEventListener("click", () => this.dialog.close());
    save.addEventListener("click", () => this.saveNew());
    this.nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.saveNew();
    });
    this.overwriteButton.addEventListener("click", () => this.overwrite());
    this.exportButton.addEventListener("click", () => void this.exportFile());
    importButton.addEventListener("click", () => file.click());
    file.addEventListener("change", () => {
      const f = file.files?.[0];
      file.value = "";
      if (f) void this.importFile(f);
    });

    this.reload();
  }

  /** Reads the Vorlagen and the picked one again (the kind keeps the picked one per setup it belongs to). */
  reload(): void {
    const stored = this.kind.load();
    this.presets = stored.presets;
    this.selected = this.presets.some((p) => p.name === stored.selected) ? stored.selected : undefined;
    this.render();
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  /** What is shown changed (by hand, or by applying a Vorlage): updates the dropdown. */
  render(): void {
    this.presets.sort(byName);
    const changed = this.isChanged();
    const { entries, value } = dropdownEntries(this.presets, this.selected, changed, this.kind.builtin);
    this.select.replaceChildren(...entries.map((e) => new Option(e.label, e.value)));
    this.select.value = value;
    this.select.title = changed ? this.kind.changedTitle : "";
    if (this.dialog.open) this.renderDialog();
  }

  // ---- Applying -------------------------------------------------------------------

  private valueOf(name: string | undefined): T | undefined {
    const p = this.presets.find((q) => q.name === name);
    return p && this.kind.valueOf(p);
  }

  private pick(name: string | undefined): void {
    this.selected = name;
    this.save();
    this.kind.apply(this.valueOf(name)); // reports back through render()
    this.render();
  }

  private save(): void {
    this.kind.store({ presets: this.presets, selected: this.selected });
  }

  /** Whether what is shown differs from the picked Vorlage (or the built-in value). */
  private isChanged(): boolean {
    if (this.selected === undefined && !this.kind.builtin) return false;
    const c = this.kind.current();
    if (!("value" in c)) return true;
    return !this.kind.same(c.value, this.valueOf(this.selected));
  }

  // ---- Window ---------------------------------------------------------------------

  private renderDialog(): void {
    const rows = this.presets.map((p) => this.row(p));
    this.list.replaceChildren(...rows);
    this.list.hidden = rows.length === 0;
    this.empty.hidden = rows.length > 0;
    this.exportButton.disabled = rows.length === 0;
    this.overwriteButton.hidden = this.selected === undefined;
    this.overwriteButton.textContent = this.kind.overwriteLabel(this.selected ?? "");
    const current = this.kind.current();
    this.overwriteButton.disabled = !("value" in current) || !this.isChanged();
    this.overwriteButton.title = "problem" in current ? current.problem : this.overwriteButton.disabled ? this.kind.sameTitle : "";
  }

  private row(p: P): HTMLLIElement {
    const li = document.createElement("li");
    li.dataset.name = p.name;
    if (p.name === this.selected) li.classList.add("current");
    const button = (text: string, onClick: () => void) => {
      const b = el("button", "", "btn", text);
      b.type = "button";
      b.addEventListener("click", onClick);
      return b;
    };
    if (this.renaming === p.name) {
      const input = el("input", "", "name");
      input.type = "text";
      input.value = p.name;
      input.setAttribute("aria-label", "Neuer Name");
      const ok = () => this.rename(p.name, input.value);
      const cancel = () => {
        this.renaming = undefined;
        this.say("");
        this.renderDialog();
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") ok();
        else if (e.key === "Escape") {
          e.preventDefault(); // don't close the window
          cancel();
        }
      });
      li.append(input, button("OK", ok), button("Abbrechen", cancel));
      queueMicrotask(() => input.select());
    } else {
      li.append(
        el("span", "", "name", p.name),
        button("Umbenennen", () => {
          this.renaming = p.name;
          this.say("");
          this.renderDialog();
        }),
        button("Löschen", () => this.remove(p.name)),
      );
    }
    return li;
  }

  private say(text: string, warn = false): void {
    this.message.textContent = text;
    this.message.classList.toggle("warn", warn);
    this.message.hidden = !text;
  }

  private open(): void {
    this.renaming = undefined;
    this.nameInput.value = "";
    this.say("");
    this.renderDialog();
    this.dialog.showModal();
    this.nameInput.focus();
  }

  private saveNew(): void {
    const problem = nameProblem(this.nameInput.value, this.presets, undefined, this.kind.rules);
    if (problem) return this.say(problem, true);
    const current = this.kind.current();
    if (!("value" in current)) return this.say(current.problem, true);
    const name = cleanName(this.nameInput.value);
    this.presets.push(this.kind.make(name, current.value));
    this.selected = name;
    this.nameInput.value = "";
    this.save();
    this.render();
    this.say(`${this.kind.rules.noun} „${name}“ gespeichert.`);
  }

  private overwrite(): void {
    const i = this.presets.findIndex((q) => q.name === this.selected);
    const current = this.kind.current();
    if (i < 0 || !("value" in current)) return;
    this.presets[i] = this.kind.make(this.presets[i]!.name, current.value);
    this.save();
    this.render();
    this.say(`${this.kind.rules.noun} „${this.selected}“ überschrieben.`);
  }

  private rename(from: string, to: string): void {
    const problem = nameProblem(to, this.presets, from, this.kind.rules);
    if (problem) return this.say(problem, true);
    const name = cleanName(to);
    const p = this.presets.find((q) => q.name === from);
    if (!p) return;
    p.name = name;
    if (this.selected === from) this.selected = name;
    this.renaming = undefined;
    this.save();
    this.say("");
    this.render();
  }

  private remove(name: string): void {
    const { noun } = this.kind.rules;
    if (!confirm(`${noun} „${name}“ löschen?`)) return;
    this.presets = this.presets.filter((p) => p.name !== name);
    if (this.selected === name) this.selected = undefined;
    if (this.renaming === name) this.renaming = undefined;
    this.save();
    this.render();
    this.say(`${noun} „${name}“ gelöscht.`);
  }

  private async exportFile(): Promise<void> {
    const blob = new Blob([this.kind.toJson(this.presets)], { type: "application/json" });
    await saveFile(blob, this.kind.fileName, this.kind.plural, "application/json", ".json");
  }

  private async importFile(file: File): Promise<void> {
    const { rules, plural } = this.kind;
    let incoming: P[];
    try {
      incoming = this.kind.fromJson(await file.text());
    } catch (e) {
      return this.say(e instanceof Error ? e.message : String(e), true);
    }
    if (incoming.length === 0) return this.say(`Die Datei enthält keine ${plural}.`, true);
    const { presets, added } = importPresets(this.presets, incoming, rules);
    this.presets = presets;
    this.save();
    this.render();
    const names = added.map((p) => `„${p.name}“`).join(", ");
    this.say(added.length === 1 ? `1 ${rules.noun} importiert: ${names}.` : `${added.length} ${plural} importiert: ${names}.`);
  }
}
