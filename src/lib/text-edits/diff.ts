import { encodeText, HTML_FLAVOR, parseInline, serializeRuns, type InlineMark, type Run } from "./sanitize";

/**
 * Track changes for copy edits: a word-level diff of two inline-HTML
 * fragments that also notices formatting changes.
 *
 * Both sides are tokenized into words, single punctuation characters, runs of
 * whitespace and line breaks; the tokens are matched on their text only (any
 * whitespace equals any other whitespace, so re-indented source or an &nbsp;
 * for a space is not a change). Matched tokens whose marks differ — made bold,
 * linked, link changed — come out as `equal` with `prevMarks`. The result is
 * pure data; `renderChangesHtml` turns it into markup the reviewer styles.
 */

/**
 * A formatting mark, outermost first in a segment's list. Without a class:
 * "strong" | "em" | "u" | { a: href }. The site's class rides along as
 * { strong: cls } | { em: cls } | { u: cls } | { a: href, class: cls }, and
 * a span kept for its class is { span: cls }.
 */
export type Mark = "strong" | "em" | "u" | { a: string; class?: string } | { strong: string } | { em: string } | { u: string } | { span: string };

export interface Segment {
  kind: "equal" | "insert" | "delete";
  /** decoded text; "\n" is a line break */
  text: string;
  marks: Mark[];
  /** only on `equal` segments whose formatting changed: the marks before */
  prevMarks?: Mark[];
}

interface Tok {
  text: string;
  /** what tokens are matched on */
  key: string;
  marks: InlineMark[];
  ws: boolean;
}

const WORD = /[\p{L}\p{N}\p{M}_]+(?:['’][\p{L}\p{N}\p{M}_]+)*/uy;
const SPACE = /[\s ]+/y;

export function toMark(m: InlineMark): Mark {
  if (m.tag === "a") return m.cls ? { a: m.href ?? "", class: m.cls } : { a: m.href ?? "" };
  if (m.tag === "span") return { span: m.cls };
  if (!m.cls) return m.tag;
  return m.tag === "strong" ? { strong: m.cls } : m.tag === "em" ? { em: m.cls } : { u: m.cls };
}

export function fromMark(m: Mark): InlineMark {
  if (typeof m === "string") return { tag: m, cls: "", href: null };
  if ("a" in m) return { tag: "a", cls: m.class ?? "", href: m.a };
  if ("span" in m) return { tag: "span", cls: m.span, href: null };
  if ("strong" in m) return { tag: "strong", cls: m.strong, href: null };
  if ("em" in m) return { tag: "em", cls: m.em, href: null };
  return { tag: "u", cls: m.u, href: null };
}

const one = (m: InlineMark) => `${m.tag}\u0001${m.cls}\u0001${m.href ?? ""}`;
/** Same formatting, whatever the nesting order: what decides "formatting changed". */
const setKey = (ms: InlineMark[]) => ms.map(one).sort().join("\u0002");
/** Same formatting in the same order: what lets two segments merge. */
const orderKey = (ms: InlineMark[]) => ms.map(one).join("\u0002");

function tokens(runs: Run[]): Tok[] {
  const out: Tok[] = [];
  for (const r of runs) {
    if (r.t === "br") {
      out.push({ text: "\n", key: "\n", marks: [], ws: false });
      continue;
    }
    const marks = r.marks;
    const s = r.text;
    let i = 0;
    while (i < s.length) {
      SPACE.lastIndex = i;
      const ws = SPACE.exec(s);
      if (ws) {
        out.push({ text: ws[0], key: " ", marks, ws: true });
        i += ws[0].length;
        continue;
      }
      WORD.lastIndex = i;
      const w = WORD.exec(s);
      if (w) {
        out.push({ text: w[0], key: w[0], marks, ws: false });
        i += w[0].length;
        continue;
      }
      // one punctuation mark or symbol (a whole surrogate pair) at a time
      const ch = String.fromCodePoint(s.codePointAt(i)!);
      out.push({ text: ch, key: ch, marks, ws: false });
      i += ch.length;
    }
  }
  return out;
}

/**
 * Whether two fragments are the same copy: the same words, punctuation, line
 * breaks and formatting. Spacing doesn't count — an &nbsp; that
 * contentEditable put in for a space, a doubled space, blanks at either end
 * or around a line break — and neither does formatting on a blank alone.
 * This is what decides that an edit is back to the original (a reset).
 */
export function sameCopy(aHtml: string, bHtml: string): boolean {
  const shape = (html: string) => {
    const out: { key: string; marks: string }[] = [];
    for (const t of tokens(parseInline(html))) {
      const last = out[out.length - 1];
      if (t.ws) {
        if (last && last.key !== " " && last.key !== "\n") out.push({ key: " ", marks: "" });
        continue;
      }
      if (t.key === "\n" && last?.key === " ") out.pop();
      out.push({ key: t.key, marks: t.key === "\n" ? "" : setKey(t.marks) });
    }
    if (out[out.length - 1]?.key === " ") out.pop();
    return out;
  };
  const a = shape(aHtml);
  const b = shape(bHtml);
  return a.length === b.length && a.every((t, i) => t.key === b[i].key && t.marks === b[i].marks);
}

type Op = { op: "eq"; a: Tok; b: Tok } | { op: "del"; a: Tok } | { op: "ins"; b: Tok };

/** Beyond this many differences the two texts are unrelated: show a plain replacement. */
const MAX_D = 1000;

/** Myers' O((N+M)·D) shortest edit script over token keys. */
function myers(a: Tok[], b: Tok[]): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_D);
  const off = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x].key === b[y].key) {
        x++;
        y++;
      }
      next[off + k] = x;
      if (x >= n && y >= m) {
        trace.push(next);
        return backtrack(trace, a, b, off, d);
      }
    }
    v = next;
  }
  return null;
}

function backtrack(trace: Int32Array[], a: Tok[], b: Tok[], off: number, dEnd: number): Op[] {
  const ops: Op[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = dEnd; d >= 0; d--) {
    // trace[d] holds the furthest x per diagonal before step d
    const v = trace[d];
    const k = x - y;
    let prevK: number;
    if (d === 0) prevK = 0;
    else prevK = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : v[off + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push({ op: "eq", a: a[x], b: b[y] });
    }
    if (d > 0) {
      if (x === prevX) ops.push({ op: "ins", b: b[--y] });
      else ops.push({ op: "del", a: a[--x] });
    }
  }
  return ops.reverse();
}

function editScript(a: Tok[], b: Tok[]): Op[] {
  // the common head and tail cost nothing and keep the search small
  let head = 0;
  while (head < a.length && head < b.length && a[head].key === b[head].key) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail].key === b[b.length - 1 - tail].key) tail++;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const mid = myers(midA, midB) ?? [...midA.map((t): Op => ({ op: "del", a: t })), ...midB.map((t): Op => ({ op: "ins", b: t }))];
  const eq = (i: number, j: number): Op => ({ op: "eq", a: a[i], b: b[j] });
  return [
    ...Array.from({ length: head }, (_, i) => eq(i, i)),
    ...mid,
    ...Array.from({ length: tail }, (_, i) => eq(a.length - tail + i, b.length - tail + i)),
  ];
}

/**
 * Reads like a person's track changes: a lone space between two changes
 * joins them ("~~Log in~~ Sign up", not "~~Log~~Sign ~~in~~up"), and inside
 * each changed stretch the deletions come before the insertions.
 */
function tidy(ops: Op[]): Op[] {
  const changed = (o: Op | undefined) => !!o && o.op !== "eq";
  const joined: Op[] = [];
  ops.forEach((o, i) => {
    if (o.op === "eq" && o.a.ws && setKey(o.a.marks) === setKey(o.b.marks) && changed(ops[i - 1]) && changed(ops[i + 1])) {
      joined.push({ op: "del", a: o.a }, { op: "ins", b: o.b });
    } else joined.push(o);
  });
  const out: Op[] = [];
  let dels: Op[] = [];
  let inss: Op[] = [];
  const flush = () => {
    out.push(...dels, ...inss);
    dels = [];
    inss = [];
  };
  for (const o of joined) {
    if (o.op === "del") dels.push(o);
    else if (o.op === "ins") inss.push(o);
    else {
      flush();
      out.push(o);
    }
  }
  flush();
  return out;
}

/** Word-level diff of two inline-HTML fragments (sanitized or not — both are parsed the same way). */
export function diffInline(beforeHtml: string, afterHtml: string): Segment[] {
  const ops = tidy(editScript(tokens(parseInline(beforeHtml)), tokens(parseInline(afterHtml))));
  // built on internal marks, converted once at the end
  const segs: { kind: Segment["kind"]; text: string; marks: InlineMark[]; prev?: InlineMark[] }[] = [];
  for (const o of ops) {
    let seg: (typeof segs)[number];
    if (o.op === "eq") {
      // a whitespace change is no change: show the new spacing
      seg = { kind: "equal", text: o.b.text, marks: o.b.marks };
      if (setKey(o.a.marks) !== setKey(o.b.marks)) seg.prev = o.a.marks;
    } else if (o.op === "del") seg = { kind: "delete", text: o.a.text, marks: o.a.marks };
    else seg = { kind: "insert", text: o.b.text, marks: o.b.marks };
    const last = segs[segs.length - 1];
    if (
      last &&
      last.kind === seg.kind &&
      orderKey(last.marks) === orderKey(seg.marks) &&
      (last.prev === undefined) === (seg.prev === undefined) &&
      orderKey(last.prev ?? []) === orderKey(seg.prev ?? [])
    ) {
      last.text += seg.text;
    } else segs.push(seg);
  }
  return segs.map((s) => ({ kind: s.kind, text: s.text, marks: s.marks.map(toMark), ...(s.prev ? { prevMarks: s.prev.map(toMark) } : {}) }));
}

/** Segments back to runs (a "\n" is a line break). */
function runsOf(text: string, marks: Mark[]): Run[] {
  const inline = marks.map(fromMark);
  const out: Run[] = [];
  text.split("\n").forEach((part, i) => {
    if (i > 0) out.push({ t: "br" });
    if (part) out.push({ t: "text", text: part, marks: inline });
  });
  return out;
}

const MARK_NAME: Record<string, string> = { strong: "bold", em: "italic", u: "underline" };

/** "bold added, link changed, style “text-brand” removed" — the tooltip of a formatting-only change. */
export function describeFormatChange(prev: Mark[], next: Mark[]): string {
  const a = prev.map(fromMark);
  const b = next.map(fromMark);
  const parts: string[] = [];
  for (const k of ["strong", "em", "u"] as const) {
    const was = a.find((m) => m.tag === k);
    const is = b.find((m) => m.tag === k);
    if (!was !== !is) parts.push(`${MARK_NAME[k]} ${is ? "added" : "removed"}`);
    else if (was && is && was.cls !== is.cls) parts.push(`${MARK_NAME[k]} style changed`);
  }
  const la = a.find((m) => m.tag === "a");
  const lb = b.find((m) => m.tag === "a");
  if (!la && lb) parts.push(`link added (${lb.href})`);
  else if (la && !lb) parts.push(`link removed (was ${la.href})`);
  else if (la && lb && la.href !== lb.href) parts.push(`link changed (was ${la.href})`);
  else if (la && lb && la.cls !== lb.cls) parts.push("link style changed");
  const spans = (ms: InlineMark[]) => ms.filter((m) => m.tag === "span").map((m) => m.cls);
  for (const c of spans(b)) if (!spans(a).includes(c)) parts.push(`style “${c}” added`);
  for (const c of spans(a)) if (!spans(b).includes(c)) parts.push(`style “${c}” removed`);
  return parts.join(", ") || "formatting changed";
}

/**
 * Track-changes markup: `<ins data-rl-ins>` for new copy, `<del data-rl-del>`
 * for removed copy (with its old formatting), and
 * `<span data-rl-fmt title="…">` around words whose formatting alone changed.
 * Only these three wrappers are added; the reviewer's stylesheet in the frame
 * colours them with background/text-decoration/colour only, so the layout
 * stays the original's apart from the deleted words themselves.
 */
export function renderChangesHtml(segments: Segment[]): string {
  return segments
    .map((s) => {
      const inner = serializeRuns(runsOf(s.text, s.marks), HTML_FLAVOR);
      if (s.kind === "insert") return `<ins data-rl-ins>${inner}</ins>`;
      if (s.kind === "delete") return `<del data-rl-del>${inner}</del>`;
      if (s.prevMarks) return `<span data-rl-fmt title="${encodeText(describeFormatChange(s.prevMarks, s.marks)).replace(/"/g, "&quot;")}">${inner}</span>`;
      return inner;
    })
    .join("");
}
