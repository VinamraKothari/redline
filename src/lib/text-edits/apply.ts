import type { TextEdit } from "@/lib/types";
import type { TextEditFound, TextView } from "@/lib/store";
import { resolveSelector } from "@/lib/frame/dom";
import { normalizeText, sanitizeInline } from "./sanitize";
import { diffInline, renderChangesHtml } from "./diff";
import { boundsValid, findBounds, readSlot, writeSlot, type Bounds } from "./slot";

/**
 * Puts copy edits into the reviewed page (browser only; runs against the
 * same-origin frame document).
 *
 * An edit only replaces the copy of its block — the slot between any icons
 * at its edges (see slot.ts) — so the block keeps the page's own element,
 * classes, inline styles, icons and computed typography. What is written
 * into a slot is one of exactly three things: the page's own original markup
 * (put back), `sanitizeInline(after_html)` (Edited view), or
 * `renderChangesHtml` of the sanitized before/after (Changes view) — never
 * stored HTML as it is, even though the API sanitized it already.
 *
 * Nothing is written onto the page's elements themselves (no attributes):
 * what the reviewer needs to remember about a block — its original markup,
 * its bounds, what was last written into it — lives in a per-document
 * registry of WeakMaps, so a block the page throws away takes its entry with
 * it.
 */

interface Registry {
  /** the page's own copy (slot HTML) of every block we have written into */
  originals: WeakMap<Element, string>;
  /** where each block's copy sits */
  bounds: WeakMap<Element, Bounds>;
  /** the slot's HTML as it read right after our last write — anything else means the page re-rendered the block */
  written: WeakMap<Element, string>;
  /** the string we last wrote, to skip writing the same thing again (no mutation churn, no caret jumps) */
  assigned: WeakMap<Element, string>;
  /** blocks currently showing something other than their original */
  touched: Set<Element>;
  /** when the page re-rendered a block we wrote, by block: a framework fighting us is given up on */
  fights: WeakMap<Element, number[]>;
  gaveUp: WeakSet<Element>;
  /** the block being edited in place: left alone by every pass */
  editing: Element | null;
  observer: MutationObserver | null;
  style: HTMLStyleElement | null;
}

const registries = new WeakMap<Document, Registry>();

function registry(doc: Document): Registry {
  let r = registries.get(doc);
  if (!r) {
    r = {
      originals: new WeakMap(),
      bounds: new WeakMap(),
      written: new WeakMap(),
      assigned: new WeakMap(),
      touched: new Set(),
      fights: new WeakMap(),
      gaveUp: new WeakSet(),
      editing: null,
      observer: null,
      style: null,
    };
    registries.set(doc, r);
  }
  return r;
}

/** At most this many re-applies per block within FIGHT_WINDOW after the page re-rendered it. */
const FIGHT_LIMIT = 20;
const FIGHT_WINDOW = 10_000;

/** Things an edit never touches, whatever its selector says. */
const NEVER = new Set([
  "HTML", "HEAD", "BODY", "TITLE", "META", "LINK", "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME", "SVG", "MATH", "CANVAS", "VIDEO",
  "AUDIO", "OBJECT", "EMBED", "TEXTAREA", "INPUT", "SELECT", "OPTION", "OPTGROUP", "FORM",
]);

/**
 * Whether an element may carry copy: part of the visible page (inside the
 * body), not page infrastructure or a form control, and not something
 * Redline put into the frame.
 */
export function mayHoldCopy(el: Element): boolean {
  if (NEVER.has(el.tagName.toUpperCase())) return false;
  const body = el.ownerDocument.body;
  if (!body || el === body || !body.contains(el)) return false;
  if (el.closest("[data-redline-ui],[data-redline-text],[data-redline-text-mode],[data-redline-hover-lock],svg,math,select,textarea")) return false;
  return true;
}

function fought(reg: Registry, el: Element) {
  const now = Date.now();
  const recent = (reg.fights.get(el) ?? []).filter((t) => now - t < FIGHT_WINDOW);
  recent.push(now);
  reg.fights.set(el, recent);
  if (recent.length > FIGHT_LIMIT) reg.gaveUp.add(el);
}

/**
 * A block's own copy and where it sits, or null when the block can't hold an
 * edit (see findBounds). A block we wrote into keeps the original recorded
 * then; if it no longer holds what we wrote, the page has re-rendered it, and
 * what it shows now is the page's copy again. A block we never wrote into is
 * read as it is now.
 */
export function track(doc: Document, el: Element): { original: string; bounds: Bounds } | null {
  const reg = registry(doc);
  const known = reg.bounds.get(el);
  const original = reg.originals.get(el);
  if (el === reg.editing) return known && original !== undefined ? { original, bounds: known } : null;
  const w = reg.written.get(el);
  if (w !== undefined && known && original !== undefined) {
    if (boundsValid(el, known) && readSlot(el, known) === w) return { original, bounds: known };
    fought(reg, el);
  }
  reg.written.delete(el);
  reg.assigned.delete(el);
  reg.touched.delete(el);
  const b = mayHoldCopy(el) ? findBounds(el) : null;
  if (!b) {
    reg.bounds.delete(el);
    reg.originals.delete(el);
    return null;
  }
  const o = readSlot(el, b);
  reg.bounds.set(el, b);
  reg.originals.set(el, o);
  return { original: o, bounds: b };
}

/** Mark the block as being edited in place (every pass leaves it alone), or none. */
export function setEditing(doc: Document, el: Element | null) {
  registry(doc).editing = el;
}

/** The block being edited in place, if any. */
export function editingIn(doc: Document): Element | null {
  return registries.get(doc)?.editing ?? null;
}

/**
 * What the block shows now was put there by Redline (an editing session just
 * ended): not a re-render by the page, and the next pass writes its view again.
 */
export function adoptContent(doc: Document, el: Element) {
  const reg = registry(doc);
  const b = reg.bounds.get(el);
  if (!b) return;
  reg.written.set(el, readSlot(el, b));
  reg.assigned.delete(el);
  reg.touched.add(el);
  reg.observer?.takeRecords();
}

/** Write one of the three allowed strings (see the module comment). */
function write(reg: Registry, el: Element, b: Bounds, html: string) {
  if (reg.assigned.get(el) === html && reg.written.get(el) === readSlot(el, b)) return;
  writeSlot(el, b, html);
  reg.written.set(el, readSlot(el, b));
  reg.assigned.set(el, html);
  reg.touched.add(el);
}

function restore(reg: Registry, el: Element) {
  reg.touched.delete(el);
  reg.assigned.delete(el);
  const w = reg.written.get(el);
  reg.written.delete(el);
  const b = reg.bounds.get(el);
  const o = reg.originals.get(el);
  // the page re-rendered it meanwhile: it already shows the page's own copy
  if (!el.isConnected || w === undefined || !b || o === undefined || !boundsValid(el, b) || readSlot(el, b) !== w) return;
  writeSlot(el, b, o);
}

/**
 * Track-changes marks. Only colour, background, text-decoration and a box
 * shadow (painted, not laid out) — no padding, border or font property, so a
 * block in Changes view lays out like the original apart from the deleted
 * words themselves and a hair of space between a deletion and its
 * replacement (so "fasterquicker" reads as two words). The text colours are
 * mixed with the block's own colour (currentColor): dark teal and red on
 * light sections, light ones on dark sections, where #0b6b52 on navy would be
 * unreadable.
 */
const CHANGES_CSS = `
ins[data-rl-ins],del[data-rl-del],span[data-rl-fmt]{display:inline}
ins[data-rl-ins]{text-decoration:none;background:color-mix(in srgb,#0f9d76 18%,transparent);color:#0b6b52;color:color-mix(in srgb,#0f9d76 65%,currentColor);border-radius:2px;box-shadow:0 1px 0 #0f9d76}
del[data-rl-del]{color:#c4321b;color:color-mix(in srgb,#c4321b 75%,currentColor);text-decoration:line-through;text-decoration-thickness:1.5px;background:transparent}
del[data-rl-del]+ins[data-rl-ins]{margin-left:.25em}
span[data-rl-fmt]{background:color-mix(in srgb,#0f9d76 12%,transparent);text-decoration:underline dotted #0f9d76}
`;

function setChangesStyle(doc: Document, reg: Registry, on: boolean) {
  if (!on) {
    reg.style?.remove();
    reg.style = null;
    return;
  }
  if (reg.style?.isConnected) return;
  const s = doc.createElement("style");
  s.setAttribute("data-redline-text", "");
  s.textContent = CHANGES_CSS;
  (doc.head || doc.documentElement).appendChild(s);
  reg.style = s;
}

/** Whether the block's own copy is what the edit started from, what it asks for, or neither. */
export function foundFor(edit: TextEdit, originalHtml: string): "applied" | "live" | "outdated" {
  const text = normalizeText(originalHtml);
  if (text === edit.before_text) return "applied";
  if (text === edit.after_text) return "live";
  return "outdated";
}

/**
 * One pass: resolve every edit, work out its status from the block's
 * original copy, and make each block show the view — the original, the new
 * copy, or track changes. Blocks whose edit went away get their original
 * back. Returns the status per edit id; the block being edited keeps the
 * status it had (`prev`). A block the page keeps re-rendering is given up on
 * ("unstable") rather than fought forever.
 */
export function applyEdits(doc: Document, edits: TextEdit[], view: TextView, prev: Record<string, TextEditFound> = {}): Record<string, TextEditFound> {
  const reg = registry(doc);
  const status: Record<string, TextEditFound> = {};
  const wanted = new Map<Element, { b: Bounds; html: string }>();
  for (const e of edits) {
    const el = resolveSelector(doc, e.selector);
    if (el && el === reg.editing) {
      status[e.id] = prev[e.id] ?? "applied";
      continue;
    }
    const t = el ? track(doc, el) : null;
    if (!el || !t) {
      status[e.id] = "missing";
      continue;
    }
    const found = foundFor(e, t.original);
    if (found === "applied" && reg.gaveUp.has(el)) {
      status[e.id] = "unstable";
      continue;
    }
    status[e.id] = found;
    if (found !== "applied" || view === "original" || wanted.has(el)) continue;
    const before = sanitizeInline(e.before_html);
    const after = sanitizeInline(e.after_html);
    wanted.set(el, { b: t.bounds, html: view === "edited" ? after : renderChangesHtml(diffInline(before, after)) });
  }
  for (const el of Array.from(reg.touched)) {
    if (!wanted.has(el) && el !== reg.editing) restore(reg, el);
  }
  for (const [el, w] of wanted) write(reg, el, w.b, w.html);
  setChangesStyle(doc, reg, view === "changes" && wanted.size > 0);
  // our own writes are not the page changing
  reg.observer?.takeRecords();
  return status;
}

/** The edited markup a block should show while it is being edited (the new copy, without track changes). */
export function editedHtml(edit: TextEdit): string {
  return sanitizeInline(edit.after_html);
}

/**
 * Re-apply when the page re-renders a block (a framework replacing text,
 * a lazy section arriving): debounced, and blind to our own writes (taken
 * off the record queue right after each pass) and to typing in the block
 * being edited. The debounce runs on Redline's own timers — never mixing the
 * frame's setTimeout with the host's clearTimeout, whose ids are unrelated.
 * Returns the stop function.
 */
export function watchDocument(doc: Document, onChange: () => void): () => void {
  const reg = registry(doc);
  reg.observer?.disconnect();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const mo = new MutationObserver((records) => {
    const relevant = records.some((r) => {
      const t = r.target;
      if (reg.editing && (t === reg.editing || reg.editing.contains(t))) return false;
      if (reg.style && (t === reg.style || reg.style.contains(t))) return false;
      const host = t.nodeType === 1 ? (t as Element) : t.parentElement;
      if (host?.closest("[data-redline-text-mode]")) return false;
      return true;
    });
    if (!relevant) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, 100);
  });
  mo.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
  reg.observer = mo;
  return () => {
    clearTimeout(timer);
    mo.disconnect();
    if (reg.observer === mo) reg.observer = null;
  };
}
