// The dropdown that changes the kind of a zone in its sidebar row (Ausgenommen, Zeitachse,
// Wegachse, Vorgänge). A button that opens a list, styled like the clipper's inputs and cards.
// Keyboard: Enter, Space or the arrow keys open it, the arrow keys move, Enter or Space pick,
// Esc closes. Clicking elsewhere closes it.

import { KIND_NAME, type ZoneKind } from "../zones/model";

const KINDS: ZoneKind[] = ["area", "time", "path", "rows"];

/** The entry a key moves to: arrows step and stop at the ends, Home and End jump. */
export function menuIndex(current: number, key: string, count: number): number {
  if (key === "ArrowDown") return Math.min(count - 1, current + 1);
  if (key === "ArrowUp") return Math.max(0, current - 1);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return current;
}

export interface KindMenu {
  el: HTMLElement;
  button: HTMLButtonElement;
  open(): void;
  close(): void;
}

export function createKindMenu(opts: { label: string; kind: ZoneKind; onPick: (kind: ZoneKind) => void }): KindMenu {
  const wrap = document.createElement("div");
  wrap.className = "kind-menu";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "kind-btn";
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  button.title = "Art des Bereichs ändern";
  const text = document.createElement("span");
  text.textContent = opts.label;
  const chev = document.createElement("span");
  chev.className = "chev";
  chev.setAttribute("aria-hidden", "true");
  chev.textContent = "▾";
  button.append(text, chev);

  const list = document.createElement("ul");
  list.className = "kind-list";
  list.setAttribute("role", "listbox");
  list.tabIndex = -1;
  list.hidden = true;
  const items = KINDS.map((k) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.dataset.kind = k;
    li.textContent = KIND_NAME[k];
    li.setAttribute("aria-selected", String(k === opts.kind));
    list.append(li);
    return li;
  });
  wrap.append(button, list);

  let active = KINDS.indexOf(opts.kind);
  const mark = () => items.forEach((li, i) => li.classList.toggle("active", i === active));
  const onOutside = (e: PointerEvent) => {
    if (!wrap.contains(e.target as Node)) close();
  };
  function close(): void {
    if (list.hidden) return;
    list.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
  }
  function open(): void {
    if (!list.hidden) return;
    list.hidden = false;
    button.setAttribute("aria-expanded", "true");
    active = KINDS.indexOf(opts.kind);
    mark();
    list.focus();
    document.addEventListener("pointerdown", onOutside, true);
  }
  function pick(i: number): void {
    close();
    button.focus();
    if (KINDS[i] !== opts.kind) opts.onPick(KINDS[i]!);
  }

  button.addEventListener("click", (e) => {
    e.stopPropagation();
    if (list.hidden) open();
    else close();
  });
  button.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      open();
    }
  });
  list.addEventListener("keydown", (e) => {
    e.stopPropagation(); // the view's keys (1, 2, 3, F, Entf) do not apply while the list is open
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      button.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Tab") close();
    else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      active = menuIndex(active, e.key, items.length);
      mark();
    }
  });
  items.forEach((li, i) => {
    li.addEventListener("click", (e) => {
      e.stopPropagation();
      pick(i);
    });
    li.addEventListener("pointermove", () => {
      active = i;
      mark();
    });
  });
  list.addEventListener("click", (e) => e.stopPropagation());
  return { el: wrap, button, open, close };
}
