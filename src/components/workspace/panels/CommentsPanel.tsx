"use client";

import { useMemo, useState } from "react";
import { ArrowDownUp, Check, ChevronDown, ChevronRight, Download, Filter, Image as ImageIcon, MessageSquare, Monitor, Smartphone, Tablet, Unlink } from "lucide-react";
import { Avatar, Button, IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuTrigger, Tip } from "@/components/ui/primitives";
import { repliesOf, threadRoots, useStore, type CommentFilter, type CommentSort } from "@/lib/store";
import { frame } from "@/lib/frame/controller";
import { mentionsIn, plainText } from "@/components/comments/CommentBody";
import type { Comment } from "@/lib/types";
import { cn, timeAgo } from "@/lib/util";
import { toJiraCsv } from "@/lib/export";

function VpIcon({ w }: { w: number }) {
  const I = w >= 1200 ? Monitor : w >= 700 ? Tablet : Smartphone;
  return <I size={11} />;
}

function Tile({ c, active, unread, replies, onClick }: { c: Comment; active: boolean; unread: boolean; replies: number; onClick: () => void }) {
  const text = plainText(c.body).trim();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors",
        active ? "bg-panel shadow-pop hairline" : "hover:bg-hover",
      )}
    >
      <div className="flex items-center gap-2">
        <Avatar name={c.author_name} color={c.resolved ? "#1f9d55" : c.author_color} size={18} />
        <span className="truncate text-[12px] font-semibold text-ink">{c.author_name}</span>
        <span className="text-[11px] text-ink-3">{timeAgo(c.created_at)}</span>
        <div className="flex-1" />
        {unread && <span className="h-2 w-2 rounded-full bg-red" />}
        {c.resolved && <Check size={13} className="text-green" />}
      </div>
      {c.title && <div className="truncate text-[12.5px] font-semibold text-ink">{c.title}</div>}
      <div className={cn(c.title ? "line-clamp-1" : "line-clamp-2", "text-[12.5px] leading-[1.4]", c.resolved ? "text-ink-2" : "text-ink")}>
        {text || (c.attachments?.length ? <span className="inline-flex items-center gap-1 text-ink-3"><ImageIcon size={12} /> Image</span> : <span className="text-ink-3">(empty)</span>)}
      </div>
      <div className="flex items-center gap-2 text-[10.5px] text-ink-3">
        <span className="mono inline-flex items-center gap-1"><VpIcon w={c.viewport_width} /> {c.viewport_width}</span>
        {c.anchor?.element_label ? (
          <span className="mono truncate" title={c.anchor.element_label}>{c.anchor.element_label.split(" › ").pop()}</span>
        ) : (
          <span className="inline-flex items-center gap-1"><Unlink size={10} /> loose</span>
        )}
        {replies > 0 && <span className="inline-flex items-center gap-1"><MessageSquare size={10} /> {replies}</span>}
        {c.attachments?.length > 0 && <span className="inline-flex items-center gap-1"><ImageIcon size={10} /> {c.attachments.length}</span>}
      </div>
    </button>
  );
}

export function CommentsPanel() {
  const comments = useStore((s) => s.comments);
  const viewer = useStore((s) => s.viewer);
  const review = useStore((s) => s.review);
  const activeThread = useStore((s) => s.activeThread);
  const readAt = useStore((s) => s.readAt);
  const filter = useStore((s) => s.commentFilter);
  const sort = useStore((s) => s.commentSort);
  const viewport = useStore((s) => s.viewport);
  const showResolved = useStore((s) => s.showResolved);
  const set = useStore((s) => s.set);
  const [openResolved, setOpenResolved] = useState(true);
  const [onlyViewport, setOnlyViewport] = useState(false);

  const threads = useMemo(() => {
    const roots = threadRoots(comments)
      .filter((c) => !onlyViewport || c.viewport_width === viewport)
      .map((c) => {
        const replies = repliesOf(comments, c.id);
        const all = [c, ...replies];
        const last = all.reduce((m, x) => (x.created_at > m ? x.created_at : m), "");
        const others = all.some((x) => x.author_id !== viewer.user_id);
        const unread = others && (!readAt[c.id] || readAt[c.id] < last);
        const mentionsMe = Boolean(viewer.name) && all.some((x) => mentionsIn(x.body).includes(viewer.name));
        return { c, replies: replies.length, last, unread, mentionsMe, mine: all.some((x) => x.author_id === viewer.user_id) };
      })
      .filter((t) => (filter === "mine" ? t.mine : filter === "mentions" ? t.mentionsMe : true));
    const cmp = (a: (typeof roots)[number], b: (typeof roots)[number]) =>
      sort === "oldest" ? a.c.created_at.localeCompare(b.c.created_at) : sort === "unread" ? Number(b.unread) - Number(a.unread) || b.last.localeCompare(a.last) : b.last.localeCompare(a.last);
    return roots.sort(cmp);
  }, [comments, viewer.name, viewer.user_id, readAt, filter, sort, onlyViewport, viewport]);

  const pending = threads.filter((t) => !t.c.resolved);
  const resolved = threads.filter((t) => t.c.resolved);
  const unreadCount = threads.filter((t) => t.unread).length;

  function open(c: Comment) {
    set({ activeThread: c.id, draft: null, viewport: c.viewport_width, showResolved: c.resolved ? true : useStore.getState().showResolved });
    if (c.anchor) {
      const pos = frame().resolveAnchor(c.anchor);
      frame().scrollToPage(pos.y);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* toolbar */}
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <Menu>
          <MenuTrigger asChild>
            <button type="button" className={cn("flex h-7 items-center gap-1 rounded-md px-2 text-[12px] hover:bg-hover", filter !== "all" && "bg-active font-medium")}>
              <Filter size={12} />
              {filter === "all" ? "All" : filter === "mine" ? "Mine" : "Mentions"}
              <ChevronDown size={12} className="text-ink-3" />
            </button>
          </MenuTrigger>
          <MenuContent align="start">
            <MenuLabel>Show</MenuLabel>
            <MenuRadioGroup value={filter} onValueChange={(v) => set({ commentFilter: v as CommentFilter })}>
              {(["all", "mine", "mentions"] as const).map((v) => (
                <MenuRadioItem key={v} value={v} className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] outline-none data-[highlighted]:bg-hover">
                  <span className="w-3 text-blue">{filter === v ? "•" : ""}</span>
                  {v === "all" ? "All comments" : v === "mine" ? "My threads" : "Mentions me"}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
            <MenuLabel>Viewport</MenuLabel>
            <MenuItem onSelect={() => setOnlyViewport((v) => !v)}>
              <span className="w-3 text-blue">{onlyViewport ? "•" : ""}</span> Only current ({viewport}px)
            </MenuItem>
          </MenuContent>
        </Menu>
        <Menu>
          <MenuTrigger asChild>
            <button type="button" className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] hover:bg-hover">
              <ArrowDownUp size={12} />
              {sort === "newest" ? "Newest" : sort === "oldest" ? "Oldest" : "Unread first"}
            </button>
          </MenuTrigger>
          <MenuContent align="start">
            <MenuRadioGroup value={sort} onValueChange={(v) => set({ commentSort: v as CommentSort })}>
              {(["newest", "oldest", "unread"] as const).map((v) => (
                <MenuRadioItem key={v} value={v} className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] outline-none data-[highlighted]:bg-hover">
                  <span className="w-3 text-blue">{sort === v ? "•" : ""}</span>
                  {v === "newest" ? "Newest activity" : v === "oldest" ? "Oldest first" : "Unread first"}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
        <div className="flex-1" />
        {review && (
          <Tip label="Download Jira CSV" side="bottom">
            <IconButton
              size="sm"
              disabled={!threads.length}
              onClick={() => {
                const csv = toJiraCsv(review, comments, location.origin);
                const a = document.createElement("a");
                a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
                a.download = `${review.title.replace(/[^\w.-]+/g, "-").slice(0, 60)}-jira.csv`;
                a.click();
              }}
            >
              <Download size={14} />
            </IconButton>
          </Tip>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {threads.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <MessageSquare size={22} className="text-ink-3" />
            <p className="text-[12.5px] text-ink-2">
              {comments.length === 0 ? "No comments yet." : "Nothing matches this filter."}
            </p>
            {comments.length === 0 && (
              <p className="text-[11.5px] leading-relaxed text-ink-3">
                Press <span className="kbd">C</span> and click anywhere on the page to leave one. Drag to comment on an area.
              </p>
            )}
          </div>
        ) : (
          <>
            <SectionHeader label="Pending" count={pending.length} extra={unreadCount ? `${unreadCount} unread` : undefined} />
            {pending.length === 0 && <p className="px-2.5 py-2 text-[12px] text-ink-3">All caught up.</p>}
            <div className="flex flex-col gap-0.5">
              {pending.map((t) => (
                <Tile key={t.c.id} c={t.c} active={activeThread === t.c.id} unread={t.unread} replies={t.replies} onClick={() => open(t.c)} />
              ))}
            </div>
            {resolved.length > 0 && (
              <>
                <button type="button" onClick={() => setOpenResolved((v) => !v)} className="mt-3 flex w-full items-center">
                  <SectionHeader label="Resolved" count={resolved.length} chevron={openResolved ? <ChevronDown size={12} /> : <ChevronRight size={12} />} />
                </button>
                {openResolved && (
                  <div className="flex flex-col gap-0.5 opacity-80">
                    {resolved.map((t) => (
                      <Tile key={t.c.id} c={t.c} active={activeThread === t.c.id} unread={t.unread} replies={t.replies} onClick={() => open(t.c)} />
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-3 py-1.5 text-[11px] text-ink-3">
        <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap">
          <input type="checkbox" className="accent-ink" checked={showResolved} onChange={(e) => set({ showResolved: e.target.checked })} />
          Resolved pins on canvas
        </label>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => set({ mode: "comment" })}>
          + Comment <span className="kbd ml-1">C</span>
        </Button>
      </div>
    </div>
  );
}

function SectionHeader({ label, count, extra, chevron }: { label: string; count: number; extra?: string; chevron?: React.ReactNode }) {
  return (
    <div className="flex w-full items-center gap-1.5 px-2.5 pb-1.5 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-3">
      {chevron}
      {label}
      <span className="num rounded-full bg-hover px-1.5 py-px text-[10px] normal-case tracking-normal text-ink-2">{count}</span>
      {extra && <span className="ml-auto text-red normal-case tracking-normal">{extra}</span>}
    </div>
  );
}
