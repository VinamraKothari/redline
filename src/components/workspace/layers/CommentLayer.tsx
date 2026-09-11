"use client";

import { useEffect, useMemo, useRef } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { isUnread, useStore, threadRoots, repliesOf } from "@/lib/store";
import { frame } from "@/lib/frame/controller";
import { api } from "@/lib/api";
import type { Comment } from "@/lib/types";
import { cn, initials } from "@/lib/util";
import { PageLayer } from "./PageLayer";
import { Composer } from "@/components/comments/Composer";
import { Thread, useParticipants } from "@/components/comments/Thread";
import type { StageGeom } from "../Stage";

interface Placed {
  c: Comment;
  x: number;
  y: number;
  detached: boolean;
  unread: boolean;
  replies: number;
}

function Pin({
  color,
  label,
  active,
  detached,
  unread,
  count,
  draft,
  inverse,
  onPointerDown,
  onClick,
}: {
  color: string;
  label: string;
  active?: boolean;
  detached?: boolean;
  unread?: boolean;
  count?: number;
  draft?: boolean;
  inverse?: number; // 1/zoom, so pins stay the same size on screen
  onPointerDown?: (e: React.PointerEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onClick={onClick}
      className={cn(
        "pointer-events-auto absolute flex h-8 w-8 origin-bottom-left -translate-y-full items-center justify-center rounded-[50%_50%_50%_0] text-[11px] font-bold text-white shadow-pin transition-transform",
        "outline outline-2 outline-white",
        active ? "z-[3] scale-110" : "z-[2] hover:scale-110",
        draft && "pin-in",
        detached && "opacity-60 !outline-dashed",
      )}
      style={{ background: color, transform: `scale(${(inverse || 1) * (active ? 1.12 : 1)}) translateY(-100%)` }}
      title={detached ? "This element is no longer on the page — pin shows its last position" : undefined}
    >
      {label}
      {count ? (
        <span className="num absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[9.5px] font-semibold text-white outline outline-2 outline-white">
          {count}
        </span>
      ) : null}
      {unread && !active && <span className="absolute -left-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-red outline outline-2 outline-white" />}
    </button>
  );
}

export function CommentLayer({ geom }: { geom: StageGeom }) {
  const comments = useStore((s) => s.comments);
  const viewport = useStore((s) => s.viewport);
  const showResolved = useStore((s) => s.showResolved);
  const activeThread = useStore((s) => s.activeThread);
  const draft = useStore((s) => s.draft);
  const layoutTick = useStore((s) => s.layoutTick);
  const readAt = useStore((s) => s.readAt);
  const viewer = useStore((s) => s.viewer);
  const review = useStore((s) => s.review);
  const viewOnly = useStore((s) => s.viewOnly);
  const set = useStore((s) => s.set);
  const upsert = useStore((s) => s.upsertComment);
  const toast = useStore((s) => s.toast);
  const participants = useParticipants();
  const dragging = useRef<{ id: string; moved: boolean } | null>(null);

  const placed: Placed[] = useMemo(() => {
    void layoutTick; // re-place pins whenever the page layout changes
    const roots = threadRoots(comments).filter((c) => c.viewport_width === viewport && (showResolved || !c.resolved || c.id === activeThread));
    return roots
      .map((c) => {
        if (!c.anchor) return null;
        const pos = frame().resolveAnchor(c.anchor);
        const replies = repliesOf(comments, c.id);
        const last = [c, ...replies].reduce((m, x) => (x.created_at > m ? x.created_at : m), "");
        const mineLast = [c, ...replies].every((x) => x.author_id === viewer.user_id);
        const unread = isUnread(readAt, c.id, last, !mineLast);
        return { c, x: pos.x, y: pos.y, detached: pos.detached, unread, replies: replies.length };
      })
      .filter(Boolean) as Placed[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments, viewport, showResolved, activeThread, layoutTick, readAt, viewer.user_id]);

  // scroll to the active thread's pin when it's opened from the panel / permalink
  useEffect(() => {
    if (!activeThread) return;
    const p = placed.find((x) => x.c.id === activeThread);
    if (!p) {
      const c = comments.find((x) => x.id === activeThread);
      if (c && c.viewport_width !== viewport) set({ viewport: c.viewport_width, fitZoom: true });
      return;
    }
    const win = frame().win;
    if (!win) return;
    const visible = p.y > win.scrollY + 40 && p.y < win.scrollY + win.innerHeight - 40;
    if (!visible) frame().scrollToPage(p.y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread]);

  const inv = 1 / geom.zoom;

  async function submitDraft(body: string, attachments: Comment["attachments"], title: string) {
    if (!draft || !review) return;
    try {
      const { comment } = await api.createComment(review.id, {
        title: title || null,
        body,
        attachments,
        viewport_width: viewport,
        anchor: {
          selector: draft.selector,
          fx: draft.fx,
          fy: draft.fy,
          px: draft.px,
          py: draft.py,
          region: draft.region,
          element_label: draft.element_label,
        },
      });
      upsert(comment);
      set({ draft: null, activeThread: null });
      useStore.getState().markRead(comment.id);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  // pin dragging (move your own pins)
  function onPinDown(p: Placed, e: React.PointerEvent) {
    if (viewOnly) return;
    if (p.c.author_id !== viewer.user_id && review?.role !== "admin") return;
    e.stopPropagation();
    // Capture so the drag keeps reporting to us even while the pointer is
    // over the page iframe (browse mode has no overlay above it).
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragging.current = { id: p.c.id, moved: false };
    const startX = e.clientX;
    const startY = e.clientY;
    const move = (ev: PointerEvent) => {
      if (!dragging.current) return;
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) dragging.current.moved = true;
      if (!dragging.current.moved) return;
      const { x, y } = geom.toPage(ev.clientX, ev.clientY);
      // optimistic: nudge the local anchor
      const st = useStore.getState();
      const c = st.comments.find((x) => x.id === p.c.id);
      if (c?.anchor) upsert({ ...c, anchor: { ...c.anchor, selector: null, px: x, py: y, region: c.anchor.region ? { ...c.anchor.region, x: x - c.anchor.region.w, y } : null } });
    };
    const up = async (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const d = dragging.current;
      dragging.current = null;
      if (!d?.moved || !review) return;
      const { x, y } = geom.toPage(ev.clientX, ev.clientY);
      const c = useStore.getState().comments.find((k) => k.id === p.c.id);
      const region = c?.anchor?.region ? { ...c.anchor.region, x: x - c.anchor.region.w, y } : null;
      const anchor = frame().anchorFor(region ? region.x + region.w / 2 : x, region ? region.y + region.h / 2 : y, region);
      try {
        const { comment } = await api.moveComment(p.c.id, { ...anchor, px: x, py: y, region });
        upsert(comment);
      } catch (err) {
        toast((err as Error).message, "error");
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <PageLayer className="z-[50]">
      {/* regions */}
      {placed
        .filter((p) => p.c.anchor?.region)
        .map((p) => {
          const r = p.c.anchor!.region!;
          return (
            <div
              key={`r${p.c.id}`}
              className={cn(
                "pointer-events-auto absolute cursor-pointer rounded-sm border-[1.5px] transition-colors",
                p.c.id === activeThread ? "border-red bg-red/10" : "border-red/70 bg-red/[.04] hover:bg-red/10",
                p.c.resolved && "border-green/60",
              )}
              style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
              onClick={(e) => {
                e.stopPropagation();
                set({ activeThread: p.c.id, draft: null });
              }}
            />
          );
        })}
      {draft?.region && (
        <div className="absolute rounded-sm border-[1.5px] border-red bg-red/10" style={{ left: draft.region.x, top: draft.region.y, width: draft.region.w, height: draft.region.h }} />
      )}

      {/* pins */}
      {placed.map((p) => (
        <PopoverPrimitive.Root
          key={p.c.id}
          open={activeThread === p.c.id}
          onOpenChange={(o) => {
            if (!o && useStore.getState().activeThread === p.c.id) set({ activeThread: null });
          }}
        >
          <PopoverPrimitive.Anchor asChild>
            <div className="absolute" style={{ left: p.x, top: p.y, width: 0, height: 0 }}>
              <Pin
                color={p.c.resolved ? "#1f9d55" : p.c.author_color}
                label={p.c.resolved ? "✓" : initials(p.c.author_name)}
                active={activeThread === p.c.id}
                detached={p.detached}
                unread={p.unread}
                count={p.replies || undefined}
                inverse={inv}
                onPointerDown={(e) => onPinDown(p, e)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (dragging.current?.moved) return;
                  set({ activeThread: activeThread === p.c.id ? null : p.c.id, draft: null });
                }}
              />
            </div>
          </PopoverPrimitive.Anchor>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              side="right"
              align="start"
              sideOffset={10}
              collisionPadding={12}
              updatePositionStrategy="always"
              onOpenAutoFocus={(e) => e.preventDefault()}
              onFocusOutside={(e) => e.preventDefault()}
              className="z-[150] rounded-lg bg-panel shadow-pop hairline fade-up outline-none"
            >
              <Thread rootId={p.c.id} onClose={() => set({ activeThread: null })} />
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      ))}

      {/* draft */}
      {draft && !viewOnly && (
        <PopoverPrimitive.Root open onOpenChange={(o) => !o && !draft.dirty && set({ draft: null })}>
          <PopoverPrimitive.Anchor asChild>
            <div className="absolute" style={{ left: draft.px, top: draft.py, width: 0, height: 0 }}>
              <Pin color="var(--red)" label="+" draft inverse={inv} />
            </div>
          </PopoverPrimitive.Anchor>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              side="right"
              align="start"
              sideOffset={10}
              collisionPadding={12}
              updatePositionStrategy="always"
              onFocusOutside={(e) => e.preventDefault()}
              onInteractOutside={(e) => draft.dirty && e.preventDefault()}
              className="z-[150] w-[340px] rounded-lg bg-panel p-2.5 shadow-pop hairline fade-up outline-none"
            >
              {draft.element_label && (
                <div className="mono mb-1.5 truncate px-0.5 text-[10.5px] text-ink-3" title={draft.element_label}>
                  {draft.region ? "region · " : ""}
                  {draft.element_label}
                </div>
              )}
              <Composer
                autoFocus
                withTitle
                participants={participants}
                placeholder="Leave a comment… (@ to mention)"
                onSubmit={submitDraft}
                onCancel={() => set({ draft: null })}
                onDirty={(d) => {
                  const cur = useStore.getState().draft;
                  if (cur && cur.dirty !== d) set({ draft: { ...cur, dirty: d } });
                }}
              />
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      )}
    </PageLayer>
  );
}
