"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Link2, MoreHorizontal, Pencil, RotateCcw, SmilePlus, Trash2, Unlink, Mail, MailOpen } from "lucide-react";
import { Avatar, IconButton, Menu, MenuCheckboxItem, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Popover, PopoverContent, PopoverTrigger, Tip } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { repliesOf, useStore } from "@/lib/store";
import type { Attachment, Comment } from "@/lib/types";
import { cn, timeAgo } from "@/lib/util";
import { KIND_LABEL, KIND_ORDER, kindOf, kindsInRange, rangeForKinds, viewportLabel, viewportRange, type ViewportKind } from "@/lib/viewports";
import { clock } from "@/lib/recorder";
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

  const comments = useStore((s) => s.comments);
  // reactions store user ids; show names where we know them
  const nameOf = (id: string) => (id === viewer.user_id ? "You" : comments.find((x) => x.author_id === id)?.author_name || "Someone");

  async function react(emoji: string) {
    if (!review) return;
    try {
      const { comment } = await api.react(c.id, emoji);
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
          title={who.map(nameOf).join(", ")}
          className={cn(
            "flex h-6 items-center gap-1 rounded-full px-1.5 text-[12px] hairline transition-colors",
            who.includes(viewer.user_id) ? "bg-blue-soft text-blue !shadow-[0_0_0_1px_var(--blue)]" : "bg-panel hover:bg-hover",
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

/** Profile picture of another reviewer, when they are present right now. */
function useAvatarOf() {
  const viewers = useStore((s) => s.viewers);
  return (id: string | null) => (id ? viewers.find((v) => v.user_id === id)?.avatar_url ?? null : null);
}

function CommentItem({ c, isRoot, participants }: { c: Comment; isRoot: boolean; participants: string[] }) {
  const viewer = useStore((s) => s.viewer);
  const avatarOf = useAvatarOf();
  const review = useStore((s) => s.review);
  const upsert = useStore((s) => s.upsertComment);
  const remove = useStore((s) => s.removeComment);
  const toast = useStore((s) => s.toast);
  const set = useStore((s) => s.set);
  const [editing, setEditing] = useState(false);
  const [lightbox, setLightbox] = useState<Attachment | null>(null);
  const mine = c.author_id === viewer.user_id;
  const canManage = mine || review?.role === "admin";

  async function del() {
    if (!review) return;
    try {
      await api.deleteComment(c.id);
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
        <Avatar name={c.author_name} color={c.author_color} src={c.author_id === viewer.user_id ? viewer.avatar_url : avatarOf(c.author_id)} size={22} />
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
                const { comment } = await api.editComment(c.id, body);
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
                {c.attachments.map((a) =>
                  a.kind === "video" ? (
                    <div key={a.id} className="w-full">
                      <video
                        src={a.url}
                        controls
                        playsInline
                        preload="metadata"
                        className="max-h-[220px] w-full rounded-md bg-ink hairline"
                        aria-label={`Screen recording, ${clock(a.duration ?? 0)}`}
                      />
                      <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-ink-3">
                        <span className="num">Recording · {clock(a.duration ?? 0)}</span>
                        <a href={a.url} target="_blank" rel="noreferrer" className="underline decoration-ink-3/50 underline-offset-2 hover:text-ink">
                          Open in a new tab
                        </a>
                      </div>
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={a.id}
                      src={a.url}
                      alt={a.name}
                      onClick={() => setLightbox(a)}
                      className="h-20 max-w-[160px] cursor-zoom-in rounded-md object-cover hairline"
                    />
                  ),
                )}
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
  const viewOnly = useStore((s) => s.viewOnly);
  const upsert = useStore((s) => s.upsertComment);
  const markRead = useStore((s) => s.markRead);
  const markUnread = useStore((s) => s.markUnread);
  const flaggedUnread = useStore((s) => s.readAt[rootId]?.startsWith("!") ?? false);
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
      const { comment } = await api.resolveComment(root.id, !root.resolved);
      upsert(comment);
      toast(comment.resolved ? "Marked as resolved." : "Reopened.", "success");
      if (comment.resolved && !useStore.getState().showResolved) onClose?.();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const canRetitle = !viewOnly && (root.author_id === viewer.user_id || review.role === "admin");

  return (
    <div className={cn("flex max-h-[70vh] flex-col", inPanel ? "" : "w-[340px]")}>
      <TitleRow root={root} editable={canRetitle} />
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
        <ViewportsMenu root={root} editable={canRetitle} />
        <div className="flex-1" />
        <Tip label={flaggedUnread ? "Mark as read" : "Mark as unread (U)"} side="bottom">
          <IconButton
            size="sm"
            aria-label={flaggedUnread ? "Mark as read" : "Mark as unread"}
            aria-pressed={flaggedUnread}
            className={flaggedUnread ? "!text-red" : ""}
            onClick={() => {
              if (flaggedUnread) {
                markRead(root.id);
                toast("Marked as read.", "success");
              } else {
                markUnread(root.id);
                toast("Marked as unread — it stays flagged until you open it again.", "success");
              }
            }}
          >
            {flaggedUnread ? <MailOpen size={14} /> : <Mail size={14} />}
          </IconButton>
        </Tip>
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
          recordTarget={root.id}
          participants={participants}
          onSubmit={async (body, attachments) => {
            const { comment } = await api.createComment(review.id, {
              parent_id: root.id,
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

/**
 * Which viewports the thread belongs on: just the one it was written at, or a
 * band such as "Tablet + Phone" / every size. Author or admin can change it.
 */
function ViewportsMenu({ root, editable }: { root: Comment; editable: boolean }) {
  const upsert = useStore((s) => s.upsertComment);
  const toast = useStore((s) => s.toast);
  const range = viewportRange(root);
  const kinds = range ? kindsInRange(range) : [kindOf(root.viewport_width)];
  const label = viewportLabel(root);

  async function apply(next: ViewportKind[]) {
    const own = kindOf(root.viewport_width);
    const viewports = next.length === 1 && next[0] === own ? null : rangeForKinds(next.length ? next : [own]);
    try {
      const { comment } = await api.setViewports(root.id, viewports);
      upsert(comment);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  if (!editable) {
    return (
      <span className="mono shrink-0 whitespace-nowrap text-[10.5px] text-ink-3" title={range ? `Shown on ${label.toLowerCase()} (written at ${root.viewport_width}px)` : "Viewport this thread belongs to"}>
        · {label}
      </span>
    );
  }
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label="Viewports this thread applies to"
          title="Which viewports this thread is shown on"
          className="press mono shrink-0 whitespace-nowrap rounded px-1 text-[10.5px] text-ink-3 hover:bg-hover hover:text-ink"
        >
          · {label}
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>Show this thread on</MenuLabel>
        {KIND_ORDER.map((k) => (
          <MenuCheckboxItem
            key={k}
            checked={kinds.includes(k)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(on) => apply(on ? [...kinds, k] : kinds.filter((x) => x !== k))}
            className="flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-ink outline-none data-[highlighted]:bg-hover"
          >
            <span className="w-3 text-blue">{kinds.includes(k) ? "•" : ""}</span>
            {KIND_LABEL[k]}
            {k === kindOf(root.viewport_width) && <span className="ml-auto text-[10.5px] text-ink-3">written at {root.viewport_width}</span>}
          </MenuCheckboxItem>
        ))}
        <MenuSeparator />
        <MenuItem onSelect={() => apply(KIND_ORDER)}>
          <span className="w-3" />
          All viewports
        </MenuItem>
        <MenuItem onSelect={() => apply([kindOf(root.viewport_width)])}>
          <span className="w-3" />
          Only {root.viewport_width}px
        </MenuItem>
        <p className="max-w-[220px] px-2 pb-1 pt-1.5 text-[10.5px] leading-snug text-ink-3">The pin follows its element on each size; sizes in between are included.</p>
      </MenuContent>
    </Menu>
  );
}

/**
 * The thread's title — optional, shown bold above the thread and used as the
 * Jira summary. Click to edit (author or admin); blank falls back to the
 * auto-generated summary.
 */
function TitleRow({ root, editable }: { root: Comment; editable: boolean }) {
  const upsert = useStore((s) => s.upsertComment);
  const toast = useStore((s) => s.toast);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(root.title || "");

  async function save() {
    setEditing(false);
    const next = value.trim();
    if (next === (root.title || "")) return;
    try {
      const { comment } = await api.retitleComment(root.id, next);
      upsert(comment);
    } catch (e) {
      setValue(root.title || "");
      toast((e as Error).message, "error");
    }
  }

  if (editing) {
    return (
      <div className="border-b border-line px-3 py-2">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") {
              setValue(root.title || "");
              setEditing(false);
            }
            e.stopPropagation();
          }}
          maxLength={140}
          placeholder="Title (becomes the Jira summary)"
          aria-label="Thread title"
          className="w-full bg-transparent text-[13px] font-semibold text-ink placeholder:font-normal placeholder:text-ink-3 outline-none"
        />
      </div>
    );
  }
  if (!root.title && !editable) return null;
  return (
    <button
      type="button"
      disabled={!editable}
      onClick={() => {
        setValue(root.title || "");
        setEditing(true);
      }}
      title={editable ? "Edit title" : undefined}
      className={cn(
        "group/t flex w-full items-center gap-1.5 border-b border-line px-3 py-2 text-left",
        editable && "hover:bg-hover",
        !root.title && "text-ink-3",
      )}
    >
      <span className={cn("min-w-0 flex-1 truncate text-[13px]", root.title ? "font-semibold text-ink" : "font-normal")}>
        {root.title || "Add a title…"}
      </span>
      {editable && <Pencil size={11} className="shrink-0 text-ink-3 opacity-0 transition-opacity group-hover/t:opacity-100" />}
    </button>
  );
}
