"use client";

import { useEffect, useMemo, useState } from "react";
import { Camera, ChevronDown, Code2, Maximize2, Minus, Monitor, Plus, Share2, Smartphone, Snowflake, Sun, Tablet, RotateCw } from "lucide-react";
import { Logo } from "@/components/Logo";
import { AccountMenu } from "@/components/home/AccountMenu";
import { Avatar, IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Tip, Button } from "@/components/ui/primitives";
import { useStore } from "@/lib/store";
import { VIEWPORTS } from "@/lib/types";
import { api } from "@/lib/api";
import { frame } from "@/lib/frame/controller";
import { serializeDocument } from "@/lib/frame/dom";
import { hostOf, cn } from "@/lib/util";
import { ShareDialog } from "./ShareDialog";
import { CaptureStateDialog } from "./CaptureStateDialog";
import { PageSwitcher } from "./PageSwitcher";
import { RealtimeContext } from "./Workspace";

const KIND_ICON = { desktop: Monitor, tablet: Tablet, mobile: Smartphone } as const;

export function TopBar() {
  const review = useStore((s) => s.review);
  const viewport = useStore((s) => s.viewport);
  const zoom = useStore((s) => s.zoom);
  const fitZoom = useStore((s) => s.fitZoom);
  const viewers = useStore((s) => s.viewers);
  const viewer = useStore((s) => s.viewer);
  const viewOnly = useStore((s) => s.viewOnly);
  const scripts = useStore((s) => s.scripts);
  const set = useStore((s) => s.set);
  const [share, setShare] = useState(false);
  const [captureState, setCaptureState] = useState(false);
  const [freezing, setFreezing] = useState(false);

  const vp = VIEWPORTS.find((v) => v.width === viewport);
  const VpIcon = vp ? KIND_ICON[vp.kind] : Monitor;
  const others = useMemo(() => {
    const seen = new Set<string>();
    return viewers.filter((v) => {
      const id = v.user_id || v.key;
      if (id === viewer.user_id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [viewers, viewer.user_id]);

  // keyboard shortcuts dispatch these (see useShortcuts)
  useEffect(() => {
    const share = () => setShare((o) => !o);
    const capture = () => setCaptureState((o) => !o);
    const freeze = () => void toggleFreeze();
    const scriptsToggle = () => {
      const st = useStore.getState();
      if (st.review?.mode !== "live") return;
      st.set({ scripts: !st.scripts, frameReady: false, frameError: null, navigatedAway: null, hover: null, selected: null, measureTarget: null });
    };
    window.addEventListener("redline:share", share);
    window.addEventListener("redline:capture-state", capture);
    window.addEventListener("redline:freeze", freeze);
    window.addEventListener("redline:scripts", scriptsToggle);
    return () => {
      window.removeEventListener("redline:share", share);
      window.removeEventListener("redline:capture-state", capture);
      window.removeEventListener("redline:freeze", freeze);
      window.removeEventListener("redline:scripts", scriptsToggle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review?.id, review?.mode]);

  async function toggleFreeze() {
    if (!review) return;
    const st = useStore.getState();
    if (review.mode === "frozen") {
      try {
        const { review: r } = await api.patchReview(review.id, { mode: "live" });
        set({ review: r });
        RealtimeContext.current?.announceReview();
        st.toast("Back to the live page.", "success");
      } catch (e) {
        st.toast((e as Error).message, "error");
      }
      return;
    }
    const doc = frame().doc;
    if (!doc) return st.toast("The page hasn't loaded yet.", "error");
    setFreezing(true);
    try {
      st.toast("Capturing the page…");
      await frame().warmUp();
      const html = serializeDocument(doc, review.url);
      const { review: r } = await api.freeze(review.id, html);
      set({ review: r });
      RealtimeContext.current?.announceReview();
      st.toast("Frozen. Everyone now sees this exact version.", "success");
    } catch (e) {
      st.toast((e as Error).message, "error");
    } finally {
      setFreezing(false);
    }
  }

  return (
    <header className="relative z-20 flex h-12 shrink-0 items-center gap-2 border-b border-line bg-paper px-3">
      <Logo compact />
      <div className="mx-1 h-5 w-px bg-line" />

      {/* title + url */}
      <div className="flex min-w-0 items-center gap-2">
        <PageSwitcher />
        {review && !review.url.startsWith("upload://") && (
          <a
            href={review.url}
            target="_blank"
            rel="noreferrer"
            className="hidden truncate text-[12px] text-ink-3 hover:text-ink md:inline"
            title={review.url}
          >
            {hostOf(review.url)}
          </a>
        )}
        {review?.mode === "frozen" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-soft px-2 py-0.5 text-[11px] font-medium text-blue">
            <Snowflake size={11} /> Frozen
          </span>
        )}
        {review?.mode === "upload" && (
          <span className="rounded-full bg-hover px-2 py-0.5 text-[11px] font-medium text-ink-2">Uploaded file</span>
        )}
      </div>

      <div className="flex-1" />

      {/* viewport */}
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium text-ink hover:bg-hover"
            title="Viewport width"
          >
            <VpIcon size={14} className="text-ink-2" />
            <span className="mono">{viewport}</span>
            <ChevronDown size={13} className="text-ink-3" />
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuLabel>Viewport</MenuLabel>
          {VIEWPORTS.map((v) => {
            const I = KIND_ICON[v.kind];
            return (
              <MenuItem key={v.width} onSelect={() => set({ viewport: v.width, fitZoom: true, selected: null, hover: null, measureTarget: null })}>
                <I size={13} className="text-ink-2" />
                <span className="flex-1">{v.label.split(" · ")[0]}</span>
                <span className={cn("mono text-[11.5px]", v.width === viewport ? "text-ink" : "text-ink-3")}>{v.width}</span>
              </MenuItem>
            );
          })}
        </MenuContent>
      </Menu>

      {/* zoom */}
      <div className="hidden h-8 items-center rounded-md bg-hover/70 px-0.5 sm:flex">
        <Tip label="Zoom out" kbd="⌘−" side="bottom">
          <IconButton size="sm" onClick={() => set({ zoom: Math.max(0.2, zoom / 1.2), fitZoom: false })}>
            <Minus size={13} />
          </IconButton>
        </Tip>
        <button
          type="button"
          onClick={() => set({ fitZoom: !fitZoom, zoom: fitZoom ? 1 : zoom })}
          className="mono w-12 text-center text-[11.5px] text-ink-2 hover:text-ink"
          title={fitZoom ? "Fit to canvas (click for 100%)" : "Click to fit"}
        >
          {Math.round(zoom * 100)}%
        </button>
        <Tip label="Zoom in" kbd="⌘+" side="bottom">
          <IconButton size="sm" onClick={() => set({ zoom: Math.min(3, zoom * 1.2), fitZoom: false })}>
            <Plus size={13} />
          </IconButton>
        </Tip>
      </div>

      <Tip label="Reload page" kbd="R" side="bottom">
        <IconButton onClick={() => window.dispatchEvent(new CustomEvent("redline:reload"))}>
          <RotateCw size={15} />
        </IconButton>
      </Tip>

      {review?.mode === "live" && (
        <Tip
          label={scripts ? "Site scripts: on — click for a static render (server HTML + CSS only)" : "Site scripts: off (static render) — click to run the page's JavaScript"}
          kbd="⇧J"
          side="bottom"
        >
          <IconButton
            active={!scripts}
            aria-label={scripts ? "Site scripts: on" : "Site scripts: off"}
            onClick={() => {
              set({ scripts: !scripts, frameReady: false, frameError: null, navigatedAway: null, hover: null, selected: null, measureTarget: null });
            }}
          >
            <Code2 size={15} />
          </IconButton>
        </Tip>
      )}

      {/* presence — other people (one avatar per account, however many tabs they have open) */}
      {others.length > 0 && (
        <div className="ml-1 flex items-center -space-x-1.5">
          {others.slice(0, 5).map((v) => (
            <Avatar key={v.user_id || v.key} name={v.name} color={v.color} src={v.avatar_url} size={24} className="ring-2 ring-paper" />
          ))}
          {others.length > 5 && <span className="pl-2 text-[11px] text-ink-3">+{others.length - 5}</span>}
        </div>
      )}

      <div className="mx-1 h-5 w-px bg-line" />

      {!viewOnly && review && review.mode !== "upload" && (
        <Tip label={review.mode === "frozen" ? "Unfreeze — go back to the live page" : "Freeze — capture this exact version for everyone"} kbd="⇧F" side="bottom">
          <IconButton onClick={toggleFreeze} disabled={freezing} active={review.mode === "frozen"}>
            {review.mode === "frozen" ? <Sun size={15} /> : <Snowflake size={15} />}
          </IconButton>
        </Tip>
      )}

      {!viewOnly && review && (
        <Tip label="Save this state as a new page — open drawer, dialog or locked menu, kept for everyone" kbd="⇧P" side="bottom">
          <IconButton onClick={() => setCaptureState(true)} aria-label="Save this state as a new page">
            <Camera size={15} />
          </IconButton>
        </Tip>
      )}

      <Tip label="Full screen preview" kbd="F" side="bottom">
        <IconButton onClick={() => set({ fullscreen: true })}>
          <Maximize2 size={15} />
        </IconButton>
      </Tip>

      <Tip label="Share & export" kbd="⇧S" side="bottom">
        <Button variant="primary" onClick={() => setShare(true)} className="ml-1">
          <Share2 size={13} /> Share
        </Button>
      </Tip>
      <ShareDialog open={share} onOpenChange={setShare} />
      <CaptureStateDialog open={captureState} onOpenChange={setCaptureState} />
      <div className="ml-1">
        <AccountMenu size={26} />
      </div>
    </header>
  );
}
