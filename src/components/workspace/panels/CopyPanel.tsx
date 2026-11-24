"use client";

import { useMemo, useState } from "react";
import { Check, ClipboardCopy, Copy, LocateFixed, PencilLine, RotateCcw, Type, Undo2 } from "lucide-react";
import { Avatar, Button, Dialog, DialogContent, IconButton, Tip } from "@/components/ui/primitives";
import { useStore, type TextEditFound } from "@/lib/store";
import type { TextEdit } from "@/lib/types";
import { frame } from "@/lib/frame/controller";
import { pageRect, resolveSelector } from "@/lib/frame/dom";
import { cn, timeAgo } from "@/lib/util";
import { parseInline, sameMark, serializeRuns, type InlineMark } from "@/lib/text-edits/sanitize";
import { diffInline, renderChangesHtml } from "@/lib/text-edits/diff";
import { handoffAll, handoffText } from "@/lib/text-edits/format";
import { jumpToEdit } from "@/lib/text-edits/sync";
import { resetEdit, restoreAll, setEditNote, setEditStatus } from "@/lib/text-edits/actions";

type Shown = "open" | "done" | "live" | "outdated" | "missing" | "unstable";

const CHIP: Record<Shown, { label: string; className: string; title: string }> = {
  open: { label: "Open", className: "bg-copy-soft text-copy-ink", title: "Shown on the page — waiting for a developer" },
  done: { label: "Done", className: "bg-green/10 text-green", title: "Marked as implemented" },
  live: { label: "Live on the site", className: "bg-blue-soft text-blue", title: "The page already says this — the change has shipped" },
  outdated: { label: "Out of date", className: "bg-amber/10 text-amber", title: "The page's text changed since the edit was made — not applied" },
  missing: { label: "Not found", className: "bg-hover text-ink-3", title: "This text block is no longer on the page (or can't hold copy)" },
  unstable: { label: "Page keeps replacing it", className: "bg-amber/10 text-amber", title: "The page keeps replacing this text, so Redline stopped writing the new copy into it" },
};

export function shownStatus(e: TextEdit, found: TextEditFound | undefined): Shown {
  if (found === "missing" || found === "outdated" || found === "live" || found === "unstable") return found;
  return e.status;
}

/**
 * Copy for Redline's own UI: sanitized (parsed and written back from runs),
 * and without the site's classes — Redline uses utility classes too, and a
 * site's `hidden` or `text-indigo-600` must not style the panel.
 */
function forPanel(html: string): string {
  return serializeRuns(
    parseInline(html).map((r) => {
      if (r.t === "br") return r;
      const marks: InlineMark[] = [];
      for (const m of r.marks) {
        if (m.tag === "span") continue;
        const plain = { ...m, cls: "" };
        if (!marks.some((x) => sameMark(x, plain))) marks.push(plain);
      }
      return { ...r, marks };
    }),
  );
}

/** Before → after as track changes, from cleaned copy (safe to put into Redline's own DOM). */
function changesHtml(e: TextEdit): string {
  return renderChangesHtml(diffInline(forPanel(e.before_html), forPanel(e.after_html)));
}

async function copy(text: string, what: string) {
  const toast = useStore.getState().toast;
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${what}.`, "success");
  } catch {
    toast("The clipboard isn't available here.", "error");
  }
}

/**
 * The Copy tab: every copy change on this page, in the order they appear on
 * it, with what a developer needs to implement them — and, for editors,
 * Done / Reset / notes.
 */
export function CopyPanel() {
  const review = useStore((s) => s.review);
  const edits = useStore((s) => s.textEdits);
  const status = useStore((s) => s.textEditStatus);
  const viewOnly = useStore((s) => s.viewOnly);
  const layoutTick = useStore((s) => s.layoutTick);
  const frameReady = useStore((s) => s.frameReady);
  const [confirmAll, setConfirmAll] = useState(false);

  // top to bottom as on the page; blocks that aren't there go last
  const ordered = useMemo(() => {
    void layoutTick;
    const doc = frameReady ? frame().doc : null;
    const pos = new Map<string, { y: number; x: number } | null>();
    for (const e of edits) {
      const el = doc ? resolveSelector(doc, e.selector) : null;
      const r = el ? pageRect(el) : null;
      pos.set(e.id, r && status[e.id] !== "missing" ? { y: r.y, x: r.x } : null);
    }
    return [...edits].sort((a, b) => {
      const pa = pos.get(a.id);
      const pb = pos.get(b.id);
      if (pa && pb) return pa.y - pb.y || pa.x - pb.x;
      if (pa) return -1;
      if (pb) return 1;
      return a.created_at.localeCompare(b.created_at);
    });
  }, [edits, status, layoutTick, frameReady]);

  if (!review) return null;
  const open = edits.filter((e) => shownStatus(e, status[e.id]) === "open").length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-3">
        <span className="text-[12px] text-ink-2">
          {edits.length ? (
            <>
              <span className="num font-medium text-ink">{edits.length}</span> change{edits.length === 1 ? "" : "s"}
              {open > 0 && open !== edits.length && <span className="text-ink-3"> · {open} open</span>}
            </>
          ) : (
            "Copy changes"
          )}
        </span>
        <div className="flex-1" />
        <Tip label="Copy all as Markdown — paste into a ticket or chat" side="bottom">
          <Button size="sm" variant="ghost" disabled={!edits.length} onClick={() => void copy(handoffAll(ordered, review), `${edits.length} copy change${edits.length === 1 ? "" : "s"}`)}>
            <ClipboardCopy size={13} /> Copy all
          </Button>
        </Tip>
        {!viewOnly && (
          <Tip label="Restore all on this page — every block back to the site's copy" side="bottom">
            <IconButton size="sm" aria-label="Restore all on this page" disabled={!edits.length} onClick={() => setConfirmAll(true)}>
              <Undo2 size={14} />
            </IconButton>
          </Tip>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {edits.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Type size={22} className="text-ink-3" />
            <p className="text-[12.5px] leading-relaxed text-ink-2">
              {viewOnly ? (
                "No copy changes on this page."
              ) : (
                <>
                  No copy changes yet. Press <span className="kbd">T</span> and click any text on the page to change it.
                </>
              )}
            </p>
          </div>
        ) : (
          ordered.map((e) => <Row key={e.id} edit={e} found={status[e.id]} viewOnly={viewOnly} review={review} />)
        )}
      </div>

      <Dialog open={confirmAll} onOpenChange={setConfirmAll}>
        <DialogContent
          title="Restore all copy on this page?"
          description={`All ${edits.length} copy change${edits.length === 1 ? "" : "s"} on this page will be removed and every block shows the site's own text again. You can undo this right after.`}
          width={420}
        >
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirmAll(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmAll(false);
                void restoreAll();
              }}
            >
              Restore all
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ edit, found, viewOnly, review }: { edit: TextEdit; found: TextEditFound | undefined; viewOnly: boolean; review: { title: string; url: string } }) {
  const shown = shownStatus(edit, found);
  const chip = CHIP[shown];
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(edit.note ?? "");
  const html = useMemo(() => changesHtml(edit), [edit]);
  const pending = edit.id.startsWith("tmp-");

  const jump = () => {
    if (!jumpToEdit(edit.id)) useStore.getState().toast("This text block is no longer on the page.");
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      data-copy-row={edit.id}
      data-status={shown}
      role="button"
      tabIndex={0}
      onClick={jump}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          jump();
        }
      }}
      className={cn("group/row mb-1 cursor-pointer rounded-lg px-2.5 py-2 outline-none transition-colors hover:bg-hover focus-visible:shadow-[0_0_0_2px_var(--copy)]", pending && "opacity-70")}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span title={chip.title} className={cn("shrink-0 rounded-full px-1.5 py-px text-[10.5px] font-semibold", chip.className)}>
          {chip.label}
        </span>
        <span className="min-w-0 truncate text-[11.5px] text-ink-3" title={`${edit.label} · ${edit.selector}`}>
          {edit.label}
        </span>
      </div>

      {shown === "outdated" ? (
        <div className="mt-1.5 flex flex-col gap-1 text-[12.5px] leading-snug">
          <div>
            <span className="mr-1 text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">Was</span>
            <span className="text-ink-2" dangerouslySetInnerHTML={{ __html: forPanel(edit.before_html) }} />
          </div>
          <div className="rl-diff">
            <span className="mr-1 text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">New</span>
            <ins data-rl-ins="">
              <span dangerouslySetInnerHTML={{ __html: forPanel(edit.after_html) }} />
            </ins>
          </div>
        </div>
      ) : (
        <div className="rl-diff mt-1.5 break-words text-[13px] leading-[1.45] text-ink" dangerouslySetInnerHTML={{ __html: html }} />
      )}

      {edit.note && !noteOpen && (
        <p className="mt-1.5 whitespace-pre-wrap break-words rounded-md bg-paper px-2 py-1 text-[12px] leading-snug text-ink-2 hairline">{edit.note}</p>
      )}
      {noteOpen && (
        <textarea
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          rows={2}
          onClick={stop}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") {
              setNote(edit.note ?? "");
              setNoteOpen(false);
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
          }}
          onBlur={() => {
            setNoteOpen(false);
            void setEditNote(edit, note);
          }}
          placeholder="A note for the developer…"
          aria-label="Note"
          className="mt-1.5 w-full rounded-md bg-panel px-2 py-1.5 text-[12px] leading-snug text-ink hairline placeholder:text-ink-3 focus:shadow-[0_0_0_2px_var(--copy)]"
        />
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <Avatar name={edit.author_name} color={edit.author_color} size={16} />
        <span className="min-w-0 truncate text-[11.5px] text-ink-3">
          {edit.author_name} · {timeAgo(edit.updated_at)}
        </span>
        <div className="ml-auto flex items-center opacity-70 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100" onClick={stop}>
          <Tip label="Show on the page" side="top">
            <IconButton size="sm" aria-label="Jump to the text" onClick={jump}>
              <LocateFixed size={13} />
            </IconButton>
          </Tip>
          <Tip label="Copy for a developer (Markdown)" side="top">
            <IconButton
              size="sm"
              aria-label="Copy"
              onClick={() => void copy(handoffText(edit, review.title, review.url, { status: chip.label }), "the change")}
            >
              <Copy size={13} />
            </IconButton>
          </Tip>
          {!viewOnly && !pending && (
            <>
              <Tip label={edit.note ? "Edit note" : "Add a note"} side="top">
                <IconButton
                  size="sm"
                  aria-label={edit.note ? "Edit note" : "Add a note"}
                  onClick={() => {
                    setNote(edit.note ?? "");
                    setNoteOpen(true);
                  }}
                >
                  <PencilLine size={13} />
                </IconButton>
              </Tip>
              <Tip label={edit.status === "done" ? "Reopen" : "Mark done"} side="top">
                <IconButton
                  size="sm"
                  aria-label={edit.status === "done" ? "Reopen" : "Mark done"}
                  active={edit.status === "done"}
                  onClick={() => void setEditStatus(edit, edit.status === "done" ? "open" : "done")}
                >
                  <Check size={13} />
                </IconButton>
              </Tip>
              <Tip label="Reset to original" side="top">
                <IconButton size="sm" aria-label="Reset to original" onClick={() => void resetEdit(edit)}>
                  <RotateCcw size={13} />
                </IconButton>
              </Tip>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
