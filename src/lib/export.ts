import type { Comment } from "./types";
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

/**
 * One row per thread in the shape Jira Cloud's CSV importer maps directly:
 * Summary, Description, Issue Type, Priority, Status, Labels (×2), Reporter,
 * Created, Comment (×N, "date;author;body"), plus extra columns you can map to
 * custom fields or skip.
 */
export function toJiraCsv(review: PublicReview, comments: Comment[], origin: string): string {
  const threads = bundle(comments);
  const maxReplies = Math.max(0, ...threads.map((t) => t.replies.length));
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
    "Redline URL",
    "Element",
    "Viewport",
    "Page URL",
    "Attachments",
  ];
  const rows = threads.map(({ root, replies }, i) => {
    const firstLine = plain(root.body).split("\n")[0].trim() || (root.attachments?.length ? "Image comment" : "Comment");
    const summary = `[${review.title}] ${firstLine.length > 110 ? firstLine.slice(0, 107) + "…" : firstLine}`;
    const link = `${origin}/r/${review.id}?c=${root.id}`;
    const description = [
      plain(root.body),
      "",
      `*Page:* ${review.url}`,
      root.anchor?.element_label ? `*Element:* {{${root.anchor.element_label}}}` : null,
      `*Viewport:* ${root.viewport_width}px`,
      root.anchor?.region ? `*Region:* ${Math.round(root.anchor.region.w)}×${Math.round(root.anchor.region.h)}px` : null,
      `*Open in Redline:* ${link}`,
      root.attachments?.length ? `*Attachments:* ${root.attachments.length} image(s) — see the Redline link` : null,
    ]
      .filter((x) => x !== null)
      .join("\n");
    const cells = [
      summary,
      description,
      "Task",
      "Medium",
      root.resolved ? "Done" : "To Do",
      "redline",
      `viewport-${root.viewport_width}`,
      root.author_name,
      jiraDate(root.created_at),
      ...Array.from({ length: maxReplies }, (_, k) => {
        const r = replies[k];
        return r ? `${jiraDate(r.created_at)};${r.author_name};${plain(r.body).replace(/\r?\n/g, " ")}` : "";
      }),
      link,
      root.anchor?.element_label || "",
      String(root.viewport_width),
      review.url,
      String(root.attachments?.length || 0),
    ];
    void i;
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
      out.push(`### ${i + 1}. ${plain(root.body).split("\n")[0].slice(0, 90) || "Image comment"}`);
      out.push(`- **By:** ${root.author_name} · ${new Date(root.created_at).toLocaleString()}`);
      if (root.anchor?.element_label) out.push(`- **Element:** \`${root.anchor.element_label}\``);
      out.push(`- **Viewport:** ${root.viewport_width}px`);
      out.push(`- **Link:** ${origin}/r/${review.id}?c=${root.id}`);
      out.push("");
      out.push(plain(root.body));
      if (root.attachments?.length) out.push(`\n_${root.attachments.length} image attachment(s)_`);
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
