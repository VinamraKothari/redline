/**
 * DOM helpers that run against the (same-origin) iframe document.
 * Everything here is pure & synchronous; the FrameController owns the iframe.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SKIP_TAGS = new Set(["HTML", "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

export function isElement(n: Node | null | undefined): n is Element {
  return !!n && n.nodeType === 1;
}

/** Bounding box in page coordinates (scroll included). */
export function pageRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  const win = el.ownerDocument.defaultView!;
  return { x: r.left + win.scrollX, y: r.top + win.scrollY, w: r.width, h: r.height };
}

function sameBox(a: DOMRect, b: DOMRect, tol = 1): boolean {
  return (
    Math.abs(a.left - b.left) <= tol &&
    Math.abs(a.top - b.top) <= tol &&
    Math.abs(a.width - b.width) <= tol &&
    Math.abs(a.height - b.height) <= tol
  );
}

/**
 * Element under a viewport point.
 * `deep` = innermost element (Figma's Ctrl/⌘ deep-select).
 * Otherwise we collapse "wrapper" chains: walk up while the parent's box is
 * identical, so a click lands on the component boundary rather than an inner
 * span that happens to fill it.
 */
export function targetAt(doc: Document, vx: number, vy: number, deep: boolean): Element | null {
  const el = doc.elementFromPoint(vx, vy);
  if (!el || SKIP_TAGS.has(el.tagName)) return null;
  if (el === doc.body) return el;
  if (deep) return el;
  let cur: Element = el;
  let box = cur.getBoundingClientRect();
  while (cur.parentElement && cur.parentElement !== doc.body && cur.parentElement !== doc.documentElement) {
    const pb = cur.parentElement.getBoundingClientRect();
    if (!sameBox(box, pb)) break;
    cur = cur.parentElement;
    box = pb;
  }
  return cur;
}

/** Ancestors from body → el for breadcrumbs. */
export function ancestry(el: Element): Element[] {
  const out: Element[] = [];
  let cur: Element | null = el;
  while (cur && cur.tagName !== "HTML") {
    out.unshift(cur);
    cur = cur.parentElement;
  }
  return out;
}

export function shortLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id && /^[a-zA-Z][\w-]*$/.test(el.id) ? `#${el.id}` : "";
  const cls = Array.from(el.classList)
    .filter((c) => /^[a-zA-Z_][\w-]*$/.test(c) && c.length < 32)
    .slice(0, 2)
    .map((c) => `.${c}`)
    .join("");
  return `${tag}${id}${cls}`;
}

export function pathLabel(el: Element, max = 4): string {
  const chain = ancestry(el).slice(-max);
  return chain.map(shortLabel).join(" › ");
}

/* ─── Selector generation & resolution ──────────────────────────────────── */

function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(s);
  return s.replace(/([^\w-])/g, "\\$1");
}

function uniqueIn(doc: Document, sel: string, el: Element): boolean {
  try {
    const found = doc.querySelectorAll(sel);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

/**
 * Builds a selector that survives reasonable DOM churn:
 *  1. unique id / data-testid / aria-label anchors when available
 *  2. otherwise tag + stable classes + :nth-of-type, climbing until unique
 */
export function buildSelector(el: Element): string {
  const doc = el.ownerDocument;
  if (el === doc.body) return "body";

  const anchorAttrs = ["id", "data-testid", "data-test", "data-id", "name", "aria-label"];
  const parts: string[] = [];
  let cur: Element | null = el;

  while (cur && cur !== doc.body && cur !== doc.documentElement) {
    let part = cur.tagName.toLowerCase();
    let anchored = false;
    for (const a of anchorAttrs) {
      const v = cur.getAttribute(a);
      if (v && v.length < 80 && !/^\d/.test(v) && !/[\s"']/.test(v)) {
        const cand = a === "id" ? `#${cssEscape(v)}` : `${part}[${a}="${v}"]`;
        if (uniqueIn(doc, cand, cur)) {
          parts.unshift(cand);
          anchored = true;
          break;
        }
      }
    }
    if (anchored) break;

    const stable = Array.from(cur.classList)
      .filter((c) => /^[a-zA-Z_][\w-]*$/.test(c) && !/\d{3,}|^(is-|has-|js-|active|hover|focus|open)/.test(c) && c.length < 40)
      .slice(0, 2);
    if (stable.length) part += stable.map((c) => `.${cssEscape(c)}`).join("");

    const parent: Element | null = cur.parentElement;
    if (parent) {
      const tag = cur.tagName;
      const sameTag = Array.from(parent.children).filter((c: Element) => c.tagName === tag);
      if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
    }
    parts.unshift(part);

    const sel = parts.join(" > ");
    if (uniqueIn(doc, sel, el)) return sel;
    cur = parent;
  }
  const sel = parts.join(" > ");
  return uniqueIn(doc, sel, el) ? sel : "body > " + sel;
}

export function resolveSelector(doc: Document, selector: string | null | undefined): Element | null {
  if (!selector) return null;
  try {
    return doc.querySelector(selector);
  } catch {
    return null;
  }
}

/* ─── Computed style extraction ─────────────────────────────────────────── */

export interface ElementInfo {
  tag: string;
  label: string;
  path: string;
  selector: string;
  rect: Rect;
  text: string | null;
  typography: {
    family: string;
    primaryFamily: string;
    size: string;
    weight: string;
    lineHeight: string;
    letterSpacing: string;
    transform: string;
    align: string;
    style: string;
    decoration: string;
  };
  colors: { text: string; background: string; border: string; effectiveBackground: string };
  box: {
    display: string;
    position: string;
    margin: [string, string, string, string];
    padding: [string, string, string, string];
    borderWidth: [string, string, string, string];
    borderStyle: string;
    radius: string;
    shadow: string;
    opacity: string;
    overflow: string;
    zIndex: string;
    gap: string;
    flexDirection: string;
    justify: string;
    alignItems: string;
  };
  img: { src: string; natural: string } | null;
  a: { href: string } | null;
  attributes: Record<string, string>;
  contrast: { ratio: number; aa: boolean; aaa: boolean; large: boolean } | null;
}

function toRgb(c: string): [number, number, number, number] | null {
  const m = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/);
  if (!m) return null;
  let a = m[4] === undefined ? 1 : parseFloat(m[4]);
  if (m[4]?.endsWith("%")) a = a / 100;
  return [+m[1], +m[2], +m[3], a];
}

export function rgbToHex(c: string): string {
  const v = toRgb(c);
  if (!v) return c;
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  const base = `#${hex(v[0])}${hex(v[1])}${hex(v[2])}`.toUpperCase();
  return v[3] < 1 ? `${base} ${Math.round(v[3] * 100)}%` : base;
}

function luminance([r, g, b]: [number, number, number, number]): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** First non-transparent background walking up the tree (approximation of the painted background). */
export function effectiveBackground(el: Element): string {
  const win = el.ownerDocument.defaultView!;
  let cur: Element | null = el;
  while (cur) {
    const bg = win.getComputedStyle(cur).backgroundColor;
    const v = toRgb(bg);
    if (v && v[3] > 0.05) return bg;
    cur = cur.parentElement;
  }
  return "rgb(255, 255, 255)";
}

export function contrastRatio(fg: string, bg: string): number | null {
  const a = toRgb(fg);
  const b = toRgb(bg);
  if (!a || !b) return null;
  const l1 = luminance(a);
  const l2 = luminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function px(v: string): string {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return v;
  return `${Math.round(n * 100) / 100}px`;
}

function hasOwnText(el: Element): boolean {
  return Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || "").trim().length > 0);
}

export function inspect(el: Element): ElementInfo {
  const win = el.ownerDocument.defaultView!;
  const cs = win.getComputedStyle(el);
  const rect = pageRect(el);
  const family = cs.fontFamily;
  const primaryFamily = family.split(",")[0].trim().replace(/^["']|["']$/g, "");
  const textOwn = hasOwnText(el);
  const text = textOwn ? (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 140) : null;
  const effBg = effectiveBackground(el);
  const ratio = textOwn ? contrastRatio(cs.color, effBg) : null;
  const size = parseFloat(cs.fontSize);
  const weight = parseInt(cs.fontWeight, 10) || 400;
  const large = size >= 24 || (size >= 18.66 && weight >= 700);

  const attributes: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    if (a.name === "style" || a.name === "class") continue;
    if (a.value.length > 120) continue;
    attributes[a.name] = a.value;
    if (Object.keys(attributes).length >= 8) break;
  }

  const img = el instanceof win.HTMLImageElement ? { src: el.currentSrc || el.src, natural: `${el.naturalWidth}×${el.naturalHeight}` } : null;
  const a = el instanceof win.HTMLAnchorElement ? { href: el.href } : null;

  return {
    tag: el.tagName.toLowerCase(),
    label: shortLabel(el),
    path: pathLabel(el),
    selector: buildSelector(el),
    rect,
    text,
    typography: {
      family,
      primaryFamily,
      size: px(cs.fontSize),
      weight: cs.fontWeight,
      lineHeight: cs.lineHeight === "normal" ? "normal" : px(cs.lineHeight),
      letterSpacing: cs.letterSpacing === "normal" ? "0px" : px(cs.letterSpacing),
      transform: cs.textTransform,
      align: cs.textAlign,
      style: cs.fontStyle,
      decoration: cs.textDecorationLine,
    },
    colors: {
      text: cs.color,
      background: cs.backgroundColor,
      border: cs.borderTopColor,
      effectiveBackground: effBg,
    },
    box: {
      display: cs.display,
      position: cs.position,
      margin: [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].map(px) as ElementInfo["box"]["margin"],
      padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(px) as ElementInfo["box"]["padding"],
      borderWidth: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(px) as ElementInfo["box"]["borderWidth"],
      borderStyle: cs.borderTopStyle,
      radius: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius]
        .map(px)
        .reduce((acc, v, i, arr) => (arr.every((x) => x === arr[0]) ? arr[0] : acc + (i ? " " : "") + v), ""),
      shadow: cs.boxShadow,
      opacity: cs.opacity,
      overflow: cs.overflow,
      zIndex: cs.zIndex,
      gap: cs.gap,
      flexDirection: cs.flexDirection,
      justify: cs.justifyContent,
      alignItems: cs.alignItems,
    },
    img,
    a,
    attributes,
    contrast:
      ratio != null
        ? { ratio: Math.round(ratio * 100) / 100, aa: ratio >= (large ? 3 : 4.5), aaa: ratio >= (large ? 4.5 : 7), large }
        : null,
  };
}

/** Box model in page coordinates: margin / border / padding / content rectangles. */
export function boxModel(el: Element) {
  const win = el.ownerDocument.defaultView!;
  const cs = win.getComputedStyle(el);
  const border = pageRect(el);
  const n = (v: string) => parseFloat(v) || 0;
  const m = { t: n(cs.marginTop), r: n(cs.marginRight), b: n(cs.marginBottom), l: n(cs.marginLeft) };
  const p = { t: n(cs.paddingTop), r: n(cs.paddingRight), b: n(cs.paddingBottom), l: n(cs.paddingLeft) };
  const bw = { t: n(cs.borderTopWidth), r: n(cs.borderRightWidth), b: n(cs.borderBottomWidth), l: n(cs.borderLeftWidth) };
  const margin: Rect = { x: border.x - m.l, y: border.y - m.t, w: border.w + m.l + m.r, h: border.h + m.t + m.b };
  const padding: Rect = { x: border.x + bw.l, y: border.y + bw.t, w: border.w - bw.l - bw.r, h: border.h - bw.t - bw.b };
  const content: Rect = {
    x: padding.x + p.l,
    y: padding.y + p.t,
    w: padding.w - p.l - p.r,
    h: padding.h - p.t - p.b,
  };
  return { margin, border, padding, content, m, p, bw };
}

/* ─── Measurement (Figma-style distances between two boxes) ─────────────── */

export interface MeasureLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: number;
  axis: "h" | "v";
}

/**
 * Distances between rect A (selected) and rect B (hovered with Alt).
 * Handles separated, overlapping and nested boxes like Figma:
 *  - separated: one line across the gap on each axis where they are apart
 *  - nested/overlapping: lines from A's edges to B's edges on all four sides
 */
export function measure(a: Rect, b: Rect): MeasureLine[] {
  const lines: MeasureLine[] = [];
  const aR = a.x + a.w, aB = a.y + a.h, bR = b.x + b.w, bB = b.y + b.h;
  const cx = a.x + a.w / 2, cy = a.y + a.h / 2;

  const overlapX = Math.max(0, Math.min(aR, bR) - Math.max(a.x, b.x));
  const overlapY = Math.max(0, Math.min(aB, bB) - Math.max(a.y, b.y));

  const push = (x1: number, y1: number, x2: number, y2: number, axis: "h" | "v") => {
    const label = Math.round(Math.abs(axis === "h" ? x2 - x1 : y2 - y1) * 10) / 10;
    if (label > 0) lines.push({ x1, y1, x2, y2, label, axis });
  };

  const separatedX = overlapX === 0;
  const separatedY = overlapY === 0;

  // Horizontal relationship
  if (separatedX) {
    // gap across the axis of separation, drawn at the shared band's centre
    const y = overlapY > 0 ? Math.max(a.y, b.y) + overlapY / 2 : cy;
    if (bR <= a.x) push(bR, y, a.x, y, "h");
    else push(aR, y, b.x, y, "h");
  } else if (!separatedY) {
    // overlapping / nested on both axes: edge-to-edge insets (Figma's behaviour)
    const y = Math.max(a.y, b.y) + overlapY / 2;
    if (a.x !== b.x) push(Math.min(a.x, b.x), y, Math.max(a.x, b.x), y, "h");
    if (aR !== bR) push(Math.min(aR, bR), y, Math.max(aR, bR), y, "h");
  }

  // Vertical relationship
  if (separatedY) {
    const x = overlapX > 0 ? Math.max(a.x, b.x) + overlapX / 2 : cx;
    if (bB <= a.y) push(x, bB, x, a.y, "v");
    else push(x, aB, x, b.y, "v");
  } else if (!separatedX) {
    const x = Math.max(a.x, b.x) + overlapX / 2;
    if (a.y !== b.y) push(x, Math.min(a.y, b.y), x, Math.max(a.y, b.y), "v");
    if (aB !== bB) push(x, Math.min(aB, bB), x, Math.max(aB, bB), "v");
  }
  return lines;
}

/* ─── Page-level design summary ─────────────────────────────────────────── */

export interface DesignSummary {
  fonts: { family: string; weights: string[]; sizes: string[]; count: number }[];
  colors: { color: string; hex: string; count: number; usedFor: Set<string> }[];
  headings: { tag: string; text: string; size: string; weight: string; family: string }[];
  spacing: { value: string; count: number }[];
}

export function summarize(doc: Document, limit = 4000): DesignSummary {
  const win = doc.defaultView!;
  const fonts = new Map<string, { weights: Set<string>; sizes: Set<string>; count: number }>();
  const colors = new Map<string, { count: number; usedFor: Set<string> }>();
  const spacing = new Map<string, number>();
  const headings: DesignSummary["headings"] = [];

  const all = doc.body ? doc.body.querySelectorAll("*") : [];
  let i = 0;
  for (const el of Array.from(all)) {
    if (i++ > limit) break;
    if (SKIP_TAGS.has(el.tagName)) continue;
    const cs = win.getComputedStyle(el);
    if (cs.display === "none") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    if (hasOwnText(el)) {
      const fam = cs.fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "");
      const f = fonts.get(fam) || { weights: new Set(), sizes: new Set(), count: 0 };
      f.weights.add(cs.fontWeight);
      f.sizes.add(px(cs.fontSize));
      f.count++;
      fonts.set(fam, f);
      const c = colors.get(cs.color) || { count: 0, usedFor: new Set() };
      c.count++;
      c.usedFor.add("text");
      colors.set(cs.color, c);
    }
    const bg = toRgb(cs.backgroundColor);
    if (bg && bg[3] > 0.05) {
      const c = colors.get(cs.backgroundColor) || { count: 0, usedFor: new Set() };
      c.count++;
      c.usedFor.add("background");
      colors.set(cs.backgroundColor, c);
    }
    if (cs.borderTopStyle !== "none" && parseFloat(cs.borderTopWidth) > 0) {
      const bc = toRgb(cs.borderTopColor);
      if (bc && bc[3] > 0.05) {
        const c = colors.get(cs.borderTopColor) || { count: 0, usedFor: new Set() };
        c.count++;
        c.usedFor.add("border");
        colors.set(cs.borderTopColor, c);
      }
    }
    for (const v of [cs.paddingTop, cs.paddingBottom, cs.paddingLeft, cs.paddingRight, cs.marginTop, cs.marginBottom, cs.gap]) {
      const n = parseFloat(v);
      if (n > 0 && Number.isFinite(n)) spacing.set(px(v), (spacing.get(px(v)) || 0) + 1);
    }
    if (/^H[1-6]$/.test(el.tagName) && headings.length < 40) {
      headings.push({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
        size: px(cs.fontSize),
        weight: cs.fontWeight,
        family: cs.fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, ""),
      });
    }
  }

  const sortPx = (a: string, b: string) => parseFloat(a) - parseFloat(b);
  return {
    fonts: Array.from(fonts.entries())
      .map(([family, f]) => ({
        family,
        weights: Array.from(f.weights).sort((a, b) => +a - +b),
        sizes: Array.from(f.sizes).sort(sortPx),
        count: f.count,
      }))
      .sort((a, b) => b.count - a.count),
    colors: Array.from(colors.entries())
      .map(([color, c]) => ({ color, hex: rgbToHex(color), count: c.count, usedFor: c.usedFor }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 24),
    headings,
    spacing: Array.from(spacing.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12)
      .sort((a, b) => parseFloat(a.value) - parseFloat(b.value)),
  };
}

/* ─── Serialise the rendered document (Freeze) ──────────────────────────── */

/**
 * Scroll-reveal animations (Framer Motion whileInView, AOS, …) leave content
 * that is out of view at `opacity: 0; transform: translateY(…)`. A snapshot
 * has no scripts to animate it in, so those sections would stay invisible
 * forever — reveal them.
 */
export function revealHidden(root: Element): void {
  root.querySelectorAll<HTMLElement>('[style*="opacity"]').forEach((el) => {
    const st = el.style;
    if (parseFloat(st.opacity) === 0 && /translate|scale|matrix/.test(st.transform || "")) {
      st.opacity = "1";
      st.transform = "none";
    }
  });
  root.querySelectorAll("[data-aos]").forEach((el) => el.classList.add("aos-animate"));
  root.querySelectorAll<HTMLElement>(".reveal:not(.active), .fade-in:not(.visible), .wow:not(.animated)").forEach((el) => {
    el.classList.add("active", "visible", "animated");
  });
}

export function serializeDocument(doc: Document): string {
  const clone = doc.documentElement.cloneNode(true) as HTMLElement;
  // Inline the live stylesheets so the snapshot survives origin CSS changes.
  const styles: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      const rules = Array.from(sheet.cssRules).map((r) => r.cssText).join("\n");
      if (rules) styles.push(rules);
    } catch {
      /* cross-origin sheet: keep its <link> */
    }
  }
  // Remove same-origin <link rel=stylesheet> we managed to inline (proxied ones).
  clone.querySelectorAll('link[rel="stylesheet"]').forEach((l) => {
    const href = l.getAttribute("href") || "";
    if (href.includes("/api/proxy?")) l.remove();
  });
  clone.querySelectorAll("script").forEach((s) => {
    if (!(s.getAttribute("src") || "").endsWith("/bridge.js")) s.remove();
  });
  // Persist current form values.
  const liveInputs = Array.from(doc.querySelectorAll("input, textarea, select"));
  const cloneInputs = Array.from(clone.querySelectorAll("input, textarea, select"));
  liveInputs.forEach((live, i) => {
    const c = cloneInputs[i];
    if (!c) return;
    if (live instanceof HTMLInputElement && c instanceof HTMLInputElement) {
      if (live.type === "checkbox" || live.type === "radio") c.checked = live.checked;
      else c.setAttribute("value", live.value);
    } else if (live instanceof HTMLTextAreaElement) c.textContent = live.value;
  });
  revealHidden(clone);
  const style = doc.createElement("style");
  style.setAttribute("data-redline-frozen-styles", "1");
  style.textContent = styles.join("\n");
  const head = clone.querySelector("head");
  head?.appendChild(style);
  clone.setAttribute("data-redline-frozen", new Date().toISOString());
  return "<!doctype html>\n" + clone.outerHTML;
}
