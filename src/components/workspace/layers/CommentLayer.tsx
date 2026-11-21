"use client";

import { useEffect, useMemo, useRef } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { isUnread, useStore, threadRoots, repliesOf } from "@/lib/store";
import { showsAt } from "@/lib/viewports";
import { isDevComment } from "@/lib/figma/dev";
import { devCommentShown } from "@/lib/settings";
import { frame } from "@/lib/frame/controller";
import { api } from "@/lib/api";
import type { Comment } from "@/lib/types";
import { cn, initials } from "@/lib/util";
import { pinBox, pinCentre } from "@/lib/pin";
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
  draggable,
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
  draggable?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
}) {
  // fills the pinBox() it sits in: centred on the anchor, scaling around it
  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onClick={onClick}
      data-pin={draft ? "draft" : label}
      className={cn(
        "pointer-events-auto absolute inset-0 flex touch-none items-center justify-center rounded-full font-bold text-white shadow-pin transition-transform",
        label.length > 2 ? "text-[9.5px] tracking-tight" : "text-[11px]",
        "outline outline-2 outline-white",
        active ? "scale-110" : "hover:scale-110",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        draft && "pin-in",
        detached && "opacity-60 !outline-dashed",
      )}
      style={{ background: color }}
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
  const showDevComments = useStore((s) => s.showDevComments);
  const settings = useStore((s) => s.settings);
  // while a screen recording runs the markup steps aside (it stays mounted so drafts survive)
  const recording = useStore((s) => Boolean(s.recording));
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
    // developer pins follow the panel toggle and the account's category / severity choice; the open thread always stays
    const devShown = (c: Comment) => !isDevComment(c) || c.id === activeThread || (showDevComments && devCommentShown(c.anchor?.dev, settings));
    const roots = threadRoots(comments).filter((c) => showsAt(c, viewport) && (showResolved || !c.resolved || c.id === activeThread) && devShown(c));
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
  }, [comments, viewport, showResolved, activeThread, layoutTick, readAt, viewer.user_id, showDevComments, settings]);

  // scroll to the active thread's pin when it's opened from the panel / permalink
  useEffect(() => {
    if (!activeThread) return;
    const p = placed.find((x) => x.c.id === activeThread);
    if (!p) {
      const c = comments.find((x) => x.id === activeThread);
      if (c && !showsAt(c, viewport)) set({ viewport: c.viewport_width, fitZoom: true });
      return;
    }
    const win = frame().win;
    if (!win) return;
    const visible = p.y > win.scrollY + 40 && p.y < win.scrollY + win.innerHeight - 40;
    if (!visible) frame().scrollToPage(p.y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread]);

  const inv = 1 / geom.zoom;
  // the page's width in page pixels (wider than the viewport when it scrolls sideways)
  const pageWidth = useMemo(() => {
    void layoutTick;
    return Math.max(viewport, frame().doc?.documentElement.scrollWidth ?? 0);
  }, [viewport, layoutTick]);
  /** The box for a pin anchored at (x, y), nudged inside the page at its edges. */
  const boxAt = (x: number, y: number) => {
    const c = pinCentre(x, y, inv, pageWidth);
    return pinBox(c.x, c.y, inv);
  };

  async function submitDraft(body: string, attachments: Comment["attachments"], title: string, viewports?: { min: number; max: number } | null) {
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
          viewports: viewports ?? null,
        },
      });
      upsert(comment);
      set({ draft: null, activeThread: null });
      useStore.getState().markRead(comment.id);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  // Dragging moves your own pins (an admin moves anyone's; developer pins stay
  // where the comparison put them). The pin keeps the spot you grabbed it by
  // under the pointer: it moves by exactly what the pointer moves, never jumps
  // so that its centre snaps to the pointer.
  const canDrag = (c: Comment) => !viewOnly && !isDevComment(c) && (c.author_id === viewer.user_id || review?.role === "admin");

  function onPinDown(p: Placed, e: React.PointerEvent) {
    if (e.button !== 0 || !canDrag(p.c)) return;
    e.stopPropagation();
    // Capture so the drag keeps reporting to us even while the pointer is
    // over the page iframe (browse mode has no overlay above it).
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const session = { id: p.c.id, moved: false };
    dragging.current = session;
    const startX = e.clientX;
    const startY = e.clientY;
    // page coordinates (zoom and scroll accounted for by toPage)
    const grab = geom.toPage(e.clientX, e.clientY);
    // measured from where the pin is drawn, which is not the anchor for a pin nudged in from the page's edge
    const drawn = pinCentre(p.x, p.y, inv, pageWidth);
    const offset = { x: grab.x - drawn.x, y: grab.y - drawn.y };
    const anchorAt = (ev: PointerEvent) => {
      const at = geom.toPage(ev.clientX, ev.clientY);
      return { x: at.x - offset.x, y: at.y - offset.y };
    };
    // a region comment's pin sits on the region's top-right corner; the region travels with it
    const regionAt = (c: Comment | undefined, x: number, y: number) => (c?.anchor?.region ? { ...c.anchor.region, x: x - c.anchor.region.w, y } : null);
    const move = (ev: PointerEvent) => {
      if (dragging.current !== session) return;
      if (!session.moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) <= 5) return;
      session.moved = true;
      const { x, y } = anchorAt(ev);
      // optimistic: nudge the local anchor
      const c = useStore.getState().comments.find((k) => k.id === p.c.id);
      if (c?.anchor) upsert({ ...c, anchor: { ...c.anchor, selector: null, px: x, py: y, region: regionAt(c, x, y) } });
    };
    const up = async (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (dragging.current !== session) return;
      if (!session.moved || !review) {
        dragging.current = null;
        return;
      }
      // the click that follows this pointerup must not open the thread
      setTimeout(() => {
        if (dragging.current === session) dragging.current = null;
      }, 0);
      const { x, y } = anchorAt(ev);
      const c = useStore.getState().comments.find((k) => k.id === p.c.id);
      const region = regionAt(c, x, y);
      const anchor = { ...frame().anchorFor(region ? region.x + region.w / 2 : x, region ? region.y + region.h / 2 : y, region), px: x, py: y, region };
      // drop it exactly where it was released, before the server answers
      if (c?.anchor) upsert({ ...c, anchor: { ...c.anchor, ...anchor } });
      try {
        const { comment } = await api.moveComment(p.c.id, anchor);
        upsert(comment);
      } catch (err) {
        toast((err as Error).message, "error");
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  return (
    <PageLayer className={cn("z-[50]", recording && "invisible")}>
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
            const st = useStore.getState();
            // a recording / upload in flight belongs to this thread's composer — keep it mounted
            if (!o && (st.recording || st.uploading || st.pendingRecording)) return;
            if (!o && st.activeThread === p.c.id) set({ activeThread: null });
          }}
        >
          {/* the pin's box is a stacking context of its own (transform), so it carries the z-order */}
          <PopoverPrimitive.Anchor asChild>
            <div className={cn("absolute", activeThread === p.c.id ? "z-[3]" : "z-[2]")} style={boxAt(p.x, p.y)}>
              <Pin
                color={p.c.resolved ? "#1f9d55" : p.c.author_color}
                label={p.c.resolved ? "✓" : isDevComment(p.c) ? "</>" : initials(p.c.author_name)}
                active={activeThread === p.c.id}
                detached={p.detached}
                unread={p.unread}
                count={p.replies || undefined}
                draggable={canDrag(p.c)}
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
              onInteractOutside={(e) => {
                const st = useStore.getState();
                if (st.recording || st.uploading || st.pendingRecording) e.preventDefault();
              }}
              className={cn("z-[150] rounded-lg bg-panel shadow-pop hairline pop outline-none", recording && "invisible")}
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
            <div className="absolute z-[3]" style={boxAt(draft.px, draft.py)}>
              <Pin color="var(--red)" label="+" draft />
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
              onInteractOutside={(e) => (draft.dirty || useStore.getState().recording) && e.preventDefault()}
              className={cn("z-[150] w-[340px] rounded-lg bg-panel p-2.5 shadow-pop hairline pop outline-none", recording && "invisible")}
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
                recordTarget="draft"
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
