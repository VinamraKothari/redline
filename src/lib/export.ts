import type { Comment } from "./types";
import { KIND_LABEL, kindsInRange, viewportExportLabel, viewportRange } from "./viewports";
import type { PublicReview } from "./review";

/* ─── shared ─────────────────────────────────────────────────────────────── */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Jira's default import date format: dd/MMM/yy h:mm a */
export function jiraDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mon = MONTHS[d.getMonth()];
  const yy = String(d.getFullYear()).slice(-2);
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mon}/${yy} ${h}:${mm} ${ampm}`;
}

function plain(text: string): string {
  return text.replace(/@\[([^\]]+)\]/g, "@$1");
}

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface ThreadBundle {
  root: Comment;
  replies: Comment[];
}

export function bundle(comments: Comment[]): ThreadBundle[] {
  const roots = comments.filter((c) => !c.parent_id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  return roots.map((root) => ({
    root,
    replies: comments.filter((c) => c.parent_id === root.id).sort((a, b) => a.created_at.localeCompare(b.created_at)),
  }));
}

/* ─── Jira CSV ───────────────────────────────────────────────────────────── */

/** The Jira summary: the thread's title, or an auto-generated one from the first line. */
export function jiraSummary(review: PublicReview, root: Comment): string {
  if (root.title) return root.title;
  const firstLine = plain(root.body).split("\n")[0].trim() || (root.attachments?.some((a) => a.kind === "video") ? "Screen recording" : root.attachments?.length ? "Image comment" : "Comment");
  return `[${review.title}] ${firstLine.length > 110 ? firstLine.slice(0, 107) + "…" : firstLine}`;
}

/** Public URL of an attachment (served by /api/attachments — Jira downloads it from here). */
export function attachmentUrl(origin: string, comment: Comment, att: Comment["attachments"][number]): string {
  return `${origin}/api/attachments/${comment.id}/${att.id}`;
}

/**
 * Jira's CSV importer takes attachments as "dd/MMM/yy h:mm a;author;filename;url"
 * (or a bare URL) in one or more "Attachment" columns and downloads each file
 * from the URL while importing.
 */
function jiraAttachment(origin: string, c: Comment, att: Comment["attachments"][number]): string {
  if (att.kind === "video") {
    const vext = /\.mp4(\?|$)/i.test(att.url) ? "mp4" : "webm";
    const vbase = (att.name || "recording").replace(/[^\w.-]+/g, "-").replace(/\.[^.]+$/, "") || "recording";
    return `${jiraDate(c.created_at)};${c.author_name};${vbase}.${vext};${absolute(origin, att.url)}`;
  }
  const ext = att.url.startsWith("data:image/png") ? "png" : att.url.startsWith("data:image/webp") ? "webp" : /\.png(\?|$)/i.test(att.url) ? "png" : "jpg";
  const base = (att.name || "image").replace(/[^\w.-]+/g, "-").replace(/\.[^.]+$/, "") || "image";
  // files already in storage are public; inline (older) images are served by /api/attachments
  const url = /^https?:\/\//i.test(att.url) ? att.url : att.url.startsWith("/") ? absolute(origin, att.url) : attachmentUrl(origin, c, att);
  return `${jiraDate(c.created_at)};${c.author_name};${base}.${ext};${url}`;
}

/** Storage URLs are absolute in production; the local adapter serves relative ones. */
function absolute(origin: string, url: string): string {
  return url.startsWith("/") ? origin + url : url;
}

/** Order of threads in the CSV = numbering of the markers on the rendered screenshots. */
export function threadOrder(comments: Comment[]): Comment[] {
  return bundle(comments).map((t) => t.root);
}

/**
 * One row per thread in the shape Jira Cloud's CSV importer maps directly:
 * Summary, Description, Issue Type, Priority, Status, Labels (×2), Reporter,
 * Created, Comment (×N, "date;author;body"), Attachment (×N), plus extra
 * columns you can map to custom fields or skip.
 */
export function toJiraCsv(review: PublicReview, comments: Comment[], origin: string, screenshots: Record<string, string> = {}): string {
  const threads = bundle(comments);
  const maxReplies = Math.max(0, ...threads.map((t) => t.replies.length));
  const attachmentsOf = ({ root, replies }: ThreadBundle) => {
    const n = threads.findIndex((t) => t.root.id === root.id) + 1;
    const shot = screenshots[root.id];
    return [
      ...(shot ? [`${jiraDate(root.created_at)};${root.author_name};redline-${n}.jpg;${shot}`] : []),
      ...[root, ...replies].flatMap((c) => (c.attachments || []).map((a) => jiraAttachment(origin, c, a))),
    ];
  };
  const recordingsOf = ({ root, replies }: ThreadBundle) =>
    [root, ...replies].flatMap((c) => (c.attachments || []).filter((a) => a.kind === "video" && /^(https?:\/\/|\/)/i.test(a.url)).map((a) => ({ c, a: { ...a, url: absolute(origin, a.url) } })));
  const maxAttachments = Math.max(0, ...threads.map((t) => attachmentsOf(t).length));
  const header = [
    "Summary",
    "Description",
    "Issue Type",
    "Priority",
    "Status",
    "Labels",
    "Labels",
    "Reporter",
    "Created",
    ...Array.from({ length: maxReplies }, () => "Comment"),
    ...Array.from({ length: maxAttachments }, () => "Attachment"),
    "Redline URL",
    "Element",
    "Viewport",
    "Page URL",
  ];
  const rows = threads.map((t) => {
    const { root, replies } = t;
    const link = `${origin}/r/${review.id}?c=${root.id}`;
    const atts = attachmentsOf(t);
    const description = [
      plain(root.body),
      "",
      `*Page:* ${review.url}`,
      root.anchor?.element_label ? `*Element:* {{${root.anchor.element_label}}}` : null,
      `*Viewport:* ${viewportExportLabel(root)}`,
      root.anchor?.region ? `*Region:* ${Math.round(root.anchor.region.w)}×${Math.round(root.anchor.region.h)}px` : null,
      `*Open in Redline:* ${link}`,
      screenshots[root.id] ? `*Screenshot:* ${screenshots[root.id]}` : null,
      ...recordingsOf(t).map(({ c, a }, i) => `*Recording ${i + 1}:* [${a.duration ? `${Math.floor(a.duration / 60)}:${String(a.duration % 60).padStart(2, "0")} by ${c.author_name}` : c.author_name}|${a.url}] — opens in the browser`),
      atts.length ? `*Attachments:* ${atts.length} file(s) attached to this issue` : null,
    ]
      .filter((x) => x !== null)
      .join("\n");
    const cells = [
      jiraSummary(review, root),
      description,
      "Task",
      "Medium",
      root.resolved ? "Done" : "To Do",
      "redline",
      viewportRange(root) ? `viewport-${kindsInRange(viewportRange(root)!).map((k) => KIND_LABEL[k].toLowerCase()).join("-")}` : `viewport-${root.viewport_width}`,
      root.author_name,
      jiraDate(root.created_at),
      ...Array.from({ length: maxReplies }, (_, k) => {
        const r = replies[k];
        return r ? `${jiraDate(r.created_at)};${r.author_name};${plain(r.body).replace(/\r?\n/g, " ")}` : "";
      }),
      ...Array.from({ length: maxAttachments }, (_, k) => atts[k] || ""),
      link,
      root.anchor?.element_label || "",
      viewportExportLabel(root),
      review.url,
    ];
    return cells.map(csvCell).join(",");
  });
  return "﻿" + [header.map(csvCell).join(","), ...rows].join("\r\n");
}

/* ─── Markdown ───────────────────────────────────────────────────────────── */

export function toMarkdown(review: PublicReview, comments: Comment[], origin: string): string {
  const threads = bundle(comments);
  const pending = threads.filter((t) => !t.root.resolved);
  const resolved = threads.filter((t) => t.root.resolved);
  const section = (title: string, list: ThreadBundle[]) => {
    if (!list.length) return "";
    const out = [`## ${title} (${list.length})`, ""];
    list.forEach(({ root, replies }, i) => {
      out.push(`### ${i + 1}. ${root.title || plain(root.body).split("\n")[0].slice(0, 90) || "Image comment"}`);
      out.push(`- **By:** ${root.author_name} · ${new Date(root.created_at).toLocaleString()}`);
      if (root.anchor?.element_label) out.push(`- **Element:** \`${root.anchor.element_label}\``);
      out.push(`- **Viewport:** ${viewportExportLabel(root)}`);
      out.push(`- **Link:** ${origin}/r/${review.id}?c=${root.id}`);
      out.push("");
      out.push(plain(root.body));
      const vids = [root, ...replies].flatMap((c) => (c.attachments || []).filter((a) => a.kind === "video"));
      const imgs = root.attachments?.filter((a) => a.kind !== "video") ?? [];
      if (imgs.length) out.push(`\n_${imgs.length} image attachment(s)_`);
      vids.forEach((a, k) => out.push(`- **Recording ${k + 1}:** ${absolute(origin, a.url)}`));
      if (replies.length) {
        out.push("");
        replies.forEach((r) => out.push(`> **${r.author_name}** (${new Date(r.created_at).toLocaleString()}): ${plain(r.body).replace(/\n/g, "\n> ")}`));
      }
      out.push("");
    });
    return out.join("\n");
  };
  return [
    `# Design feedback — ${review.title}`,
    "",
    `Page: ${review.url}  `,
    `Review: ${origin}/r/${review.id}  `,
    `Exported: ${new Date().toLocaleString()}`,
    "",
    section("Pending", pending),
    section("Resolved", resolved),
  ].join("\n");
}
