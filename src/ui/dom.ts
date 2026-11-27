// Small helpers to build the sidebar's elements (plain DOM, no framework).

type Child = Node | string | null | undefined | false;
type Props = Partial<{ class: string; title: string; type: string; hidden: boolean; draggable: boolean; tabindex: number; role: string }> & {
  data?: Record<string, string>;
  aria?: Record<string, string>;
  on?: { [K in keyof HTMLElementEventMap]?: (e: HTMLElementEventMap[K]) => void };
  style?: string;
};

/** An element with its class, title, data attributes, listeners and children. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.title) el.title = props.title;
  if (props.type) el.setAttribute("type", props.type);
  if (props.hidden) el.hidden = true;
  if (props.draggable) el.draggable = true;
  if (props.tabindex !== undefined) el.tabIndex = props.tabindex;
  if (props.role) el.setAttribute("role", props.role);
  if (props.style) el.setAttribute("style", props.style);
  for (const [k, v] of Object.entries(props.data ?? {})) el.dataset[k] = v;
  for (const [k, v] of Object.entries(props.aria ?? {})) el.setAttribute(`aria-${k}`, v);
  for (const [k, f] of Object.entries(props.on ?? {})) el.addEventListener(k, f as EventListener);
  for (const c of children) if (c) el.append(c);
  return el;
}

const SVG = "http://www.w3.org/2000/svg";

/** A small grey line icon (24 px drawing grid), drawn from path data. */
export function icon(paths: string, label = "", size = 15): SVGSVGElement {
  const s = document.createElementNS(SVG, "svg");
  s.setAttribute("width", String(size));
  s.setAttribute("height", String(size));
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "2");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.classList.add("ico");
  if (label) s.setAttribute("aria-label", label);
  else s.setAttribute("aria-hidden", "true");
  s.innerHTML = paths;
  return s;
}

export const FUNNEL = (size = 15) => icon('<path d="M3 4h18l-7 8.5V19l-4 2v-8.5z"/>', "", size);
export const EYE_OFF = () =>
  icon('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/>');
