// PROTOTYPE (throwaway): a map-like canvas view in page mm. Drag pans, wheel zooms around
// the cursor. The picture comes from `paint(view, w, h)` (an ImageData, rendered by MuPDF);
// `overlay(ctx, view)` draws lines, handles and areas on top in mm (ctx is already scaled).
// `down(pt, e)` may return { move(pt, e), up(pt, e) } to take over a drag (else: pan).

let spaceDown = false;
addEventListener("keydown", (e) => {
  if (e.key !== " " || e.target.closest("input, textarea, select")) return;
  if (e.target.closest("button")) e.target.blur(); // Space is for panning here, not for re-pressing a button
  spaceDown = true; e.preventDefault();
});
addEventListener("keyup", (e) => { if (e.key === " ") spaceDown = false; });
addEventListener("blur", () => (spaceDown = false));

export function createViewer(host, { paint, overlay = () => {}, down = () => null, hover = () => null, onChange = () => {} }) {
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  host.style.overflow = "hidden";
  host.style.touchAction = "none";
  const base = document.createElement("canvas"), top = document.createElement("canvas");
  for (const c of [base, top]) Object.assign(c.style, { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" });
  host.append(base, top);
  const V = { x0: 0, y0: 0, s: 1, w: 1, h: 1 }; // mm → css px: (mm - x0) * s
  let shot = null, timer = 0, dirty = true;

  const toMm = (e) => { const r = top.getBoundingClientRect(); return { x: V.x0 + (e.clientX - r.left) / V.s, y: V.y0 + (e.clientY - r.top) / V.s, px: e.clientX - r.left, py: e.clientY - r.top }; };

  function size() {
    const r = host.getBoundingClientRect();
    V.w = Math.max(1, Math.round(r.width)); V.h = Math.max(1, Math.round(r.height));
    for (const c of [base, top]) { c.width = V.w * devicePixelRatio; c.height = V.h * devicePixelRatio; }
  }

  function drawTop() {
    const ctx = top.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, top.width, top.height);
    const k = devicePixelRatio * V.s;
    ctx.setTransform(k, 0, 0, k, -V.x0 * k, -V.y0 * k);
    overlay(ctx, V);
  }

  // Cheap preview while moving: the last rendered picture, moved and scaled.
  function preview() {
    const ctx = base.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, base.width, base.height);
    if (shot) {
      const k = V.s / shot.V.s, d = devicePixelRatio;
      ctx.drawImage(shot.canvas, (shot.V.x0 - V.x0) * V.s * d, (shot.V.y0 - V.y0) * V.s * d, shot.canvas.width * k, shot.canvas.height * k);
    }
  }

  function render() {
    const d = devicePixelRatio, w = Math.round(V.w * d), h = Math.round(V.h * d);
    const img = paint({ x0: V.x0, y0: V.y0, s: V.s * d }, w, h);
    if (!img) return;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").putImageData(img, 0, 0);
    shot = { canvas: c, V: { ...V } };
    base.getContext("2d").setTransform(1, 0, 0, 1, 0, 0);
    base.getContext("2d").drawImage(c, 0, 0);
    dirty = false;
  }

  /** Something in the picture changed (or the view moved): preview now, render when idle. */
  function update(fast = 80) {
    dirty = true;
    preview();
    drawTop();
    clearTimeout(timer);
    timer = setTimeout(render, fast);
    onChange(V);
  }

  // Middle or right button, or Space held: always pan (left drag may belong to the variant).
  let drag = null;
  top.addEventListener("contextmenu", (e) => e.preventDefault());
  top.addEventListener("pointerdown", (e) => {
    top.setPointerCapture(e.pointerId);
    const pt = toMm(e), pan = e.button === 1 || e.button === 2; // round 3: Space no longer pans (it shows the New Plan in the comparison)
    const h = pan ? null : down(pt, e, V);
    drag = h ? { h } : { pan: { px: pt.px, py: pt.py, x0: V.x0, y0: V.y0 } };
    if (!h) top.style.cursor = "grabbing";
    if (e.button === 1) e.preventDefault();
  });
  top.addEventListener("pointermove", (e) => {
    const pt = toMm(e);
    if (!drag) { top.style.cursor = hover(pt, e, V) || "grab"; return; }
    if (drag.h) { drag.h.move && drag.h.move(pt, e, V); drawTop(); return; }
    V.x0 = drag.pan.x0 - (pt.px - drag.pan.px) / V.s;
    V.y0 = drag.pan.y0 - (pt.py - drag.pan.py) / V.s;
    update(120);
  });
  top.addEventListener("pointerup", (e) => {
    if (drag && drag.h && drag.h.up) drag.h.up(toMm(e), e, V);
    drag = null;
    top.style.cursor = "grab";
    drawTop();
  });
  top.addEventListener("wheel", (e) => {
    e.preventDefault();
    const pt = toMm(e), f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
    V.s = Math.min(60, Math.max(0.01, V.s * f));
    V.x0 = pt.x - pt.px / V.s; V.y0 = pt.y - pt.py / V.s;
    update(120);
  }, { passive: false });
  new ResizeObserver(() => { size(); update(30); }).observe(host);
  size();

  return {
    V,
    /** Fit an mm rect into the view (with a margin in px). */
    fit(r, margin = 16) {
      size();
      V.s = Math.min((V.w - 2 * margin) / (r.x1 - r.x0), (V.h - 2 * margin) / (r.y1 - r.y0));
      V.x0 = (r.x0 + r.x1) / 2 - V.w / 2 / V.s; V.y0 = (r.y0 + r.y1) / 2 - V.h / 2 / V.s;
      update(10);
    },
    /** Centre on an mm point, keeping the scale. */
    centre(x, y) { V.x0 = x - V.w / 2 / V.s; V.y0 = y - V.h / 2 / V.s; update(60); },
    setView(x0, y0, s) { V.x0 = x0; V.y0 = y0; if (s) V.s = s; update(60); },
    update, redrawOverlay: drawTop,
  };
}

// ---------- compositing helpers (RGB or gray buffers from engine.render*) ----------

export function grayToImage(g, w, h, fade = 1) {
  const img = new ImageData(w, h), d = img.data;
  for (let i = 0; i < w * h; i++) { const v = 255 - (255 - g[i]) * fade; d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = v; d[4 * i + 3] = 255; }
  return img;
}
export function rgbToImage(px, w, h, fade = 1) {
  const img = new ImageData(w, h), d = img.data;
  for (let i = 0, j = 0; i < w * h; i++, j += 3) { d[4 * i] = 255 - (255 - px[j]) * fade; d[4 * i + 1] = 255 - (255 - px[j + 1]) * fade; d[4 * i + 2] = 255 - (255 - px[j + 2]) * fade; d[4 * i + 3] = 255; }
  return img;
}
/**
 * Two Plans in two colours: Old only = blue-green, New only = red-magenta, both = black.
 * Where they line up, the picture looks like one black Plan; a wrong Offset doubles it.
 */
export function tint(gOld, gNew, w, h) {
  const img = new ImageData(w, h), d = img.data;
  // Ink both Plans share is drawn neutral (grey to black); ink only the Old Plan has is
  // blue, ink only the New Plan has is magenta-red.
  for (let i = 0; i < w * h; i++) {
    const io = gOld ? 1 - gOld[i] / 255 : 0, iN = gNew ? 1 - gNew[i] / 255 : 0;
    const c = Math.min(io, iN), eo = io - c, en = iN - c, base = 255 * (1 - c);
    d[4 * i] = base - eo * 230 - en * 35;
    d[4 * i + 1] = base - eo * 115 - en * 230;
    d[4 * i + 2] = base - eo * 55 - en * 135;
    d[4 * i + 3] = 255;
  }
  return img;
}
/** Plain 50 % see-through overlay of both Plans. */
export function blend(gOld, gNew, w, h) {
  const img = new ImageData(w, h), d = img.data;
  for (let i = 0; i < w * h; i++) { const v = ((gOld ? gOld[i] : 255) + (gNew ? gNew[i] : 255)) / 2; d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = v; d[4 * i + 3] = 255; }
  return img;
}
