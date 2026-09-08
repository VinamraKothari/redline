"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import type { PublicReview } from "@/lib/review";
import { startRealtime, type RealtimeHandle } from "@/lib/realtime";
import { loadReadState, useStore } from "@/lib/store";
import { rememberRecent } from "@/components/home/Home";
import { TooltipProvider } from "@/components/ui/primitives";
import { TopBar } from "./TopBar";
import { LeftRail } from "./LeftRail";
import { Stage } from "./Stage";
import { RightPanel } from "./panels/RightPanel";
import { DrawToolbar } from "./DrawToolbar";
import { Toasts } from "./Toasts";
import { NamePrompt } from "./NamePrompt";
import { useShortcuts } from "@/lib/hooks/useShortcuts";
import { cn } from "@/lib/util";

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
    rememberRecent({ id: initial.id, url: initial.url, title: initial.title, at: initial.created_at });
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

  return (
    <TooltipProvider>
      <div className={cn("flex h-full flex-col overflow-hidden bg-paper", fullscreen && "bg-canvas")}>
        {!fullscreen && <TopBar />}
        <div className="relative flex min-h-0 flex-1">
          {!fullscreen && <LeftRail />}
          <Stage />
          {!fullscreen && panel && <RightPanel />}
        </div>
        {mode === "draw" && !fullscreen && <DrawToolbar />}
        <Toasts />
        <NamePrompt />
      </div>
    </TooltipProvider>
  );
}
