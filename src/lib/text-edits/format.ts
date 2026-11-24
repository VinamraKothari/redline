import type { TextEdit } from "@/lib/types";
import { parseInline, sameMark, serializeRuns, type Flavor, type InlineMark, type MarkTag, type Run } from "./sanitize";

/**
 * Copy edits as text a developer can paste into a ticket or a chat: Markdown
 * for the "Copy" buttons and the agent API, Jira wiki markup for the Jira
 * CSV. Pure, like the rest of lib/text-edits.
 */

const mdHref = (href: string | null) => (href ?? "").replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
const jiraHref = (href: string | null) => (href ?? "").replace(/[|\]]/g, encodeURIComponent);

const MD: Flavor = {
  open: (m) => (m.tag === "a" ? "[" : m.tag === "strong" ? "**" : m.tag === "em" ? "*" : m.tag === "u" ? "<u>" : ""),
  close: (m) => (m.tag === "a" ? `](${mdHref(m.href)})` : m.tag === "strong" ? "**" : m.tag === "em" ? "*" : m.tag === "u" ? "</u>" : ""),
  text: (s) => s.replace(/ /g, " ").replace(/[\\`*_[\]<>]/g, "\\$&"),
  br: "  \n",
  plain: true,
};

const JIRA: Flavor = {
  open: (m) => (m.tag === "a" ? "[" : m.tag === "strong" ? "*" : m.tag === "em" ? "_" : m.tag === "u" ? "+" : ""),
  close: (m) => (m.tag === "a" ? `|${jiraHref(m.href)}]` : m.tag === "strong" ? "*" : m.tag === "em" ? "_" : m.tag === "u" ? "+" : ""),
  text: (s) => s.replace(/ /g, " ").replace(/[\\*_+[\]{}|^~]/g, "\\$&"),
  br: "\n",
  plain: true,
};

const ORDER: MarkTag[] = ["a", "strong", "em", "u"];

/**
 * What text markup can say: the site's classes and spans don't travel, and
 * each mark appears once, link outermost — so the Markdown reads cleanly.
 */
function plainRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    if (r.t === "br") {
      out.push(r);
      continue;
    }
    const marks: InlineMark[] = ORDER.flatMap((tag) => {
      const m = r.marks.find((x) => x.tag === tag);
      return m ? [{ tag, cls: "", href: m.href }] : [];
    });
    const last = out[out.length - 1];
    if (last && last.t === "text" && last.marks.length === marks.length && last.marks.every((m, i) => sameMark(m, marks[i]))) last.text += r.text;
    else out.push({ t: "text", text: r.text, marks });
  }
  return out;
}

/** `**bold**`, `*italic*`, `<u>underline</u>`, `[text](href)`, line breaks as "  \n". */
export function toMarkdown(html: string): string {
  return serializeRuns(plainRuns(parseInline(html)), MD)
    .split("\n")
    .map((line) =>
      // what would start a heading, list, rule or setext underline at the start of a line is text here
      line.replace(/^(\s*)([#+=-])/, "$1\\$2").replace(/^(\s*)(\d+)([.)])/, "$1$2\\$3"),
    )
    .join("\n");
}

/** Jira wiki markup: `*bold*`, `_italic_`, `+underline+`, `[text|url]`, line breaks as newlines. */
export function toJira(html: string): string {
  return serializeRuns(plainRuns(parseInline(html)), JIRA)
    .split("\n")
    .map((line) => line.replace(/^(\s*)([#-])/, "$1\\$2").replace(/^(\s*)(h[1-6]|bq)\./, "$1$2\\."))
    .join("\n");
}

export interface HandoffOptions {
  /** "markdown" (default) or Jira wiki markup */
  format?: "markdown" | "jira";
  /** adds a "Status:" line, e.g. "Open", "Done", "Out of date" */
  status?: string;
  /** leave out the "Page:" line (handoffAll writes it once) */
  page?: boolean;
}

/**
 * One edit as a block a developer can act on:
 *
 *   Page: Checkout — https://shop.test/checkout
 *   Where: the heading “Login” (selector: main h1)
 *   Before: Log in to view your orders
 *   After: **Sign in** to view your orders
 *   Note: …
 */
export function handoffText(edit: TextEdit, reviewTitle: string, reviewUrl: string, opts: HandoffOptions = {}): string {
  const jira = opts.format === "jira";
  const conv = jira ? toJira : toMarkdown;
  const label = (s: string) => (jira ? `*${s}:*` : `${s}:`);
  const copy = (html: string) => conv(html).trim() || "(empty)";
  // Jira's {{monospace}} can't hold braces; such a selector is written as escaped text
  const selector = jira ? (/[{}]/.test(edit.selector) ? JIRA.text(edit.selector) : `{{${edit.selector}}}`) : `\`${edit.selector.replace(/`/g, "")}\``;
  return [
    opts.page === false ? null : `${label("Page")} ${reviewTitle} — ${reviewUrl}`,
    `${label("Where")} ${edit.label || "a text block"} (selector: ${selector})`,
    `${label("Before")} ${copy(edit.before_html)}`,
    `${label("After")} ${copy(edit.after_html)}`,
    opts.status ? `${label("Status")} ${opts.status}` : null,
    edit.note ? `${label("Note")} ${edit.note}` : null,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

/** Every edit of a page, oldest first, under one "Page:" line. */
export function handoffAll(edits: TextEdit[], review: { title: string; url: string }, opts: Omit<HandoffOptions, "page"> = {}): string {
  const sorted = [...edits].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const label = (x: string) => (opts.format === "jira" ? `*${x}:*` : `${x}:`);
  const head = `${label("Page")} ${review.title} — ${review.url}\n${label("Copy changes")} ${sorted.length}`;
  return [head, ...sorted.map((e) => handoffText(e, review.title, review.url, { ...opts, page: false }))].join("\n\n");
}

export const STATUS_LABEL: Record<TextEdit["status"], string> = { open: "Open", done: "Done" };
