import { buildSelector, pathLabel } from "@/lib/frame/dom";

/**
 * A flat description of the rendered page: every visible element with its
 * page-space box, text run and the handful of computed styles the Figma
 * comparison looks at. Built inside the review iframe.
 */

export interface ImplText {
  chars: string;
  family: string;
  size: number;
  weight: number;
  /** px, or NaN when "normal" */
  lineHeight: number;
  letterSpacing: number;
  color: string;
  align: string;
  transform: string;
  decoration: string;
  italic: boolean;
  /** number of rendered lines (from height / line-height) */
  lines: number;
}

export interface ImplNode {
  i: number;
  /** parent index (-1 for the root) */
  p: number;
  tag: string;
  sel: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: ImplText;
  /** own solid background (hex) when it is painted */
  bg?: string;
  /** an image: <img>, <picture>, <svg>, <video> or a background-image */
  img?: { src: string; kind: "img" | "svg" | "bg" | "video"; natW?: number; natH?: number; fit?: string; pending?: boolean };
  pad: [number, number, number, number];
  gap: [number, number];
  display: string;
  flexDir?: string;
  radius: number;
  border?: { color: string; w: number };
  op: number;
  /** the element is a control (button / link) */
  ctl?: boolean;
  /** number of direct child elements that are visible */
  kids: number;
  /** the element clips its overflow (its box bounds what its children show) */
  clip?: boolean;
  /** the box was cut down to what is visible inside a clipping ancestor */
  clipped?: boolean;
}

export interface ImplSnapshot {
  url: string;
  width: number;
  height: number;
  nodes: ImplNode[];
}

const INLINE = new Set(["SPAN", "A", "B", "I", "EM", "STRONG", "SMALL", "SUP", "SUB", "MARK", "ABBR", "CODE", "TIME", "LABEL", "U", "S"]);
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "LINK", "META", "HEAD", "TITLE", "BR", "WBR", "OPTION"]);

function num(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

let canvasCtx: CanvasRenderingContext2D | null | undefined;
/** Resolve any CSS colour to #rrggbb (null when transparent or unresolvable). */
function anyHex(c: string): string | null {
  if (!c) return null;
  const direct = rgbHex(c);
  if (direct || /^rgba?\(/.test(c) || c === "transparent") return direct;
  try {
    if (canvasCtx === undefined) canvasCtx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!canvasCtx) return null;
    canvasCtx.clearRect(0, 0, 1, 1);
    canvasCtx.fillStyle = "#000";
    canvasCtx.fillStyle = c;
    canvasCtx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = canvasCtx.getImageData(0, 0, 1, 1).data;
    if (a < 13) return null;
    const h = (n: number) => n.toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}`;
  } catch {
    return null;
  }
}

function rgbHex(c: string): string | null {
  const m = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/);
  if (!m) return null;
  let a = m[4] === undefined ? 1 : parseFloat(m[4]);
  if (m[4]?.endsWith("%")) a /= 100;
  if (a < 0.05) return null;
  const h = (n: string) => Math.round(+n).toString(16).padStart(2, "0");
  return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
}

/** Text directly in this element plus inline descendants — nothing from block children. */
function ownText(el: Element): string {
  let out = "";
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) out += n.textContent || "";
    else if (n.nodeType === 1 && INLINE.has((n as Element).tagName)) out += ownText(n as Element);
    else if (n.nodeType === 1 && (n as Element).tagName === "BR") out += "\n";
  });
  return out;
}

function hasDirectText(el: Element): boolean {
  return Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || "").trim().length > 0);
}

/**
 * The element that owns a run of text: it has words of its own, with inline
 * children (`<p>Bold <b>and</b> italic</p>`) merged into the run. A wrapper
 * whose words all come from children (`<a><span>Label</span></a>`, a nav of
 * links) is not the run — its children are.
 */
function isTextLeaf(el: Element, parentIsLeaf: boolean): boolean {
  if (parentIsLeaf) return false;
  return hasDirectText(el);
}

/**
 * Finish the page's running animations so the snapshot sees the settled
 * layout — scroll-reveal fades, slide-ins and the like — and leave anything
 * that loops (tickers, spinners) alone.
 */
export function settleAnimations(doc: Document): void {
  try {
    for (const a of doc.getAnimations()) {
      try {
        const eff = a.effect?.getTiming();
        if (eff && (eff.iterations === Infinity || eff.iterations === undefined)) continue;
        if (a.playState === "running" || a.playState === "paused") a.finish();
      } catch {
        /* infinite or non-finishable — leave it */
      }
    }
  } catch {
    /* getAnimations unsupported */
  }
}

/** Give lazy / late images a moment to arrive so the snapshot sees their pixels. */
export async function waitForImages(doc: Document, maxMs = 4000): Promise<void> {
  const pending = Array.from(doc.images).filter((i) => !i.complete);
  if (!pending.length) return;
  await Promise.race([
    Promise.all(pending.map((i) => new Promise<void>((r) => { i.addEventListener("load", () => r(), { once: true }); i.addEventListener("error", () => r(), { once: true }); }))),
    new Promise<void>((r) => setTimeout(r, maxMs)),
  ]);
}

/** The translation of a 2D transform matrix, or null when it is not a plain translate. */
function translateOf(transform: string): { tx: number; ty: number } | null {
  if (!transform || transform === "none") return { tx: 0, ty: 0 };
  const m = transform.match(/^matrix\(\s*([\d.-]+)[,\s]+([\d.-]+)[,\s]+([\d.-]+)[,\s]+([\d.-]+)[,\s]+([\d.-]+)[,\s]+([\d.-]+)\s*\)$/);
  if (!m) return null;
  const [a, b, c, d] = [+m[1], +m[2], +m[3], +m[4]];
  if (Math.abs(a - 1) > 0.01 || Math.abs(d - 1) > 0.01 || Math.abs(b) > 0.01 || Math.abs(c) > 0.01) return null;
  return { tx: +m[5], ty: +m[6] };
}

/** Snapshot the document (page coordinates, scroll included). */
export function snapshotDocument(doc: Document, limit = 6000): ImplSnapshot {
  settleAnimations(doc);
  return snapshotLaidOut(doc, limit);
}

type Clip = { x: number; y: number; r: number; b: number } | null;
type Inherited = { dx: number; dy: number; fixed: boolean; leaf: boolean; clip: Clip };

function snapshotLaidOut(doc: Document, limit: number): ImplSnapshot {
  const win = doc.defaultView!;
  const nodes: ImplNode[] = [];
  const index = new Map<Element, number>();
  const sx = win.scrollX;
  const sy = win.scrollY;
  const pageW = doc.documentElement.clientWidth;

  const visit = (el: Element, parent: number, inherited: Inherited) => {
    if (nodes.length >= limit) return;
    if (SKIP.has(el.tagName)) return;
    const cs = win.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    let op = parseFloat(cs.opacity);
    let { dx, dy, fixed, clip } = inherited;
    if (cs.position === "fixed") {
      fixed = true;
      clip = null;
    }
    if (op === 0) {
      // a scroll-reveal that has not fired (opacity 0, slid down a little, with a
      // transition or animation waiting): record it where it will land
      const tr = translateOf(cs.transform);
      const animated = !/^(0s,?\s*)+$/.test(cs.transitionDuration) || cs.animationName !== "none";
      const hasAnim = animated || (tr && (tr.tx !== 0 || tr.ty !== 0));
      if (!tr || !hasAnim || Math.abs(tr.tx) > 200 || Math.abs(tr.ty) > 200) return;
      dx -= tr.tx;
      dy -= tr.ty;
      op = 1;
    }
    const r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return;
    // page-space box (fixed elements live in the viewport: at scroll 0 that is where the design has them too)
    let x = r.left + (fixed ? 0 : sx) + dx;
    let y = r.top + (fixed ? 0 : sy) + dy;
    let w = r.width;
    let h = r.height;
    // off-canvas (carousel clones, slide-in menus parked beside the page) — skip
    if (x + w <= 0 || x >= pageW) return;
    // inside a clipping ancestor only the overlap shows (cover-fit images, carousels)
    let clipped = false;
    if (clip) {
      const nx = Math.max(x, clip.x);
      const ny = Math.max(y, clip.y);
      const nr = Math.min(x + w, clip.r);
      const nb = Math.min(y + h, clip.b);
      if (nr - nx <= 0 || nb - ny <= 0) return;
      if (nx !== x || ny !== y || nr - nx !== w || nb - ny !== h) clipped = true;
      x = nx;
      y = ny;
      w = nr - nx;
      h = nb - ny;
    }

    const i = nodes.length;
    const tag = el.tagName.toLowerCase();
    const node: ImplNode = {
      i,
      p: parent,
      tag,
      sel: "",
      label: pathLabel(el, 3),
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      w: Math.round(w * 100) / 100,
      h: Math.round(h * 100) / 100,
      pad: [num(cs.paddingTop), num(cs.paddingRight), num(cs.paddingBottom), num(cs.paddingLeft)],
      gap: [num(cs.rowGap), num(cs.columnGap)],
      display: cs.display,
      radius: num(cs.borderTopLeftRadius),
      op: Math.round(op * 100) / 100,
      kids: 0,
    };
    if (cs.display.includes("flex") || cs.display.includes("grid")) node.flexDir = cs.flexDirection;
    if (clipped) node.clipped = true;
    const clips = (v: string) => v === "hidden" || v === "clip" || v === "auto" || v === "scroll";
    if (clips(cs.overflowX) || clips(cs.overflowY)) {
      node.clip = true;
      clip = {
        x: clips(cs.overflowX) ? node.x : clip?.x ?? -Infinity,
        y: clips(cs.overflowY) ? node.y : clip?.y ?? -Infinity,
        r: clips(cs.overflowX) ? node.x + node.w : clip?.r ?? Infinity,
        b: clips(cs.overflowY) ? node.y + node.h : clip?.b ?? Infinity,
      };
      if (clip && inherited.clip) {
        clip = { x: Math.max(clip.x, inherited.clip.x), y: Math.max(clip.y, inherited.clip.y), r: Math.min(clip.r, inherited.clip.r), b: Math.min(clip.b, inherited.clip.b) };
      }
    }
    const bg = anyHex(cs.backgroundColor);
    if (bg) node.bg = bg;
    const bw = num(cs.borderTopWidth);
    if (bw > 0 && cs.borderTopStyle !== "none") {
      const bc = anyHex(cs.borderTopColor);
      if (bc) node.border = { color: bc, w: bw };
    }
    if (tag === "img") {
      const im = el as HTMLImageElement;
      node.img = { src: (im.currentSrc || im.src || "").slice(0, 300), kind: "img", natW: im.naturalWidth, natH: im.naturalHeight, fit: cs.objectFit };
      if (!im.complete) node.img.pending = true;
    } else if (tag === "svg") node.img = { src: "", kind: "svg" };
    else if (tag === "video") node.img = { src: ((el as HTMLVideoElement).currentSrc || "").slice(0, 300), kind: "video" };
    else if (cs.backgroundImage && cs.backgroundImage !== "none" && /url\(/.test(cs.backgroundImage)) {
      node.img = { src: cs.backgroundImage.slice(0, 300), kind: "bg" };
    }
    if (tag === "a" || tag === "button" || el.getAttribute("role") === "button") node.ctl = true;

    const leaf = isTextLeaf(el, inherited.leaf);
    if (leaf) {
      const chars = ownText(el).replace(/[ \t\r\f\v]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
      const size = num(cs.fontSize);
      const lh = cs.lineHeight === "normal" ? NaN : num(cs.lineHeight);
      node.text = {
        chars,
        family: (cs.fontFamily.split(",")[0] || "").replace(/["']/g, "").trim(),
        size,
        weight: parseInt(cs.fontWeight, 10) || (cs.fontWeight === "bold" ? 700 : 400),
        lineHeight: lh,
        letterSpacing: cs.letterSpacing === "normal" ? 0 : num(cs.letterSpacing),
        color: anyHex(cs.color) || cs.color,
        align: cs.textAlign,
        transform: cs.textTransform,
        decoration: cs.textDecorationLine,
        italic: cs.fontStyle === "italic",
        lines: Number.isFinite(lh) && lh > 0 ? Math.max(1, Math.round(h / lh)) : 1,
      };
    }
    nodes.push(node);
    index.set(el, i);
    // selectors are costly; only elements the report may pin to get one
    if (node.text || node.img || node.ctl) {
      try {
        node.sel = buildSelector(el);
      } catch {
        node.sel = "";
      }
    }
    // an SVG's internals are not interesting
    if (tag === "svg") return;
    let kids = 0;
    for (const c of Array.from(el.children)) {
      const before = nodes.length;
      visit(c, i, { dx, dy, fixed, leaf: leaf || inherited.leaf, clip });
      if (nodes.length > before) kids++;
    }
    node.kids = kids;
  };
  visit(doc.body, -1, { dx: 0, dy: 0, fixed: false, leaf: false, clip: null });
  return {
    url: doc.location.href,
    width: pageW,
    height: Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight),
    nodes,
  };
}
