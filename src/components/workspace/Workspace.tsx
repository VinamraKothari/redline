"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import type { PublicReview } from "@/lib/review";
import { startRealtime, type RealtimeHandle } from "@/lib/realtime";
import { loadReadState, mergeReads, useStore } from "@/lib/store";
import { TooltipProvider } from "@/components/ui/primitives";
import { TopBar } from "./TopBar";
import { LeftRail } from "./LeftRail";
import { Stage } from "./Stage";
import { RightPanel } from "./panels/RightPanel";
import { DrawToolbar } from "./DrawToolbar";
import { Toasts } from "./Toasts";
import { useMe } from "@/components/home/AccountMenu";
import { useShortcuts } from "@/lib/hooks/useShortcuts";
import { cn } from "@/lib/util";
import { PanelRightOpen } from "lucide-react";
import { IconButton, Tip } from "@/components/ui/primitives";

export const RealtimeContext = { current: null as RealtimeHandle | null };

export function Workspace({
  initial,
  viewOnly,
  focusComment,
}: {
  initial: PublicReview;
  viewOnly: boolean;
  focusComment: string | null;
}) {
  const set = useStore((s) => s.set);
  const fullscreen = useStore((s) => s.fullscreen);
  const mode = useStore((s) => s.mode);
  const panel = useStore((s) => s.panel);
  const loaded = useRef(false);

  // initial state
  useEffect(() => {
    set({
      review: initial,
      viewOnly,
      viewport: initial.default_viewport,
      readAt: loadReadState(initial.id),
      mode: viewOnly ? "browse" : "comment",
      panel: "comments",
      activeThread: focusComment,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.id]);

  // full load (with owner key) + realtime
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    let handle: RealtimeHandle | null = null;
    (async () => {
      try {
        const data = await api.loadReview(initial.id);
        set({ review: data.review, comments: data.comments, shapes: data.shapes });
        // read state from other devices (best effort)
        api.getReads(initial.id).then(({ reads }) => mergeReads(reads)).catch(() => {});
      } catch (e) {
        useStore.getState().toast((e as Error).message, "error");
      }
      handle = startRealtime(initial.id);
      RealtimeContext.current = handle;
    })();
    return () => {
      handle?.stop();
      RealtimeContext.current = null;
    };
  }, [initial.id, set]);

  useShortcuts();
  useMe();

  // keep presence in sync once the profile arrives (or changes)
  useEffect(() => {
    let prev = useStore.getState().viewer;
    return useStore.subscribe((s) => {
      if (s.viewer.user_id !== prev.user_id || s.viewer.name !== prev.name || s.viewer.color !== prev.color) {
        prev = s.viewer;
        RealtimeContext.current?.track({ user_id: s.viewer.user_id, name: s.viewer.name, color: s.viewer.color, avatar_url: s.viewer.avatar_url });
      }
    });
  }, []);

  return (
    <TooltipProvider>
      <div className={cn("flex h-full flex-col overflow-hidden bg-paper", fullscreen && "bg-canvas")}>
        {!fullscreen && <TopBar />}
        <div className="relative flex min-h-0 flex-1">
          {!fullscreen && <LeftRail />}
          <Stage />
          {!fullscreen && panel && <RightPanel />}
          {!fullscreen && !panel && (
            <div className="absolute right-3 top-3 z-30">
              <Tip label="Show panel" side="left">
                <IconButton className="bg-panel shadow-pop hairline" onClick={() => set({ panel: mode === "inspect" ? "inspect" : "comments" })}>
                  <PanelRightOpen size={15} />
                </IconButton>
              </Tip>
            </div>
          )}
        </div>
        {mode === "draw" && !fullscreen && <DrawToolbar />}
        <Toasts />
      </div>
    </TooltipProvider>
  );
}
