/**
 * Which part of a block holds its copy (browser only).
 *
 * Most text blocks are copy through and through: the slot is all of their
 * content. A button or link with an icon — `<button><svg/>Save changes</button>`,
 * `<a><svg/> Read the docs</a>` — is copy with something atomic at an end;
 * the icon is not copy (the sanitizer would drop it) and must survive every
 * edit untouched. So a block's content is split into a leading and a
 * trailing run of atomic nodes, kept as they are, and the slot between them,
 * the only part an edit reads or writes. Atomic content in the middle of the
 * copy (an image between two words) can't be kept in place: such a block is
 * not editable.
 *
 * The bounds are the atomic nodes themselves, so a slot is found again by
 * node identity, whatever was written into it meanwhile.
 */

export interface Bounds {
  /** atomic nodes (and blank text, comments) before the copy */
  lead: Node[];
  /** the same after it */
  trail: Node[];
}

/** Formatting the sanitizer keeps (and so an edit can write back exactly), plus Redline's own track-changes marks. */
const KEEPS = new Set(["A", "B", "STRONG", "I", "EM", "U", "SPAN", "BR", "WBR"]);
const OUR_MARK = "ins[data-rl-ins],del[data-rl-del],span[data-rl-fmt]";
/** Content that is never copy and is kept as it is: icons and media. */
const MEDIA = new Set(["SVG", "IMG", "PICTURE", "CANVAS", "VIDEO", "AUDIO"]);
/** Never inside copy, not even at its edge. */
const FORM = new Set(["INPUT", "TEXTAREA", "SELECT", "OPTION", "OPTGROUP", "BUTTON", "IFRAME", "OBJECT", "EMBED", "SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "MATH"]);

const words = (n: Node) => /\S/.test((n.textContent || "").replace(/ /g, " "));
const blank = (n: Node) => n.nodeType === 8 || (n.nodeType === 3 && !words(n));

/** An icon: media, or an element without any words in it (an icon font's `<i>`, an empty `<span class="icon">`) — and no form control inside. */
export function isAtomic(n: Node): boolean {
  if (n.nodeType !== 1) return false;
  const el = n as Element;
  const tag = el.tagName.toUpperCase();
  if (FORM.has(tag) || el.querySelector("input,textarea,select,button,iframe,object,embed")) return false;
  if (MEDIA.has(tag)) return true;
  return tag !== "BR" && tag !== "WBR" && !words(el);
}

/** Only text and formatting the sanitizer keeps, all the way down. */
function inlineOnly(el: Element): boolean {
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3 || n.nodeType === 8) continue;
    if (n.nodeType !== 1) return false;
    const c = n as Element;
    if (!(KEEPS.has(c.tagName.toUpperCase()) || c.matches(OUR_MARK)) || !inlineOnly(c)) return false;
  }
  return true;
}

/**
 * The bounds of a block's copy as its DOM is now, or null when it isn't a
 * block of copy: no words, a form control or another block inside, atomic
 * content between words, or formatting an edit couldn't write back as it is
 * (`<sup>`, `<code>`, `<s>` …).
 */
export function findBounds(el: Element): Bounds | null {
  const kids = Array.from(el.childNodes);
  let i = 0;
  let j = kids.length;
  const edge = (n: Node) => blank(n) || isAtomic(n);
  if (kids.some(isAtomic)) {
    while (i < j && edge(kids[i])) i++;
    while (j > i && edge(kids[j - 1])) j--;
  }
  const middle = kids.slice(i, j);
  if (!middle.some(words)) return null;
  for (const n of middle) {
    if (n.nodeType === 3 || n.nodeType === 8) continue;
    if (n.nodeType !== 1) return null;
    const c = n as Element;
    if (!(KEEPS.has(c.tagName.toUpperCase()) || c.matches(OUR_MARK)) || !inlineOnly(c)) return null;
  }
  return { lead: kids.slice(0, i), trail: kids.slice(j) };
}

/** The bounds still frame the block's content: every edge node is still a child, in place. */
export function boundsValid(el: Element, b: Bounds): boolean {
  const kids = el.childNodes;
  for (let k = 0; k < b.lead.length; k++) if (kids[k] !== b.lead[k]) return false;
  for (let k = 0; k < b.trail.length; k++) if (kids[kids.length - b.trail.length + k] !== b.trail[k]) return false;
  return kids.length >= b.lead.length + b.trail.length;
}

/** The slot's nodes: the children between the bounds. */
export function slotNodes(el: Element, b: Bounds): Node[] {
  const kids = Array.from(el.childNodes);
  return kids.slice(b.lead.length, kids.length - b.trail.length);
}

const plain = (b: Bounds) => b.lead.length === 0 && b.trail.length === 0;

/** The slot's HTML. */
export function readSlot(el: Element, b: Bounds): string {
  if (plain(b)) return el.innerHTML;
  const box = el.ownerDocument.createElement("div");
  for (const n of slotNodes(el, b)) box.appendChild(n.cloneNode(true));
  return box.innerHTML;
}

/**
 * Replace the slot's content with `html` — callers pass only sanitized copy,
 * Redline's track-changes markup of sanitized copy, or the slot's own earlier
 * HTML. The edge nodes are never touched.
 */
export function writeSlot(el: Element, b: Bounds, html: string) {
  if (plain(b)) {
    el.innerHTML = html;
    return;
  }
  for (const n of slotNodes(el, b)) el.removeChild(n);
  const t = el.ownerDocument.createElement("template");
  t.innerHTML = html;
  el.insertBefore(t.content, b.trail[0] ?? null);
}

/** The slot's start and end as boundary points in the block. */
export function slotEdges(el: Element, b: Bounds): { start: number; end: number } {
  return { start: b.lead.length, end: el.childNodes.length - b.trail.length };
}

/** The atomic elements at the edges (what must survive an editing session). */
export function edgeElements(b: Bounds): Element[] {
  return [...b.lead, ...b.trail].filter((n): n is Element => n.nodeType === 1);
}
