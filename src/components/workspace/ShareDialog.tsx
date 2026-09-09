"use client";

import { useState } from "react";
import { Check, Copy, Download, FileSpreadsheet, FileText, Image as ImageIcon, Link2, Eye } from "lucide-react";
import { Button, Dialog, DialogContent } from "@/components/ui/primitives";
import { useStore, threadRoots } from "@/lib/store";
import { toJiraCsv, toMarkdown } from "@/lib/export";
import { cn } from "@/lib/util";

function download(name: string, content: string | Blob, type = "text/plain") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 4000);
}

function LinkRow({ label, hint, url, Icon }: { label: string; hint: string; url: string; Icon: typeof Link2 }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-3 rounded-lg bg-paper px-3 py-2 hairline">
      <Icon size={15} className="shrink-0 text-ink-2" />
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-ink">{label}</div>
        <div className="truncate text-[11.5px] text-ink-3">{hint}</div>
      </div>
      <Button
        size="sm"
        variant={copied ? "primary" : "secondary"}
        onClick={() => {
          navigator.clipboard.writeText(url).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          });
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function ShareDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const review = useStore((s) => s.review);
  const comments = useStore((s) => s.comments);
  const viewport = useStore((s) => s.viewport);
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  if (!review) return null;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const base = `${origin}/r/${review.id}`;
  const roots = threadRoots(comments);
  const safe = review.title.replace(/[^\w.-]+/g, "-").slice(0, 60) || "redline";

  async function exportPng() {
    setBusy(true);
    toast("Rendering the canvas… this can take a few seconds on long pages.");
    try {
      const { toPng } = await import("@/lib/png");
      const blob = await toPng(viewport);
      if (blob) {
        download(`${safe}-${viewport}.png`, blob, "image/png");
        toast("PNG downloaded.", "success");
      } else toast("Couldn't render the page to an image.", "error");
    } catch (e) {
      toast(`PNG export failed: ${(e as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Share this review"
        description="Only members of this project can open it. Add people under Members on the project page; their role decides what they can do."
        width={480}
      >
        <div className="flex flex-col gap-2">
          <LinkRow label="Review link" hint="Members comment, draw and inspect according to their role" url={base} Icon={Link2} />
          <LinkRow label="View-only link" hint="Same page with the editing tools hidden — handy for presenting" url={`${base}?mode=view`} Icon={Eye} />
        </div>

        <h3 className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Export</h3>
        <div className="grid grid-cols-3 gap-2">
          <ExportTile
            Icon={FileSpreadsheet}
            label="Jira CSV"
            hint={`${roots.length} issue${roots.length === 1 ? "" : "s"}`}
            disabled={!roots.length}
            onClick={() => download(`${safe}-jira.csv`, toJiraCsv(review, comments, origin), "text/csv;charset=utf-8")}
          />
          <ExportTile
            Icon={FileText}
            label="Markdown"
            hint="Pending & resolved"
            disabled={!roots.length}
            onClick={() => download(`${safe}-feedback.md`, toMarkdown(review, comments, origin), "text/markdown")}
          />
          <ExportTile Icon={ImageIcon} label="PNG" hint={`Canvas at ${viewport}px`} disabled={busy} onClick={exportPng} />
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
          The Jira CSV uses the columns Jira Cloud&apos;s importer maps by default (Summary, Description, Issue Type, Priority, Status, Labels,
          Reporter, Created, Comment, Attachment). A thread&apos;s title becomes its Summary; images attached to comments are listed as public URLs
          in the Attachment columns and Jira downloads them during import. In Jira:{" "}
          <span className="text-ink-2">Settings → System → External system import → CSV</span>. Extra columns (Redline URL, Element, Viewport) can
          be mapped to custom fields or skipped.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function ExportTile({ Icon, label, hint, onClick, disabled }: { Icon: typeof Download; label: string; hint: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn("flex flex-col items-start gap-1 rounded-lg bg-paper p-3 text-left hairline transition-colors hover:bg-hover disabled:opacity-40 disabled:pointer-events-none")}
    >
      <Icon size={16} className="text-ink-2" />
      <span className="mt-1 text-[12.5px] font-medium text-ink">{label}</span>
      <span className="text-[11px] text-ink-3">{hint}</span>
    </button>
  );
}
