import { safeClass, safeHref, sameMark, sanitizeInline, serializeRuns, type InlineMark, type Run, type TextRun } from "./sanitize";
import { mayHoldCopy } from "./apply";
import { boundsValid, edgeElements, findBounds, readSlot, slotNodes, writeSlot, type Bounds } from "./slot";

/**
 * In-place editing of one text block inside the reviewed page.
 *
 * The block becomes contentEditable for the session; everything else about
 * it stays the page's own. Formatting is done on a model of the block's copy
 * — runs of text, each with its ordered list of marks (the sanitizer's
 * model: `<strong>`, `<em>`, `<u>`, `<a href>` and `<span>`, each with the
 * site's class) — and written back in exactly that nesting, so a
 * `<span class="text-indigo-600 font-semibold">` or a site-styled link keeps
 * its element and class through typing, formatting, pasting and line breaks.
 * No `document.execCommand`: it leaves `<span style="font-weight: …">` and
 * `<font>` behind. Line breaks are `<br>`, pastes are plain text, and
 * undo/redo is our own history: once the DOM is changed by script the
 * browser's native undo stack can't be trusted.
 *
 * Only the block's slot is edited (slot.ts): icons at its edges stay as they
 * are, whatever the caret or a deletion tries.
 */

/* ─── finding the block under the pointer ──────────────────────────────── */

/** Never copy, nor inside copy. */
const NOT_COPY = new Set([
  "INPUT", "TEXTAREA", "SELECT", "OPTION", "OPTGROUP", "SCRIPT", "STYLE", "CANVAS", "IFRAME", "VIDEO", "AUDIO", "NOSCRIPT", "TEMPLATE",
  "OBJECT", "EMBED", "MATH", "HTML", "HEAD", "BODY", "TITLE",
]);

const hasWords = (n: Node) => /\S/.test((n.textContent || "").replace(/ /g, " "));

/** Words of its own: a direct text node with something other than blanks. */
function hasOwnText(el: Element): boolean {
  return Array.from(el.childNodes).some((n) => n.nodeType === 3 && hasWords(n));
}

/** A block whose copy can be edited and written back as it is (see findBounds). */
export function isTextBlock(el: Element): boolean {
  if (NOT_COPY.has(el.tagName.toUpperCase())) return false;
  if ((el as HTMLElement).isContentEditable) return false; // the page's own rich-text fields
  if (!mayHoldCopy(el)) return false;
  return findBounds(el) !== null;
}

/** Pure formatting: never a block of its own when its parent is one (unless it carries a class the site styles). */
const FORMAT = new Set(["B", "STRONG", "I", "EM", "U"]);
/** Redline's own track-changes marks inside a changed block. */
const isMark = (el: Element) => el.matches("ins[data-rl-ins],del[data-rl-del],span[data-rl-fmt]");

/**
 * The text block under a node. It starts at the nearest element with words
 * of its own (so the gaps of a nav between its links are nothing to edit),
 * and climbs to its parent only when that parent has words of its own too —
 * a link or a styled span inside a sentence belongs to the sentence — or when
 * it is plain formatting (or a track-changes mark) around the parent's copy.
 * A nav of links stays a set of links, each its own block, and a button's
 * label span stays the label. `ok: false` is copy that can't be edited here
 * (an image in the middle of it, a block inside it, a form control).
 */
export function pickBlock(node: Node | null): { el: HTMLElement; ok: boolean } | null {
  let el: Element | null = node && node.nodeType === 1 ? (node as Element) : (node?.parentElement ?? null);
  // an icon is part of the control it sits in
  const icon = el?.closest("svg");
  if (icon) el = icon.parentElement;
  while (el && !hasOwnText(el)) {
    if (NOT_COPY.has(el.tagName.toUpperCase()) || !mayHoldCopy(el)) return null;
    el = el.parentElement;
  }
  if (!el || NOT_COPY.has(el.tagName.toUpperCase()) || !mayHoldCopy(el)) return null;
  if (!isTextBlock(el)) return { el: el as HTMLElement, ok: false };
  for (;;) {
    const p: Element | null = el.parentElement;
    if (!p || !isTextBlock(p)) break;
    const formatting = isMark(el) || (FORMAT.has(el.tagName.toUpperCase()) && !el.getAttribute("class"));
    if (!formatting && !hasOwnText(p)) break;
    el = p;
  }
  return { el: el as HTMLElement, ok: true };
}

/** The editable block under a node, or null. */
export function blockAt(node: Node | null): HTMLElement | null {
  const b = pickBlock(node);
  return b?.ok ? b.el : null;
}

/* ─── a human label for the block ─────────────────────────────────────── */

const KIND: Record<string, string> = {
  H1: "heading", H2: "heading", H3: "heading", H4: "heading", H5: "heading", H6: "heading",
  A: "link", BUTTON: "button", LABEL: "label", LI: "list item", P: "paragraph", TH: "table heading", TD: "table cell",
  FIGCAPTION: "caption", CAPTION: "caption", BLOCKQUOTE: "quote", DT: "term", DD: "description", LEGEND: "legend", SUMMARY: "summary",
};

/** "the heading “Ship better design reviews”" — at most 140 characters. */
export function blockLabel(el: Element, text: string): string {
  let kind = KIND[el.tagName.toUpperCase()];
  if (!kind) {
    const host = el.closest("h1,h2,h3,h4,h5,h6,a,button,label,li,th,td,figcaption,caption,blockquote,summary,legend");
    kind = (host && KIND[host.tagName.toUpperCase()]) || (el.getAttribute("role") === "button" ? "button" : "text");
  }
  const words = text.replace(/\s+/g, " ").trim();
  const quote = words.length > 40 ? words.slice(0, 40).replace(/\s+\S*$/, "") + "…" : words;
  return `the ${kind} “${quote}”`.slice(0, 140);
}

/* ─── offsets: characters of a block's copy, a line break counting as one ── */

type Piece = { node: Text; start: number; len: number } | { node: Element; start: number; len: 1 };

/** Placeholder after a trailing line break (a lone trailing <br> shows no new line). */
const PLACEHOLDER = "data-rl-ph";

function pieces(el: Element, b: Bounds, skipDeleted = false): { list: Piece[]; length: number } {
  const list: Piece[] = [];
  let pos = 0;
  const visit = (c: Node) => {
    if (c.nodeType === 3) {
      const len = (c as Text).data.length;
      list.push({ node: c as Text, start: pos, len });
      pos += len;
    } else if (c.nodeType === 1) {
      const e = c as Element;
      if (e.tagName === "BR") {
        if (e.hasAttribute(PLACEHOLDER)) return;
        list.push({ node: e, start: pos, len: 1 });
        pos += 1;
      } else if (!(skipDeleted && e.tagName === "DEL" && e.hasAttribute("data-rl-del"))) {
        e.childNodes.forEach(visit);
      }
    }
  };
  slotNodes(el, b).forEach(visit);
  return { list, length: pos };
}

/** Character offset of a DOM boundary point inside the block's copy. */
export function offsetOf(el: Element, b: Bounds, container: Node, offset: number, skipDeleted = false): number {
  const { list, length } = pieces(el, b, skipDeleted);
  if (container.nodeType === 3) {
    const p = list.find((x) => x.node === container);
    if (p) return p.start + Math.min(offset, p.len);
    // a text node we skip (inside a deletion, an icon): the position of whatever follows it
    const parent = container.parentNode ?? el;
    offset = Array.prototype.indexOf.call(parent.childNodes, container) + 1;
    container = parent;
  }
  const child = container.childNodes[offset];
  if (!child) {
    // after the last child of `container`: the first piece after it
    const after = list.find((p) => container !== p.node && !container.contains(p.node) && container.compareDocumentPosition(p.node) & Node.DOCUMENT_POSITION_FOLLOWING);
    return after ? after.start : length;
  }
  const at = list.find((p) => p.node === child || child.contains(p.node) || child.compareDocumentPosition(p.node) & Node.DOCUMENT_POSITION_FOLLOWING);
  return at ? at.start : length;
}

/** The DOM boundary point at a character offset of the block's copy. */
export function pointAt(el: Element, b: Bounds, off: number): { node: Node; offset: number } {
  const { list } = pieces(el, b);
  for (const p of list) {
    if (p.node.nodeType === 3) {
      if (off <= p.start + p.len) return { node: p.node, offset: Math.max(0, off - p.start) };
    } else if (off <= p.start) {
      const parent = p.node.parentNode!;
      return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, p.node) };
    }
  }
  const last = list[list.length - 1];
  if (last && last.node.nodeType === 1) {
    const parent = last.node.parentNode!;
    return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, last.node) + 1 };
  }
  return { node: el, offset: el.childNodes.length - b.trail.length };
}

/* ─── the block's copy as runs ────────────────────────────────────────── */

const sameMarks = (a: InlineMark[], b: InlineMark[]) => a.length === b.length && a.every((m, i) => sameMark(m, b[i]));

/** The mark an element carries, in the sanitizer's terms (null: none, its text just flows through). */
function markOf(e: Element): InlineMark | null {
  const tag = e.tagName.toUpperCase();
  const cls = safeClass(e.getAttribute("class") || "");
  if (tag === "STRONG" || tag === "B") return { tag: "strong", cls, href: null };
  if (tag === "EM" || tag === "I") return { tag: "em", cls, href: null };
  if (tag === "U") return { tag: "u", cls, href: null };
  if (tag === "A") {
    const raw = e.getAttribute("href");
    const href = raw ? safeHref(raw) : null;
    if (href) return { tag: "a", cls, href };
    return cls ? { tag: "span", cls, href: null } : null;
  }
  if (tag === "SPAN") return cls ? { tag: "span", cls, href: null } : null;
  return null;
}

/** Marks inside `outer` plus `m`, as the sanitizer nests them: no mark twice, a link inside a link replaces it. */
function withMark(outer: InlineMark[], m: InlineMark): InlineMark[] {
  if (outer.some((x) => sameMark(x, m))) return outer;
  return [...(m.tag === "a" ? outer.filter((x) => x.tag !== "a") : outer), m];
}

/** The block's copy as runs, read straight from the DOM so offsets match `pieces`. */
function domRuns(el: Element, b: Bounds): Run[] {
  const out: Run[] = [];
  const visit = (c: Node, marks: InlineMark[]) => {
    if (c.nodeType === 3) {
      const text = (c as Text).data;
      if (!text) return;
      const last = out[out.length - 1];
      if (last && last.t === "text" && sameMarks(last.marks, marks)) last.text += text;
      else out.push({ t: "text", text, marks });
    } else if (c.nodeType === 1) {
      const e = c as Element;
      if (e.tagName === "BR") {
        if (!e.hasAttribute(PLACEHOLDER)) out.push({ t: "br" });
        return;
      }
      const m = markOf(e);
      const inner = m ? withMark(marks, m) : marks;
      e.childNodes.forEach((k) => visit(k, inner));
    }
  };
  slotNodes(el, b).forEach((n) => visit(n, []));
  return out;
}

const runLen = (r: Run) => (r.t === "br" ? 1 : r.text.length);
const textOf = (runs: Run[]) => runs.map((r) => (r.t === "br" ? "\n" : r.text)).join("");
const has = (r: TextRun, tag: InlineMark["tag"]) => r.marks.some((m) => m.tag === tag);
const linkOf = (r: TextRun) => r.marks.find((m) => m.tag === "a") ?? null;

/** Runs split so that `s` and `e` fall on run boundaries. */
function splitAt(runs: Run[], s: number, e: number): Run[] {
  const out: Run[] = [];
  let pos = 0;
  for (const r of runs) {
    const len = runLen(r);
    if (r.t === "text") {
      const cuts = [s, e].filter((c) => c > pos && c < pos + len).map((c) => c - pos);
      let from = 0;
      for (const c of [...new Set(cuts)].sort((a, b) => a - b)) {
        out.push({ ...r, text: r.text.slice(from, c) });
        from = c;
      }
      out.push({ ...r, text: r.text.slice(from) });
    } else out.push(r);
    pos += len;
  }
  return out;
}

function mapRange(runs: Run[], s: number, e: number, fn: (r: TextRun) => TextRun): Run[] {
  let pos = 0;
  return splitAt(runs, s, e).map((r) => {
    const start = pos;
    pos += runLen(r);
    return r.t === "text" && start >= s && start + r.text.length <= e ? fn(r) : r;
  });
}

function textRunsIn(runs: Run[], s: number, e: number): TextRun[] {
  let pos = 0;
  const out: TextRun[] = [];
  for (const r of splitAt(runs, s, e)) {
    const start = pos;
    pos += runLen(r);
    if (r.t === "text" && start >= s && start + r.text.length <= e && /\S/.test(r.text)) out.push(r);
  }
  return out;
}

export type MarkName = "strong" | "em" | "u";
export interface Marks {
  strong: boolean;
  em: boolean;
  u: boolean;
  href: string | null;
}

/* ─── caret from a point ──────────────────────────────────────────────── */

export function caretAt(doc: Document, x: number, y: number): { node: Node; offset: number } | null {
  const d = doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  try {
    const p = d.caretPositionFromPoint?.(x, y);
    if (p) return { node: p.offsetNode, offset: p.offset };
    const r = d.caretRangeFromPoint?.(x, y);
    if (r) return { node: r.startContainer, offset: r.startOffset };
  } catch {
    /* outside the document */
  }
  return null;
}

/** Text offset of a point inside a block shown as track changes, counted in the new copy (deleted words skipped). */
export function offsetInNewCopy(el: Element, b: Bounds, node: Node, offset: number): number {
  // a point inside a deletion lands where the deletion was
  let n: Node | null = node;
  while (n && n !== el) {
    if (n.nodeType === 1 && (n as Element).tagName === "DEL" && (n as Element).hasAttribute("data-rl-del")) {
      const parent = n.parentNode!;
      return offsetOf(el, b, parent, Array.prototype.indexOf.call(parent.childNodes, n), true);
    }
    n = n.parentNode;
  }
  return offsetOf(el, b, node, offset, true);
}

/* ─── the session ─────────────────────────────────────────────────────── */

interface Snapshot {
  html: string;
  s: number;
  e: number;
}

export interface SessionCallbacks {
  /** Enter */
  onCommit: () => void;
  /** Esc */
  onCancel: () => void;
  /** ⌘/Ctrl+K */
  onLinkRequest: () => void;
  /** after anything that may change the toolbar (selection, marks, history) */
  onState: () => void;
}

/** Events from inside the block that the page's own scripts must not see while it is edited. */
const SHIELDED = ["keydown", "keypress", "keyup", "beforeinput", "input", "paste", "cut", "copy", "drop", "dragover", "compositionstart", "compositionend"] as const;

/** Input types that would format with inline styles or restructure the block: never let the browser do them. */
const REFUSED = /^(format|insertOrderedList|insertUnorderedList|insertHorizontalRule|insertFromDrop|insertFromPasteAsQuotation|insertLink)/;

/** Typing within this long of the previous keystroke joins the same undo step. */
const COALESCE_MS = 400;

export class TextSession {
  readonly el: HTMLElement;
  readonly doc: Document;
  readonly bounds: Bounds;
  /** what the block's copy showed before the session (Esc puts it back) */
  readonly startHtml: string;
  /** the page's own copy of the block */
  readonly original: string;
  /** the cleaned copy the session started from: unchanged means nothing to save */
  private initial = "";
  private prevEditable: string | null;
  private history: Snapshot[] = [];
  private at = -1;
  private lastInput = 0;
  private saved: { s: number; e: number } | null = null;
  private off: Array<() => void> = [];
  private cb: SessionCallbacks;

  constructor(el: HTMLElement, original: string, bounds: Bounds, cb: SessionCallbacks) {
    this.el = el;
    this.doc = el.ownerDocument;
    this.bounds = bounds;
    this.original = original;
    this.startHtml = readSlot(el, bounds);
    this.prevEditable = el.getAttribute("contenteditable");
    this.cb = cb;
  }

  private read() {
    return readSlot(this.el, this.bounds);
  }
  private write(html: string) {
    writeSlot(this.el, this.bounds, html);
  }
  private len() {
    return pieces(this.el, this.bounds).length;
  }

  /**
   * Make the block editable, showing `html` (the new copy when the block has
   * an edit) and with the caret at `caret` characters, or at the end.
   */
  begin(html: string | null, caret: number | null) {
    const { el, doc } = this;
    if (html !== null && html !== this.read()) this.write(html);
    this.initial = this.html();
    el.setAttribute("contenteditable", "true");
    const win = doc.defaultView!;
    const inside = (e: Event) => {
      const t = e.target as Node | null;
      return Boolean(t && (t === el || el.contains(t)));
    };
    const handler = (e: Event) => {
      if (!inside(e)) return;
      // our handling first, then nobody else on the page
      this.handle(e);
      e.stopImmediatePropagation();
    };
    for (const t of SHIELDED) win.addEventListener(t, handler, true);
    const onSel = () => {
      this.clampSelection();
      const r = this.range();
      if (r) this.saved = r;
      this.cb.onState();
    };
    doc.addEventListener("selectionchange", onSel);
    this.off.push(
      () => SHIELDED.forEach((t) => win.removeEventListener(t, handler, true)),
      () => doc.removeEventListener("selectionchange", onSel),
    );
    const len = this.len();
    const at = caret === null ? len : Math.max(0, Math.min(len, caret));
    this.history = [{ html: this.read(), s: at, e: at }];
    this.at = 0;
    this.focus({ s: at, e: at });
  }

  /** Put the block back the way the page had it (attribute and listeners); the content stays. */
  end() {
    this.off.forEach((f) => f());
    this.off = [];
    if (this.prevEditable === null) this.el.removeAttribute("contenteditable");
    else this.el.setAttribute("contenteditable", this.prevEditable);
    this.doc.defaultView?.getSelection()?.removeAllRanges();
  }

  /** Esc: the copy as it was before the session. */
  restoreStart() {
    this.write(this.startHtml);
  }

  /** The cleaned copy: sanitized, without trailing line breaks (they are never copy). */
  html(): string {
    return sanitizeInline(this.read()).replace(/(?:<br>)+$/, "");
  }

  dirty(): boolean {
    return this.html() !== this.initial;
  }

  canUndo() {
    return this.at > 0;
  }
  canRedo() {
    return this.at < this.history.length - 1;
  }

  /** The selection as character offsets, when it is inside the block. */
  range(): { s: number; e: number } | null {
    const sel = this.doc.defaultView?.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!this.el.contains(r.startContainer) || !this.el.contains(r.endContainer)) return null;
    const s = offsetOf(this.el, this.bounds, r.startContainer, r.startOffset);
    const e = offsetOf(this.el, this.bounds, r.endContainer, r.endOffset);
    return { s: Math.min(s, e), e: Math.max(s, e) };
  }

  /** A selection reaching into an icon at the block's edge is pulled back to the copy. */
  private clampSelection() {
    const edges = edgeElements(this.bounds);
    if (!edges.length) return;
    const sel = this.doc.defaultView?.getSelection();
    if (!sel || !sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (!edges.some((n) => r.intersectsNode(n) && !(r.collapsed && !n.contains(r.startContainer)))) return;
    const cur = this.range();
    if (cur) this.focus(cur);
  }

  /** Focus the block with the given (or the last known) selection. */
  focus(sel = this.saved) {
    const { el, doc } = this;
    el.focus({ preventScroll: true });
    const s = doc.defaultView?.getSelection();
    if (!s) return;
    const len = this.len();
    const at = sel ?? { s: len, e: len };
    const a = pointAt(el, this.bounds, Math.min(at.s, len));
    const b = pointAt(el, this.bounds, Math.min(at.e, len));
    const r = doc.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    s.removeAllRanges();
    s.addRange(r);
    this.saved = at;
  }

  /**
   * The copy offset under a viewport point of the frame: where the caret
   * would land, or the start / end of the copy for a point before / after it.
   */
  offsetAtPoint(x: number, y: number): number {
    const p = caretAt(this.doc, x, y);
    if (p && this.el.contains(p.node)) return offsetOf(this.el, this.bounds, p.node, p.offset);
    const r = this.el.getBoundingClientRect();
    return y < r.top || (y <= r.bottom && x < r.left) ? 0 : this.len();
  }

  /**
   * Select for a pointer gesture, the way a text field does: a caret (1
   * click), the word (2) or all of the copy (3) at `anchor`, extended to
   * `focus` while the button is held.
   */
  selectFor(clicks: number, anchor: number, focus = anchor) {
    const len = this.len();
    if (clicks >= 3) return this.focus({ s: 0, e: len });
    if (clicks === 2) {
      const runs = domRuns(this.el, this.bounds);
      const a = this.wordAround(runs, anchor) ?? { s: anchor, e: anchor };
      const b = this.wordAround(runs, focus) ?? { s: focus, e: focus };
      return this.focus({ s: Math.min(a.s, b.s), e: Math.max(a.e, b.e) });
    }
    this.focus({ s: Math.min(anchor, focus), e: Math.max(anchor, focus) });
  }

  /** Remember the selection now (before the focus moves to Redline's own link field). */
  keepSelection() {
    const r = this.range();
    if (r) this.saved = r;
  }

  /** Marks of the selection: on when every selected character has it; for a caret, the character before it. */
  marks(): Marks {
    const runs = domRuns(this.el, this.bounds);
    const r = this.range() ?? this.saved ?? { s: 0, e: 0 };
    let sel: TextRun[];
    if (r.s === r.e) {
      sel = textRunsIn(runs, Math.max(0, r.s - 1), r.s);
      if (!sel.length) sel = textRunsIn(runs, r.s, r.s + 1);
    } else sel = textRunsIn(runs, r.s, r.e);
    if (!sel.length) return { strong: false, em: false, u: false, href: null };
    const first = linkOf(sel[0])?.href ?? null;
    const href = first && sel.every((x) => linkOf(x)?.href === first) ? first : null;
    return { strong: sel.every((x) => has(x, "strong")), em: sel.every((x) => has(x, "em")), u: sel.every((x) => has(x, "u")), href };
  }

  /** The word around a caret, for formatting without a selection. */
  private wordAround(runs: Run[], at: number): { s: number; e: number } | null {
    const text = textOf(runs);
    const isWord = (ch: string | undefined) => Boolean(ch && /[\p{L}\p{N}\p{M}_'’-]/u.test(ch));
    let s = at;
    let e = at;
    while (s > 0 && isWord(text[s - 1])) s--;
    while (e < text.length && isWord(text[e])) e++;
    return s < e ? { s, e } : null;
  }

  /** Write runs back into the block's copy and select `sel`. Recorded as its own undo step. */
  private render(runs: Run[], sel: { s: number; e: number }) {
    const merged: Run[] = [];
    for (const r of runs) {
      if (r.t === "text" && !r.text) continue;
      const last = merged[merged.length - 1];
      if (r.t === "text" && last && last.t === "text" && sameMarks(last.marks, r.marks)) last.text += r.text;
      else merged.push(r.t === "text" ? { ...r } : r);
    }
    const html = sanitizeInline(serializeRuns(merged));
    // a lone trailing <br> shows no new line: a placeholder after it makes the caret's line visible
    this.write(/<br>$/.test(html) ? html + `<br ${PLACEHOLDER}="">` : html);
    this.focus(sel);
    this.record(false);
  }

  /** Bold, italic or underline on the selection (or the word at the caret); off when all of it already has it. */
  toggle(tag: MarkName) {
    const runs = domRuns(this.el, this.bounds);
    let r = this.range() ?? this.saved;
    if (!r) return;
    if (r.s === r.e) r = this.wordAround(runs, r.s);
    if (!r) return;
    const sel = textRunsIn(runs, r.s, r.e);
    const on = !(sel.length > 0 && sel.every((x) => has(x, tag)));
    // added innermost, so the site's spans and links around the words stay where they are
    const mark: InlineMark = { tag, cls: "", href: null };
    this.render(
      mapRange(runs, r.s, r.e, (x) => ({ ...x, marks: on ? (has(x, tag) ? x.marks : [...x.marks, mark]) : x.marks.filter((m) => m.tag !== tag) })),
      r,
    );
  }

  /**
   * Link the selection to `href` (already validated), or unlink it (`null`).
   * A caret inside a link changes or removes that whole link; a caret
   * elsewhere inserts the address itself as linked text. A link that is
   * changed keeps its class and place; a new one borrows the class of the
   * block's other links, so it looks like the site's links around it.
   */
  setLink(href: string | null) {
    const runs = domRuns(this.el, this.bounds);
    let r = this.range() ?? this.saved;
    if (!r) return;
    const siteCls = runs.map((x) => (x.t === "text" ? linkOf(x)?.cls : undefined)).find((c) => c !== undefined) ?? "";
    const link = (x: TextRun): InlineMark[] => {
      const cur = linkOf(x);
      if (!href) return x.marks.filter((m) => m.tag !== "a");
      if (cur) return x.marks.map((m) => (m.tag === "a" ? { ...m, href } : m));
      return [{ tag: "a", cls: siteCls, href }, ...x.marks];
    };
    if (r.s === r.e) {
      const stretch = this.linkAround(runs, r.s);
      if (stretch) r = stretch;
      else if (href) {
        const prev = textRunsIn(runs, Math.max(0, r.s - 1), r.s)[0];
        const marks = [{ tag: "a" as const, cls: siteCls, href }, ...(prev?.marks ?? []).filter((m) => m.tag !== "a")];
        this.insertRuns(runs, r, [{ t: "text", text: href, marks }]);
        return;
      } else return;
    }
    this.render(mapRange(runs, r.s, r.e, (x) => ({ ...x, marks: link(x) })), r);
  }

  private linkAround(runs: Run[], at: number): { s: number; e: number } | null {
    let pos = 0;
    const spans: { s: number; e: number; href: string | null }[] = [];
    for (const r of runs) {
      const len = runLen(r);
      spans.push({ s: pos, e: pos + len, href: r.t === "text" ? (linkOf(r)?.href ?? null) : null });
      pos += len;
    }
    const i = spans.findIndex((x) => x.href && x.s < at && at <= x.e);
    const j = i === -1 ? spans.findIndex((x) => x.href && x.s === at) : i;
    if (j === -1) return null;
    const href = spans[j].href;
    let a = j;
    let b = j;
    while (a > 0 && spans[a - 1].href === href) a--;
    while (b < spans.length - 1 && spans[b + 1].href === href) b++;
    return { s: spans[a].s, e: spans[b].e };
  }

  /** Replace the selection with `add`. */
  private insertRuns(runs: Run[], r: { s: number; e: number }, add: Run[]) {
    const split = splitAt(runs, r.s, r.e);
    const before: Run[] = [];
    const after: Run[] = [];
    let pos = 0;
    for (const x of split) {
      const start = pos;
      pos += runLen(x);
      if (pos <= r.s) before.push(x);
      else if (start >= r.e) after.push(x);
    }
    const addLen = add.reduce((n, x) => n + runLen(x), 0);
    const at = r.s + addLen;
    this.render([...before, ...add, ...after], { s: at, e: at });
  }

  /** The formatting new text at `at` takes: that of the character before it (or the first one). */
  private styleAt(runs: Run[], at: number): InlineMark[] {
    const prev = textRunsIn(runs, Math.max(0, at - 1), at)[0] ?? runs.find((x): x is TextRun => x.t === "text");
    return prev?.marks ?? [];
  }

  /** Plain text at the selection; newlines become line breaks. */
  insertText(text: string) {
    const runs = domRuns(this.el, this.bounds);
    const r = this.range() ?? this.saved;
    if (!r) return;
    const marks = this.styleAt(runs, r.s);
    const add: Run[] = [];
    text
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .forEach((line, i) => {
        if (i > 0) add.push({ t: "br" });
        if (line) add.push({ t: "text", text: line, marks });
      });
    this.insertRuns(runs, r, add);
  }

  /** Shift+Enter. */
  lineBreak() {
    const runs = domRuns(this.el, this.bounds);
    const r = this.range() ?? this.saved;
    if (!r) return;
    this.insertRuns(runs, r, [{ t: "br" }]);
  }

  /** Replace the whole copy (Reset to original: the page's own markup); one undo step. */
  replaceWith(html: string) {
    this.write(html);
    const len = this.len();
    this.focus({ s: len, e: len });
    this.record(false);
  }

  /** Keep the current state in the history; typing in quick succession is one step. */
  private record(typing: boolean) {
    const now = Date.now();
    const r = this.range() ?? this.saved ?? { s: 0, e: 0 };
    const snap = { html: this.read(), s: r.s, e: r.e };
    const cur = this.history[this.at];
    if (cur && cur.html === snap.html) {
      cur.s = snap.s;
      cur.e = snap.e;
    } else if (typing && this.at > 0 && now - this.lastInput < COALESCE_MS) {
      this.history[this.at] = snap;
      this.history.length = this.at + 1;
    } else {
      this.history.length = this.at + 1;
      this.history.push(snap);
      this.at++;
    }
    this.lastInput = typing ? now : 0;
    this.cb.onState();
  }

  undo() {
    if (!this.canUndo()) return;
    this.go(this.at - 1);
  }
  redo() {
    if (!this.canRedo()) return;
    this.go(this.at + 1);
  }
  private go(i: number) {
    this.at = i;
    const snap = this.history[i];
    // a snapshot is this block's own earlier copy, read back from it
    this.write(snap.html);
    this.lastInput = 0;
    this.focus({ s: snap.s, e: snap.e });
    this.cb.onState();
  }

  /** Where a space typed into a button went in as a no-break space (see onKey). */
  private softSpace: number | null = null;

  /** Once a word follows the no-break space typed into a button, it becomes the plain space it stands for. */
  private settleSpace() {
    const at = this.softSpace;
    this.softSpace = null;
    if (at === null) return;
    const p = pointAt(this.el, this.bounds, at + 1);
    if (p.node.nodeType !== 3 || p.offset < 1) return;
    const t = p.node as Text;
    const next = t.data[p.offset];
    if (t.data[p.offset - 1] === "\u00a0" && next && /\S/.test(next)) t.replaceData(p.offset - 1, 1, " ");
  }

  /** The browser removed or moved an icon at the edge (a deletion across it): put it back where it was. */
  private keepEdges() {
    const { el, bounds } = this;
    if (boundsValid(el, bounds)) return;
    bounds.lead.forEach((n, i) => {
      if (el.childNodes[i] !== n) el.insertBefore(n, el.childNodes[i] ?? null);
    });
    bounds.trail.forEach((n) => el.appendChild(n));
  }

  /** Whether a deletion or replacement would reach into an icon at the block's edge. */
  private touchesEdges(e: InputEvent): boolean {
    const edges = edgeElements(this.bounds);
    if (!edges.length) return false;
    const target = e.getTargetRanges?.()[0];
    if (!target) return false;
    const r = this.doc.createRange();
    try {
      r.setStart(target.startContainer, target.startOffset);
      r.setEnd(target.endContainer, target.endOffset);
    } catch {
      return false;
    }
    return edges.some((n) => r.intersectsNode(n) && !(r.collapsed && !n.contains(r.startContainer)));
  }

  private handle(e: Event) {
    if (e.type === "keydown") return this.onKey(e as KeyboardEvent);
    if (e.type === "beforeinput") {
      const ie = e as InputEvent;
      const t = ie.inputType;
      if (t === "historyUndo" || t === "historyRedo") {
        e.preventDefault();
        if (t === "historyUndo") this.undo();
        else this.redo();
      } else if (t === "formatBold" || t === "formatItalic" || t === "formatUnderline") {
        e.preventDefault();
        this.toggle(t === "formatBold" ? "strong" : t === "formatItalic" ? "em" : "u");
      } else if (t === "insertParagraph") {
        e.preventDefault();
        this.cb.onCommit();
      } else if (t === "insertLineBreak") {
        e.preventDefault();
        this.lineBreak();
      } else if (t === "insertFromPaste" || REFUSED.test(t)) {
        e.preventDefault();
      } else if (this.touchesEdges(ie)) {
        e.preventDefault();
      }
      return;
    }
    if (e.type === "input") {
      this.keepEdges();
      this.settleSpace();
      this.record(true);
      return;
    }
    if (e.type === "paste") {
      e.preventDefault();
      const text = (e as ClipboardEvent).clipboardData?.getData("text/plain") ?? "";
      if (text) this.insertText(text);
      return;
    }
    if (e.type === "drop" || e.type === "dragover") e.preventDefault();
  }

  private onKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (e.key === "Escape") {
      e.preventDefault();
      this.cb.onCancel();
    } else if (e.key === "Enter" && !mod) {
      e.preventDefault();
      if (e.shiftKey) this.lineBreak();
      else this.cb.onCommit();
    } else if (mod && !e.altKey && (k === "b" || k === "i" || k === "u")) {
      e.preventDefault();
      this.toggle(k === "b" ? "strong" : k === "i" ? "em" : "u");
    } else if (mod && !e.altKey && k === "k") {
      e.preventDefault();
      this.keepSelection();
      this.cb.onLinkRequest();
    } else if (mod && k === "z") {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (e.ctrlKey && !e.metaKey && k === "y") {
      e.preventDefault();
      this.redo();
    } else if (e.key === " " && !mod && !e.altKey && this.el.closest("button,summary,[role=button]")) {
      // inside a button a space presses it instead of typing (and summary toggles): type it ourselves —
      // as a no-break space, which shows at the end of a line, until the next word follows it
      e.preventDefault();
      const at = this.range()?.s ?? null;
      this.insertText("\u00a0");
      this.softSpace = at;
    } else if (mod && k === "a") {
      // select all of the copy, not the icons around it
      e.preventDefault();
      this.focus({ s: 0, e: this.len() });
    }
  }
}

