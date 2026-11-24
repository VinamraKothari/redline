/**
 * Inline HTML for copy edits: the only markup a text edit may carry.
 *
 * Text edits come from a contentEditable inside the reviewed page, so their
 * HTML is whatever the browser (and the reviewed site's own markup) produced:
 * `<span style>`, `<font>`, `<div>`s for Enter, `&nbsp;`s, pasted junk. What
 * survives is text, `<br>`, `<strong>`, `<em>`, `<u>`, `<a href>` with a safe
 * address, and the site's own styling hooks: a `class` on those elements and
 * on `<span>` (Tailwind-style tokens only). Nothing can run, and nothing
 * changes the typography of the block it is put back into — the site's own
 * classes keep their spans, so the copy looks exactly as it did.
 *
 * Pure and DOM-free on purpose: the API sanitizes again on the server (Node),
 * and the reviewer runs the very same code in the browser, so both sides
 * agree byte for byte. The parser is a small hand-written tokenizer, not a
 * full HTML5 parser; whatever it does not understand becomes text, which is
 * always safe because text is re-encoded on the way out. Every step is linear
 * in the input, so hostile input can't stall the server.
 *
 * The document model is a flat list of runs (text with an ordered list of
 * marks, outermost first, or a line break); parsing builds runs and
 * serializing writes them back nested in exactly that order, which is what
 * makes `sanitizeInline` idempotent.
 */

export const MAX_HTML = 20_000;
/** What the API accepts before sanitizing: per-word spans from a site's markup add up quickly. */
export const MAX_RAW_HTML = 200_000;
const MAX_HREF = 2_000;
/** Marks deeper than this are ignored (their text stays); keeps every step linear. */
const MAX_MARKS = 24;

export type MarkTag = "strong" | "em" | "u" | "a" | "span";
/** A formatting mark: the element, its sanitized class ("" for none) and, on links, the address. */
export interface InlineMark {
  tag: MarkTag;
  cls: string;
  href: string | null;
}
/** One stretch of text with the same formatting, or a line break. */
export type TextRun = { t: "text"; text: string; marks: InlineMark[] };
export type Run = TextRun | { t: "br" };

export const sameMark = (a: InlineMark, b: InlineMark) => a.tag === b.tag && a.cls === b.cls && a.href === b.href;
const sameMarks = (a: InlineMark[], b: InlineMark[]) => a.length === b.length && a.every((m, i) => sameMark(m, b[i]));

/** Lone UTF-16 surrogates (which can't be encoded) become U+FFFD. */
export function fixSurrogates(s: string): string {
  return s.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd");
}

/* ─── entities ─────────────────────────────────────────────────────────── */

/**
 * Named entities worth knowing. Browsers only ever serialize &amp; &lt; &gt;
 * &quot; and &nbsp;; the rest covers hand-written or pasted HTML. An unknown
 * name stays literal text (and is re-encoded as such), which is harmless.
 */
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", colon: ":", tab: "\t", newline: "\n",
  copy: "©", reg: "®", trade: "™", hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", sbquo: "‚",
  ldquo: "“", rdquo: "”", bdquo: "„", laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›", bull: "•", middot: "·",
  euro: "€", pound: "£", yen: "¥", cent: "¢", sect: "§", para: "¶", deg: "°", plusmn: "±", times: "×",
  divide: "÷", frac12: "½", frac14: "¼", frac34: "¾", sup2: "²", sup3: "³", micro: "µ", shy: "\u00ad",
  ensp: "\u2002", emsp: "\u2003", thinsp: "\u2009", zwnj: "\u200c", zwj: "\u200d", iexcl: "¡", iquest: "¿",
  larr: "←", rarr: "→", uarr: "↑", darr: "↓", harr: "↔", check: "✓", hearts: "♥", star: "☆",
  auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", eacute: "é", egrave: "è",
  ecirc: "ê", aacute: "á", agrave: "à", acirc: "â", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ",
  ccedil: "ç", Eacute: "É", aring: "å", Aring: "Å", oslash: "ø", Oslash: "Ø", aelig: "æ", AElig: "Æ",
};

/** Decodes character references; invalid code points become U+FFFD, NUL disappears. */
export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]{1,8}|#[0-9]{1,9}|[a-zA-Z][a-zA-Z0-9]{1,31});?/g, (whole, ref: string) => {
    if (ref[0] === "#") {
      const cp = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (cp === 0) return "";
      if (!Number.isFinite(cp) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "\ufffd";
      return String.fromCodePoint(cp);
    }
    // named references need their semicolon here, except the classic five
    const hit = NAMED[ref] ?? NAMED[ref.toLowerCase()];
    if (hit === undefined) return whole;
    if (!whole.endsWith(";") && !["amp", "lt", "gt", "quot", "nbsp"].includes(ref.toLowerCase())) return whole;
    return hit;
  });
}

export function encodeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\u00a0/g, "&nbsp;");
}

function encodeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ─── links ────────────────────────────────────────────────────────────── */

/**
 * A link address that is safe to keep, cleaned the way a browser reads it
 * (entities decoded, tabs/newlines removed, surrounding blanks trimmed), or
 * null. Absolute addresses must be http, https, mailto or tel; relative and
 * root-relative paths, `?query` and `#fragment` pass.
 */
const SAFE_SCHEMES = ["http:", "https:", "mailto:", "tel:"];

export function safeHref(raw: string): string | null {
  const v = fixSurrogates(decodeEntities(raw)).replace(/[\t\n\r]/g, "").replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "");
  if (!v || v.length > MAX_HREF) return null;
  if (/[\u0000-\u001f\u007f]/.test(v)) return null;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(v);
  if (scheme && !SAFE_SCHEMES.includes(scheme[1].toLowerCase() + ":")) return null;
  // and the way a browser resolves it must agree: "//host<x" doesn't parse, "\\host" is http(s)
  try {
    if (!SAFE_SCHEMES.includes(new URL(v, "https://page.invalid/").protocol)) return null;
  } catch {
    return null;
  }
  return v;
}

/* ─── tokenizer ────────────────────────────────────────────────────────── */

type Token = { k: "text"; v: string } | { k: "open"; name: string; attrs: Record<string, string>; selfClosing: boolean } | { k: "close"; name: string };

/** Elements whose content is not markup: skipped whole, content included. */
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript"]);

const CLOSE_NAME = /<\/([a-zA-Z][^\s/>]*)/y;

function tokenize(html: string): Token[] {
  const out: Token[] = [];
  const n = html.length;
  let i = 0;
  let text = "";
  const flush = () => {
    if (text) out.push({ k: "text", v: decodeEntities(text) });
    text = "";
  };
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      text += html.slice(i);
      break;
    }
    text += html.slice(i, lt);
    i = lt;
    const next = html[i + 1] ?? "";
    if (html.startsWith("<!--", i)) {
      // a comment; unterminated runs to the end
      const end = html.indexOf("-->", i + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (next === "!" || next === "?") {
      // doctype, CDATA (a bogus comment in HTML) or processing instruction: up to the first ">"
      const end = html.indexOf(">", i + 2);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (next === "/" && /[a-zA-Z]/.test(html[i + 2] ?? "")) {
      CLOSE_NAME.lastIndex = i;
      const m = CLOSE_NAME.exec(html);
      const end = html.indexOf(">", i);
      flush();
      out.push({ k: "close", name: (m?.[1] ?? "").toLowerCase() });
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (/[a-zA-Z]/.test(next)) {
      const parsed = readStartTag(html, i);
      flush();
      out.push(parsed.token);
      i = parsed.end;
      // "<script/>" opens a script all the same in HTML
      if (RAW_TEXT.has(parsed.token.name)) {
        const re = new RegExp(`</${parsed.token.name}[\\s/>]`, "ig");
        re.lastIndex = i;
        const m = re.exec(html);
        if (!m) {
          i = n;
        } else {
          const end = html.indexOf(">", m.index);
          i = end === -1 ? n : end + 1;
        }
        out.push({ k: "close", name: parsed.token.name });
      }
      continue;
    }
    // a "<" that starts nothing is text
    text += "<";
    i++;
  }
  flush();
  return out;
}

function readStartTag(html: string, start: number): { token: Extract<Token, { k: "open" }>; end: number } {
  const n = html.length;
  let i = start + 1;
  let name = "";
  while (i < n && !/[\s/>]/.test(html[i])) name += html[i++];
  // no prototype: an attribute called "__proto__" or "constructor" is just a name
  const attrs: Record<string, string> = Object.create(null);
  let selfClosing = false;
  for (;;) {
    while (i < n && /[\s/]/.test(html[i])) {
      if (html[i] === "/" && html[i + 1] === ">") selfClosing = true;
      i++;
    }
    if (i >= n) break;
    if (html[i] === ">") {
      i++;
      break;
    }
    let an = "";
    while (i < n && !/[\s/>=]/.test(html[i])) an += html[i++];
    while (i < n && /\s/.test(html[i])) i++;
    let av = "";
    if (html[i] === "=") {
      i++;
      while (i < n && /\s/.test(html[i])) i++;
      const q = html[i];
      if (q === '"' || q === "'") {
        const end = html.indexOf(q, i + 1);
        av = html.slice(i + 1, end === -1 ? n : end);
        i = end === -1 ? n : end + 1;
      } else {
        while (i < n && !/[\s>]/.test(html[i])) av += html[i++];
      }
    }
    // the first occurrence of an attribute wins, as in a browser
    if (an && !(an.toLowerCase() in attrs)) attrs[an.toLowerCase()] = av;
    if (!an) i++;
  }
  return { token: { k: "open", name: name.toLowerCase(), attrs, selfClosing }, end: i };
}

/* ─── classes ──────────────────────────────────────────────────────────── */

/** One class token: what Tailwind and BEM produce, and nothing that can leave an attribute. */
const CLASS_TOKEN = /^[A-Za-z0-9_\-:/[\]#.%()!,=]+$/;
const MAX_CLASS_TOKENS = 20;
const MAX_CLASS = 300;

/**
 * The site's class list, cleaned: entities decoded, split on HTML whitespace,
 * tokens outside the allowed alphabet dropped, duplicates removed, at most 20
 * tokens and 300 characters. "" when nothing is left.
 */
export function safeClass(raw: string): string {
  const out: string[] = [];
  let len = 0;
  for (const tok of decodeEntities(raw).split(/[\t\n\f\r ]+/)) {
    if (!tok || !CLASS_TOKEN.test(tok) || out.includes(tok)) continue;
    const add = tok.length + (out.length ? 1 : 0);
    if (out.length >= MAX_CLASS_TOKENS || len + add > MAX_CLASS) break;
    out.push(tok);
    len += add;
  }
  return out.join(" ");
}

/* ─── parse into runs ──────────────────────────────────────────────────── */

const VOID = new Set(["br", "img", "hr", "input", "wbr", "meta", "link", "area", "base", "col", "embed", "source", "track", "param", "keygen"]);
/** Dropped together with everything inside them. */
const DROP = new Set([...RAW_TEXT, "svg", "math", "template", "object", "select", "video", "audio", "canvas", "head", "datalist", "map"]);
/** Each starts and ends a line — what contentEditable makes of Enter. */
const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "dd", "details", "dialog", "div", "dl", "dt", "fieldset", "figcaption", "figure",
  "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "li", "main", "nav", "ol", "p", "pre",
  "section", "summary", "table", "tr", "ul", "caption", "tbody", "thead", "tfoot", "center", "menu",
]);
const MARK_OF: Record<string, MarkTag> = { strong: "strong", b: "strong", em: "em", i: "em", u: "u" };

type Effect = { mark?: InlineMark; drop?: true; block?: true };

function effectOf(name: string, attrs: Record<string, string>): Effect {
  if (DROP.has(name)) return { drop: true };
  const cls = "class" in attrs ? safeClass(attrs.class) : "";
  if (MARK_OF[name]) return { mark: { tag: MARK_OF[name], cls, href: null } };
  if (name === "a") {
    const href = "href" in attrs ? safeHref(attrs.href) : null;
    if (href) return { mark: { tag: "a", cls, href } };
    // a link without a usable address still carries the site's styling
    return cls ? { mark: { tag: "span", cls, href: null } } : {};
  }
  // a span is kept only for its class: a bare one (or contentEditable's style spans) is unwrapped
  if (name === "span") return cls ? { mark: { tag: "span", cls, href: null } } : {};
  if (BLOCK.has(name)) return { block: true };
  return {};
}

/**
 * The marks inside `outer` plus `m`: an identical mark already open adds
 * nothing, and a link inside a link replaces it (nested links are invalid).
 */
function withMark(outer: InlineMark[], m: InlineMark): InlineMark[] {
  if (outer.length >= MAX_MARKS || outer.some((x) => sameMark(x, m))) return outer;
  return [...(m.tag === "a" ? outer.filter((x) => x.tag !== "a") : outer), m];
}

interface Open {
  name: string;
  marks: InlineMark[];
  drop: boolean;
  block: boolean;
}

/** Parses (possibly hostile) HTML into normalized runs: merged, no empty text. Linear time. */
export function parseInline(html: string): Run[] {
  const runs: Run[] = [];
  const root: Open = { name: "", marks: [], drop: false, block: false };
  const stack: Open[] = [];
  // how many elements of each name are open, so a stray closing tag costs nothing
  const openCount = new Map<string, number>();
  let lineHasText = false;
  let pendingBreak = false;
  const top = () => stack[stack.length - 1] ?? root;

  const softBreak = () => {
    if (lineHasText) pendingBreak = true;
  };
  const hardBreak = () => {
    if (pendingBreak) runs.push({ t: "br" });
    pendingBreak = false;
    runs.push({ t: "br" });
    lineHasText = false;
  };
  const addText = (raw: string, marks: InlineMark[]) => {
    const v = fixSurrogates(raw.replace(/\u0000/g, ""));
    if (!v) return;
    // &nbsp; is copy, not layout
    const blank = !/[^\s]/.test(v.replace(/ /g, "x"));
    if (blank && (pendingBreak || !lineHasText)) {
      // whitespace between blocks or at the start of a line is layout, not copy —
      // except at the very start of an inline block, where it is the copy's own
      if (pendingBreak || runs.length) return;
    }
    if (pendingBreak) {
      runs.push({ t: "br" });
      pendingBreak = false;
    }
    const last = runs[runs.length - 1];
    if (last && last.t === "text" && sameMarks(last.marks, marks)) last.text += v;
    else runs.push({ t: "text", text: v, marks });
    if (!blank) lineHasText = true;
  };

  for (const tok of tokenize(html)) {
    const cur = top();
    if (tok.k === "text") {
      if (!cur.drop) addText(tok.v, cur.marks);
      continue;
    }
    if (tok.k === "open") {
      if (tok.name === "br") {
        if (!cur.drop) hardBreak();
        continue;
      }
      if (tok.name === "hr") {
        if (!cur.drop) softBreak();
        continue;
      }
      // "/>" only closes an element in SVG and MathML; "<strong/>" opens a strong, as in a browser
      if (VOID.has(tok.name) || (tok.selfClosing && (tok.name === "svg" || tok.name === "math"))) continue;
      const fx = effectOf(tok.name, tok.attrs);
      const drop = cur.drop || !!fx.drop;
      if (fx.block && !drop) softBreak();
      stack.push({ name: tok.name, marks: fx.mark && !drop ? withMark(cur.marks, fx.mark) : cur.marks, drop, block: !!fx.block });
      openCount.set(tok.name, (openCount.get(tok.name) ?? 0) + 1);
      continue;
    }
    // a closing tag closes the nearest open element of that name (and whatever is still open inside it)
    if (!openCount.get(tok.name)) {
      if (tok.name === "br" && !cur.drop) hardBreak(); // browsers read a stray </br> as <br>
      continue;
    }
    let at = stack.length - 1;
    while (stack[at].name !== tok.name) at--;
    const closed = stack.splice(at);
    for (const c of closed) openCount.set(c.name, openCount.get(c.name)! - 1);
    if (!top().drop && closed.some((c) => c.block && !c.drop)) softBreak();
  }
  return runs;
}

/* ─── serialize ────────────────────────────────────────────────────────── */

export interface Flavor {
  open(m: InlineMark): string;
  close(m: InlineMark): string;
  text(s: string): string;
  br: string;
  /**
   * Markdown and Jira: emphasis must hug the words, so blanks at the edges
   * of a formatted stretch move outside its markers ("**Sign in** to", not
   * "**Sign in **to"), and markers never span a line break.
   */
  plain?: boolean;
}

const classAttr = (cls: string) => (cls ? ` class="${encodeAttr(cls)}"` : "");

export const HTML_FLAVOR: Flavor = {
  open: (m) => (m.tag === "a" ? `<a href="${encodeAttr(m.href ?? "")}"${classAttr(m.cls)}>` : `<${m.tag}${classAttr(m.cls)}>`),
  close: (m) => `</${m.tag}>`,
  text: encodeText,
  br: "<br>",
};

/**
 * Writes runs back out, nested exactly in their mark order. Marks already
 * open stay open while the next run starts with the same marks (so
 * `<strong>a <em>b</em></strong>`, not two strongs); in HTML a line break
 * never closes anything. Deterministic in the runs, which makes
 * parse∘serialize a fixpoint. With `max`, stops before the output (closing
 * tags included) would exceed it; `cut` says whether anything was left out.
 */
function serialize(runs: Run[], f: Flavor, max = Infinity): { out: string; cut: boolean } {
  let out = "";
  const stack: InlineMark[] = [];
  let closeCost = 0;
  let held = "";
  const closeTo = (len: number) => {
    while (stack.length > len) {
      const c = f.close(stack.pop()!);
      out += c;
      closeCost -= c.length;
    }
  };
  for (const r of runs) {
    if (r.t === "br") {
      if (f.plain) closeTo(0);
      const piece = held + f.br;
      if (out.length + piece.length + closeCost > max) return finish(true);
      out += piece;
      held = "";
      continue;
    }
    if (f.plain && !/\S/.test(r.text)) {
      // a blank stretch carries no visible formatting: keep it for whichever markers come next
      held += f.text(r.text);
      continue;
    }
    let keep = 0;
    while (keep < stack.length && keep < r.marks.length && sameMark(stack[keep], r.marks[keep])) keep++;
    let text = r.text;
    let before = "";
    if (f.plain) {
      // blanks before a change of formatting go outside the markers that close or open
      closeTo(keep);
      before = held;
      held = "";
      const lead = /^\s+/.exec(text)?.[0] ?? "";
      if (lead && r.marks.length > keep) {
        before += f.text(lead);
        text = text.slice(lead.length);
      }
    } else closeTo(keep);
    const opening = r.marks.slice(keep);
    const opens = opening.map((m) => f.open(m)).join("");
    const closes = opening.reduce((n, m) => n + f.close(m).length, 0);
    let trail = "";
    if (f.plain && r.marks.length) {
      const t = /\s+$/.exec(text)?.[0] ?? "";
      if (t && t.length < text.length) {
        text = text.slice(0, -t.length);
        trail = f.text(t);
      }
    }
    let body = f.text(text);
    const room = max - out.length - before.length - opens.length - closeCost - closes;
    let cut = false;
    if (body.length > room) {
      // take whole characters while they fit, counting each as it is encoded
      let fit = "";
      let used = 0;
      for (const ch of text) {
        const enc = f.text(ch);
        if (used + enc.length > room) break;
        fit += enc;
        used += enc.length;
      }
      if (!fit) return finish(true);
      body = fit;
      cut = true;
    }
    out += before + opens;
    for (const m of opening) stack.push(m);
    closeCost += closes;
    out += body;
    if (cut) return finish(true);
    held = trail;
  }
  return finish(false);

  function finish(cut: boolean) {
    closeTo(0);
    return { out: out + (cut ? "" : held), cut };
  }
}

export function serializeRuns(runs: Run[], f: Flavor = HTML_FLAVOR): string {
  return serialize(runs, f).out;
}

/* ─── public API ───────────────────────────────────────────────────────── */

/**
 * The cleaned inline HTML and whether it had to be cut to MAX_HTML
 * characters. Kept: text, `<br>`, `<strong>`, `<em>`, `<u>`, `<a href>`
 * (safe addresses only), `<span class>`, and a cleaned `class` on any of
 * them; no other attribute. `<b>`/`<i>` become `<strong>`/`<em>`, block
 * elements become line breaks, everything else gives up its tags and keeps
 * its text; script/style/svg and the like vanish with their content.
 */
export function sanitizeChecked(html: string): { html: string; truncated: boolean } {
  const first = serialize(parseInline(String(html ?? "")), HTML_FLAVOR, MAX_HTML);
  if (!first.cut) return { html: first.out, truncated: false };
  // a cut can leave a stretch the parser would normalize (a blank tail): settle it
  return { html: serialize(parseInline(first.out), HTML_FLAVOR, MAX_HTML).out, truncated: true };
}

/** The cleaned inline HTML (see sanitizeChecked), at most MAX_HTML characters. */
export function sanitizeInline(html: string): string {
  return sanitizeChecked(html).html;
}

/** Plain text with whitespace collapsed (line breaks and &nbsp; count as spaces) and trimmed. */
export function normalizeSpace(text: string): string {
  return text.replace(/[\s ]+/g, " ").trim();
}

/** The normalized text of inline HTML: what the reviewer compares with the live page. */
export function normalizeText(html: string): string {
  return normalizeSpace(
    parseInline(String(html ?? ""))
      .map((r) => (r.t === "br" ? " " : r.text))
      .join(""),
  );
}
