"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Link2, MoreHorizontal, Pencil, RotateCcw, SmilePlus, Trash2, Unlink } from "lucide-react";
import { Avatar, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Popover, PopoverContent, PopoverTrigger, Tip } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { repliesOf, useStore } from "@/lib/store";
import type { Attachment, Comment } from "@/lib/types";
import { cn, timeAgo } from "@/lib/util";
import { CommentBody } from "./CommentBody";
import { Composer, EMOJIS } from "./Composer";

export function useParticipants(): string[] {
  const comments = useStore((s) => s.comments);
  const review = useStore((s) => s.review);
  return useMemo(() => {
    const s = new Set<string>();
    comments.forEach((c) => s.add(c.author_name));
    if (review?.created_by) s.add(review.created_by);
    return Array.from(s);
  }, [comments, review]);
}

function Reactions({ c }: { c: Comment }) {
  const viewer = useStore((s) => s.viewer);
  const review = useStore((s) => s.review);
  const upsert = useStore((s) => s.upsertComment);
  const toast = useStore((s) => s.toast);
  const entries = Object.entries(c.reactions || {});

  async function react(emoji: string) {
    if (!review) return;
    if (!viewer.name) return toast("Add your name first — write a comment or reply.");
    try {
      const { comment } = await api.react(review.id, c.id, viewer.name, emoji);
      upsert(comment);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {entries.map(([emoji, who]) => (
        <button
          key={emoji}
          type="button"
          onClick={() => react(emoji)}
          title={who.join(", ")}
          className={cn(
            "flex h-6 items-center gap-1 rounded-full px-1.5 text-[12px] hairline transition-colors",
            who.includes(viewer.name) ? "bg-blue-soft text-blue !shadow-[0_0_0_1px_var(--blue)]" : "bg-panel hover:bg-hover",
          )}
        >
          <span>{emoji}</span>
          <span className="num text-[11px]">{who.length}</span>
        </button>
      ))}
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="flex h-6 w-6 items-center justify-center rounded-full text-ink-3 hover:bg-hover hover:text-ink" title="Add reaction">
            <SmilePlus size={13} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="grid w-[232px] grid-cols-8 gap-0.5 p-1.5" side="top">
          {EMOJIS.map((e) => (
            <button key={e} type="button" onClick={() => react(e)} className="rounded p-1 text-[16px] hover:bg-hover">
              {e}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function CommentItem({ c, isRoot, participants }: { c: Comment; isRoot: boolean; participants: string[] }) {
  const viewer = useStore((s) => s.viewer);
  const review = useStore((s) => s.review);
  const upsert = useStore((s) => s.upsertComment);
  const remove = useStore((s) => s.removeComment);
  const toast = useStore((s) => s.toast);
  const set = useStore((s) => s.set);
  const [editing, setEditing] = useState(false);
  const [lightbox, setLightbox] = useState<Attachment | null>(null);
  const mine = c.author_name === viewer.name;
  const canManage = mine || review?.is_owner;

  async function del() {
    if (!review) return;
    try {
      await api.deleteComment(review.id, c.id, viewer.name);
      remove(c.id);
      if (isRoot) set({ activeThread: null });
      toast(isRoot ? "Thread deleted." : "Reply deleted.");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  function copyLink() {
    const rootId = c.parent_id || c.id;
    const url = `${location.origin}/r/${review?.id}?c=${rootId}`;
    navigator.clipboard.writeText(url).then(() => toast("Link copied."));
  }

  return (
    <div className="group/c px-3 py-2">
      <div className="flex items-center gap-2">
        <Avatar name={c.author_name} color={c.author_color} size={22} />
        <span className="truncate text-[12.5px] font-semibold text-ink">{c.author_name}</span>
        <span className="text-[11px] text-ink-3" title={new Date(c.created_at).toLocaleString()}>
          {timeAgo(c.created_at)}
          {c.edited_at && " · edited"}
        </span>
        <div className="flex-1" />
        <div className="flex items-center opacity-0 transition-opacity group-hover/c:opacity-100 data-[open]:opacity-100">
          <Menu>
            <MenuTrigger asChild>
              <IconButton size="sm" aria-label="More">
                <MoreHorizontal size={14} />
              </IconButton>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem onSelect={copyLink}>
                <Link2 size={13} /> Copy link
              </MenuItem>
              {canManage && (
                <>
                  <MenuItem onSelect={() => setEditing(true)}>
                    <Pencil size={13} /> Edit
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem danger onSelect={del}>
                    <Trash2 size={13} /> {isRoot ? "Delete thread" : "Delete reply"}
                  </MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>
        </div>
      </div>

      <div className="mt-1 pl-[30px]">
        {editing ? (
          <Composer
            compact
            autoFocus
            initial={c.body}
            submitLabel="Save"
            participants={participants}
            onCancel={() => setEditing(false)}
            onSubmit={async (body) => {
              if (!review) return;
              try {
                const { comment } = await api.editComment(review.id, c.id, viewer.name, body);
                upsert(comment);
                setEditing(false);
              } catch (e) {
                toast((e as Error).message, "error");
              }
            }}
          />
        ) : (
          <>
            {c.body && <CommentBody text={c.body} me={viewer.name} className="text-[13px] leading-[1.5] text-ink break-words" />}
            {c.attachments?.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {c.attachments.map((a) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={a.id}
                    src={a.url}
                    alt={a.name}
                    onClick={() => setLightbox(a)}
                    className="h-20 max-w-[160px] cursor-zoom-in rounded-md object-cover hairline"
                  />
                ))}
              </div>
            )}
            <Reactions c={c} />
          </>
        )}
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-ink/80 p-8" onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox.url} alt={lightbox.name} className="max-h-full max-w-full rounded-lg shadow-pop" />
        </div>
      )}
    </div>
  );
}

export function Thread({ rootId, onClose, inPanel }: { rootId: string; onClose?: () => void; inPanel?: boolean }) {
  const comments = useStore((s) => s.comments);
  const viewer = useStore((s) => s.viewer);
  const review = useStore((s) => s.review);
  const viewport = useStore((s) => s.viewport);
  const upsert = useStore((s) => s.upsertComment);
  const markRead = useStore((s) => s.markRead);
  const toast = useStore((s) => s.toast);
  const participants = useParticipants();

  const root = comments.find((c) => c.id === rootId);
  const replies = repliesOf(comments, rootId);

  useEffect(() => {
    markRead(rootId);
  }, [rootId, comments.length, markRead]);

  if (!root || !review) return null;

  async function toggleResolve() {
    if (!root || !review) return;
    try {
      const { comment } = await api.resolveComment(review.id, root.id, viewer.name, !root.resolved);
      upsert(comment);
      toast(comment.resolved ? "Marked as resolved." : "Reopened.", "success");
      if (comment.resolved && !useStore.getState().showResolved) onClose?.();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div className={cn("flex max-h-[70vh] flex-col", inPanel ? "" : "w-[340px]")}>
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        {root.anchor?.element_label ? (
          <span className="mono truncate px-1 text-[10.5px] text-ink-3" title={root.anchor.element_label}>
            {root.anchor.element_label}
          </span>
        ) : (
          <span className="flex items-center gap-1 px-1 text-[10.5px] text-ink-3">
            <Unlink size={11} /> not attached to an element
          </span>
        )}
        <span className="mono text-[10.5px] text-ink-3">· {root.viewport_width}</span>
        <div className="flex-1" />
        <Tip label={root.resolved ? "Reopen" : "Mark as resolved"} side="bottom">
          <IconButton size="sm" onClick={toggleResolve} aria-label={root.resolved ? "Reopen" : "Mark as resolved"} className={root.resolved ? "!text-green" : ""}>
            {root.resolved ? <RotateCcw size={14} /> : <Check size={15} />}
          </IconButton>
        </Tip>
        {onClose && !inPanel && (
          <IconButton size="sm" onClick={onClose} aria-label="Close">
            <span className="text-[16px] leading-none">×</span>
          </IconButton>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {root.resolved && (
          <div className="mx-3 mt-1 flex items-center gap-1.5 rounded-md bg-green/10 px-2 py-1 text-[11.5px] font-medium text-green">
            <Check size={12} /> Resolved
          </div>
        )}
        <CommentItem c={root} isRoot participants={participants} />
        {replies.map((r) => (
          <CommentItem key={r.id} c={r} isRoot={false} participants={participants} />
        ))}
      </div>

      <div className="border-t border-line p-2">
        <Composer
          compact
          placeholder="Reply…"
          participants={participants}
          onSubmit={async (body, attachments) => {
            const { comment } = await api.createComment(review.id, {
              parent_id: root.id,
              author_name: useStore.getState().viewer.name,
              author_color: useStore.getState().viewer.color,
              body,
              attachments,
              viewport_width: viewport,
            });
            upsert(comment);
          }}
        />
      </div>
    </div>
  );
}
