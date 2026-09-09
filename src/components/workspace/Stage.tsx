"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, Minimize2, MessageCircle, MessageCircleOff } from "lucide-react";
import { useStore } from "@/lib/store";
import { frame } from "@/lib/frame/controller";
import { VIEWPORTS } from "@/lib/types";
import { api } from "@/lib/api";
import { cn, hostOf } from "@/lib/util";
import { captureThumbnail, STALE_MS } from "@/lib/thumbnail";
import { RealtimeContext } from "./Workspace";
import { InspectLayer } from "./layers/InspectLayer";
import { CommentLayer } from "./layers/CommentLayer";
import { DrawLayer } from "./layers/DrawLayer";
import { CursorLayer } from "./layers/CursorLayer";
import { CaptureLayer } from "./layers/CaptureLayer";
import { Button, IconButton, Tip } from "@/components/ui/primitives";

/** iframe src for a live page; `scripts=false` asks the proxy for a static render */
export function proxySrc(url: string, scripts: boolean): string {
  return `/api/proxy?url=${encodeURIComponent(url)}${scripts ? "" : "&js=0"}`;
}

export interface StageGeom {
  /** the unscaled stage element (iframe-sized) */
  stage: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  toPage: (clientX: number, clientY: number) => { x: number; y: number };
}

export function Stage() {
  const router = useRouter();
  const review = useStore((s) => s.review);
  const viewport = useStore((s) => s.viewport);
  const zoomStore = useStore((s) => s.zoom);
  const fitZoom = useStore((s) => s.fitZoom);
  const fullscreen = useStore((s) => s.fullscreen);
  const mode = useStore((s) => s.mode);
  const frameReady = useStore((s) => s.frameReady);
  const frameError = useStore((s) => s.frameError);
  const navigatedAway = useStore((s) => s.navigatedAway);
  const showComments = useStore((s) => s.showComments);
  const scripts = useStore((s) => s.scripts);
  const set = useStore((s) => s.set);

  const stageRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [canvas, setCanvas] = useState({ w: 0, h: 0 });
  const [reloadKey, setReloadKey] = useState(0);

  // canvas size — callback ref + ResizeObserver so it works whenever the
  // element mounts (the review arrives after first render)
  const canvasRO = useRef<ResizeObserver | null>(null);
  const canvasRef = useCallback((el: HTMLDivElement | null) => {
    canvasRO.current?.disconnect();
    canvasRO.current = null;
    if (!el) return;
    const ro = new ResizeObserver(() => setCanvas({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    canvasRO.current = ro;
    setCanvas({ w: el.clientWidth, h: el.clientHeight });
  }, []);

  const kind = VIEWPORTS.find((v) => v.width === viewport)?.kind ?? "desktop";
  const bezel = kind === "mobile" && !fullscreen ? 14 : 0;
  const pad = fullscreen ? 0 : 28;

  const fit = canvas.w ? Math.min(1, (canvas.w - pad * 2 - bezel * 2) / viewport) : 1;
  const zoom = fitZoom ? fit : zoomStore;
  const stageH = Math.max(240, Math.round((canvas.h - pad * 2 - bezel * 2) / zoom));

  useEffect(() => {
    if (fitZoom && Math.abs(zoomStore - fit) > 0.0001) set({ zoom: fit });
  }, [fitZoom, fit, zoomStore, set]);

  // iframe wiring — a callback ref, because the iframe mounts only once the
  // review is in the store (an effect keyed on mount would miss it).
  const iframeCb = useCallback(
    (el: HTMLIFrameElement | null) => {
      iframeRef.current = el;
      const f = frame();
      if (!el) {
        f.detach();
        return;
      }
      f.attach(el);
      f.onNavigate = (url, newTab) => {
        if (newTab) {
          window.open(url, "_blank", "noopener");
          return;
        }
        set({ navigatedAway: url, frameReady: false, hover: null, selected: null, measureTarget: null, draft: null });
        el.src = proxySrc(url, useStore.getState().scripts);
      };
      f.onCrashed = (reason) => {
        const st = useStore.getState();
        if (!st.scripts) return; // already static — nothing more to do
        const host = hostOf(st.navigatedAway || st.review?.url || "");
        st.set({ scripts: false, frameReady: false, frameError: null, hover: null, selected: null, measureTarget: null });
        st.toast(
          `${host}'s own scripts crashed inside the reviewer (${reason === "next-error" ? "Next.js error screen" : "page replaced"}) — showing the static render instead.`,
        );
        // The main page reloads through the src prop; an in-frame navigation
        // has to be re-requested explicitly.
        if (st.navigatedAway) el.src = proxySrc(st.navigatedAway, false);
      };
    },
    [set],
  );

  useEffect(() => {
    const reload = () => {
      set({ frameReady: false, frameError: null, navigatedAway: null, hover: null, selected: null, measureTarget: null });
      setReloadKey((k) => k + 1);
    };
    window.addEventListener("redline:reload", reload);
    return () => window.removeEventListener("redline:reload", reload);
  }, [set]);

  // capture a preview for the project page once the page has settled
  useEffect(() => {
    if (!frameReady || !review || navigatedAway) return;
    if (review.role === "view") return;
    const fresh = review.thumbnail_at && Date.now() - new Date(review.thumbnail_at).getTime() < STALE_MS;
    if (review.thumbnail_url && fresh) return;
    const t = window.setTimeout(() => {
      captureThumbnail(review.id, viewport).catch(() => {});
    }, 3500);
    return () => window.clearTimeout(t);
    // only once per page load; viewport changes shouldn't re-capture
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameReady, review?.id, navigatedAway]);

  // set page title into the review after load
  useEffect(() => {
    if (!frameReady || !review || navigatedAway) return;
    const t = frame().doc?.title?.trim();
    if (t && t !== review.title && (review.title === hostOf(review.url) || review.mode === "upload")) {
      api.patchReview(review.id, { title: t }).then(({ review: r }) => set({ review: r })).catch(() => {});
    }
  }, [frameReady, review, navigatedAway, set]);

  // live cursor for other reviewers — from inside the iframe (browse mode,
  // where the page gets the pointer) …
  useEffect(() => {
    if (!frameReady) return;
    const doc = frame().doc;
    const win = frame().win;
    if (!doc || !win) return;
    const move = (e: MouseEvent) => RealtimeContext.current?.track({ cursor: { x: e.clientX + win.scrollX, y: e.clientY + win.scrollY } });
    const leave = () => RealtimeContext.current?.track({ cursor: null });
    doc.addEventListener("mousemove", move);
    doc.addEventListener("mouseleave", leave);
    return () => {
      doc.removeEventListener("mousemove", move);
      doc.removeEventListener("mouseleave", leave);
    };
  }, [frameReady]);
  // … and from the stage itself (comment / draw / inspect modes, where an
  // overlay sits above the page and the iframe never sees the pointer)
  const onStagePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!useStore.getState().frameReady) return;
      const r = stageRef.current?.getBoundingClientRect();
      if (!r) return;
      const sc = useStore.getState().scroll;
      RealtimeContext.current?.track({ cursor: { x: (e.clientX - r.left) / zoom + sc.x, y: (e.clientY - r.top) / zoom + sc.y } });
    },
    [zoom],
  );
  const onStagePointerLeave = useCallback(() => RealtimeContext.current?.track({ cursor: null }), []);

  const toPage = useCallback(
    (clientX: number, clientY: number) => {
      const r = stageRef.current?.getBoundingClientRect();
      const sc = useStore.getState().scroll;
      if (!r) return { x: 0, y: 0 };
      return { x: (clientX - r.left) / zoom + sc.x, y: (clientY - r.top) / zoom + sc.y };
    },
    [zoom],
  );
  const geom: StageGeom = { stage: stageRef, zoom, toPage };

  // wheel: scroll the page / zoom the canvas when an overlay is capturing
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const st = useStore.getState();
        const next = Math.min(3, Math.max(0.2, st.zoom * (e.deltaY < 0 ? 1.08 : 0.92)));
        st.set({ zoom: next, fitZoom: false });
        return;
      }
      if (mode !== "browse") frame().scrollBy(e.deltaX, e.deltaY);
    },
    [mode],
  );

  if (!review) return <div className="flex-1 canvas-grid" />;

  const src = review.mode === "live" ? proxySrc(review.url, scripts) : `/api/snapshot/${review.id}`;

  async function reviewThisPage() {
    if (!navigatedAway) return;
    try {
      if (!review?.project_id) return;
      const { review: r } = await api.createReview({ project_id: review.project_id, url: navigatedAway, viewport });
      router.push(`/r/${r.id}`);
    } catch (e) {
      useStore.getState().toast((e as Error).message, "error");
    }
  }

  return (
    <div
      ref={canvasRef}
      className={cn("relative flex min-w-0 flex-1 items-start justify-center overflow-auto", fullscreen ? "bg-canvas" : "canvas-grid")}
      style={{ padding: pad }}
      onWheelCapture={onWheel}
      onPointerMove={onStagePointerMove}
      onPointerLeave={onStagePointerLeave}
    >
      {/* device bezel */}
      <div
        className={cn("relative shrink-0", bezel > 0 && "rounded-[38px] bg-ink shadow-[0_20px_60px_-20px_rgba(0,0,0,.5)]")}
        style={{ padding: bezel, width: viewport * zoom + bezel * 2, height: stageH * zoom + bezel * 2 }}
      >
        <div
          className={cn("relative overflow-hidden bg-white", bezel ? "rounded-[26px]" : "shadow-[0_1px_0_rgba(0,0,0,.04),0_12px_40px_-12px_rgba(28,27,24,.25)]")}
          style={{ width: viewport * zoom, height: stageH * zoom }}
        >
          {/* unscaled stage */}
          <div
            ref={stageRef}
            className="absolute left-0 top-0 origin-top-left"
            style={{ width: viewport, height: stageH, transform: `scale(${zoom})` }}
          >
            <iframe
              key={reloadKey}
              ref={iframeCb}
              title="Page under review"
              src={src}
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-pointer-lock"
              className="block h-full w-full border-0 bg-white"
              style={{ width: viewport, height: stageH }}
            />

            {/* overlays, in page coordinates */}
            {frameReady && !navigatedAway && (
              <>
                {/* "hide markup" hides drawings too — unless you're drawing right now */}
                {(showComments || mode === "draw") && <DrawLayer geom={geom} />}
                <InspectLayer />
                {showComments && <CommentLayer geom={geom} />}
                <CursorLayer />
                <CaptureLayer geom={geom} />
              </>
            )}

            {!frameReady && !frameError && (
              <div className="pointer-events-none absolute inset-0 bg-white">
                <div className="absolute inset-x-0 top-0 h-[3px] overflow-hidden">
                  <div className="h-full w-1/3 animate-[loading_1.1s_ease-in-out_infinite] bg-red" />
                </div>
                <style>{`@keyframes loading{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}`}</style>
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[13px] text-ink-3">
                  Loading {navigatedAway ? hostOf(navigatedAway) : hostOf(review.url)}…
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* banners (stacked so they never overlap) */}
      {(navigatedAway || frameError) && (
        <div className="fixed left-1/2 top-16 z-30 flex -translate-x-1/2 flex-col items-center gap-2">
          {navigatedAway && (
            <div className="flex items-center gap-2 rounded-lg bg-ink px-3 py-2 text-[12.5px] text-white shadow-pop fade-up">
              <span className="max-w-[320px] truncate">
                You&apos;ve left the reviewed page — now on <span className="mono">{hostOf(navigatedAway)}</span>. Comments are hidden.
              </span>
              <Button size="sm" variant="ghost" className="!text-white hover:!bg-white/10" onClick={() => window.dispatchEvent(new CustomEvent("redline:reload"))}>
                <ArrowLeft size={13} /> Back
              </Button>
              <Button size="sm" variant="secondary" onClick={reviewThisPage}>
                <ExternalLink size={13} /> Review this page
              </Button>
            </div>
          )}
          {frameError && (
            <div className="flex items-center gap-3 rounded-lg bg-panel px-3 py-2 text-[12.5px] text-ink shadow-pop hairline fade-up">
              <span className="h-2 w-2 rounded-full bg-red" />
              {frameError}
              <Button size="sm" onClick={() => window.dispatchEvent(new CustomEvent("redline:reload"))}>
                Retry
              </Button>
            </div>
          )}
        </div>
      )}

      {/* full-screen controls */}
      {fullscreen && (
        <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full bg-ink/90 p-1 text-white shadow-pop backdrop-blur">
          <Tip label={showComments ? "Hide comments & drawings" : "Show comments & drawings"} kbd="⇧C" side="top">
            <IconButton className="!text-white hover:!bg-white/10" onClick={() => set({ showComments: !showComments })}>
              {showComments ? <MessageCircle size={15} /> : <MessageCircleOff size={15} />}
            </IconButton>
          </Tip>
          <span className="mono px-1 text-[11px] text-white/60">{viewport} · {Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => set({ fullscreen: false })}
            className="flex h-8 items-center gap-1.5 rounded-full bg-white px-3 text-[12px] font-medium text-ink hover:bg-paper"
          >
            <Minimize2 size={13} /> Exit <span className="kbd !py-0.5">Esc</span>
          </button>
        </div>
      )}
    </div>
  );
}
