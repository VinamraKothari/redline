"use client";

import { useEffect, useMemo, useState } from "react";
import { Camera, ChevronDown, Code2, GitCompareArrows, KeyRound, LogOut, Maximize2, Minus, Monitor, Plus, Share2, Smartphone, Snowflake, Sun, Tablet, RotateCw } from "lucide-react";
import { Logo } from "@/components/Logo";
import { AccountMenu } from "@/components/home/AccountMenu";
import { Avatar, IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Segmented, Tip, Button } from "@/components/ui/primitives";
import { useStore, type TextView } from "@/lib/store";
import { withOriginal } from "@/lib/text-edits/sync";
import { VIEWPORTS } from "@/lib/types";
import { api } from "@/lib/api";
import { frame } from "@/lib/frame/controller";
import { serializeDocument } from "@/lib/frame/dom";
import { forgetSiteSession, useSiteSessionSync } from "@/lib/site-session";
import { hostOf, cn } from "@/lib/util";
import { ShareDialog } from "./ShareDialog";
import { CaptureStateDialog } from "./CaptureStateDialog";
import { FigmaCompareDialog } from "./FigmaCompareDialog";
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
  const [figmaOpen, setFigmaOpen] = useState(false);
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
    const figma = () => setFigmaOpen((o) => !o);
    const freeze = () => void toggleFreeze();
    const scriptsToggle = () => {
      const st = useStore.getState();
      if (st.review?.mode !== "live") return;
      st.set({ scripts: !st.scripts, frameReady: false, frameError: null, navigatedAway: null, hover: null, selected: null, measureTarget: null });
    };
    window.addEventListener("redline:share", share);
    window.addEventListener("redline:capture-state", capture);
    window.addEventListener("redline:figma", figma);
    window.addEventListener("redline:freeze", freeze);
    window.addEventListener("redline:scripts", scriptsToggle);
    return () => {
      window.removeEventListener("redline:share", share);
      window.removeEventListener("redline:capture-state", capture);
      window.removeEventListener("redline:figma", figma);
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
      // copy edits stay in Redline: the frozen page is the site's own copy
      const html = withOriginal(() => serializeDocument(doc, review.url));
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
      <div className="mx-1 h-5 w-px bg-line max-sm:hidden" />

      {/* title + url (on a phone the title keeps some room before the controls) */}
      <div className="flex min-w-0 items-center gap-2 max-sm:min-w-[84px] max-sm:shrink">
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
        {review?.mode === "live" && <SiteLogin />}
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

      <TextViewSwitch />

      {/* viewport */}
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium text-ink hover:bg-hover"
            title="Viewport width"
          >
            <VpIcon size={14} className="text-ink-2" />
            <span className="mono max-sm:hidden">{viewport}</span>
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
        <IconButton className="max-sm:hidden" onClick={() => window.dispatchEvent(new CustomEvent("redline:reload"))}>
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
            className="max-sm:hidden"
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

      <div className="mx-1 h-5 w-px bg-line max-sm:hidden" />

      {!viewOnly && review && review.mode !== "upload" && (
        <Tip label={review.mode === "frozen" ? "Unfreeze — go back to the live page" : "Freeze — capture this exact version for everyone"} kbd="⇧F" side="bottom">
          <IconButton className="max-sm:hidden" onClick={toggleFreeze} disabled={freezing} active={review.mode === "frozen"}>
            {review.mode === "frozen" ? <Sun size={15} /> : <Snowflake size={15} />}
          </IconButton>
        </Tip>
      )}

      {!viewOnly && review && (
        <Tip label="Compare with Figma — every difference becomes a developer comment" kbd="⇧G" side="bottom">
          <IconButton className="max-sm:hidden" onClick={() => setFigmaOpen(true)} aria-label="Compare with Figma">
            <GitCompareArrows size={15} />
          </IconButton>
        </Tip>
      )}

      {!viewOnly && review && (
        <Tip label="Save this state as a new page — open drawer, dialog or locked menu, kept for everyone" kbd="⇧P" side="bottom">
          <IconButton className="max-sm:hidden" onClick={() => setCaptureState(true)} aria-label="Save this state as a new page">
            <Camera size={15} />
          </IconButton>
        </Tip>
      )}

      <Tip label="Full screen preview" kbd="F" side="bottom">
        <IconButton className="max-sm:hidden" onClick={() => set({ fullscreen: true })}>
          <Maximize2 size={15} />
        </IconButton>
      </Tip>

      <Tip label="Share & export" kbd="⇧S" side="bottom">
        <Button variant="primary" onClick={() => setShare(true)} className="ml-1 max-sm:px-2" aria-label="Share">
          <Share2 size={13} /> <span className="max-sm:hidden">Share</span>
        </Button>
      </Tip>
      <ShareDialog open={share} onOpenChange={setShare} />
      <CaptureStateDialog open={captureState} onOpenChange={setCaptureState} />
      <FigmaCompareDialog open={figmaOpen} onOpenChange={setFigmaOpen} />
      <div className="ml-1">
        <AccountMenu size={26} />
      </div>
    </header>
  );
}

const VIEW_OPTIONS: { value: TextView; label: string; title: string }[] = [
  { value: "original", label: "Original", title: "The page as it is — copy changes hidden" },
  { value: "edited", label: "Edited", title: "The new copy, exactly as the site would show it" },
  { value: "changes", label: "Changes", title: "Track changes: new copy highlighted, removed copy struck through" },
];

/**
 * Original · Edited · Changes — how copy edits show on the page. Visible once
 * the page has copy changes, or while the Text tool is on.
 */
function TextViewSwitch() {
  const count = useStore((s) => s.textEdits.length);
  const mode = useStore((s) => s.mode);
  const view = useStore((s) => s.textView);
  const setView = useStore((s) => s.setTextView);
  if (!count && mode !== "text") return null;
  return (
    <div className="flex items-center gap-2" data-text-view={view}>
      <span className="hidden items-center gap-1.5 whitespace-nowrap text-[12px] text-ink-2 lg:inline-flex" aria-live="polite">
        <span className="h-1.5 w-1.5 rounded-full bg-copy" />
        <span className="num">{count}</span> copy change{count === 1 ? "" : "s"}
      </span>
      <Tip label="How copy changes show on the page" kbd="⇧T" side="bottom">
        <div role="group" aria-label="Copy view" className="hidden md:block">
          <Segmented value={view} onChange={setView} options={VIEW_OPTIONS} />
        </div>
      </Tip>
      {/* narrow screens: the active view, the others in a menu — the page title keeps its room */}
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label={`Copy view: ${VIEW_OPTIONS.find((o) => o.value === view)?.label}`}
            className="flex h-8 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium text-ink hover:bg-hover md:hidden"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-copy" />
            {VIEW_OPTIONS.find((o) => o.value === view)?.label}
            <ChevronDown size={12} className="text-ink-3" />
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuLabel>Copy changes ({count})</MenuLabel>
          {VIEW_OPTIONS.map((o) => (
            <MenuItem key={o.value} onSelect={() => setView(o.value)}>
              <span className="w-3 text-copy">{view === o.value ? "•" : ""}</span>
              <span className="flex flex-col">
                <span>{o.label}</span>
                <span className="text-[11px] text-ink-3">{o.title}</span>
              </span>
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
      <div className="mx-0.5 h-5 w-px bg-line max-sm:hidden" />
    </div>
  );
}

/**
 * "Signed in to <site>": a login landed on the reviewed site for this
 * account (someone signed in there in Browse mode); "Forget login" drops it.
 * Cookies the site set without a login are not announced here — nearly every
 * site sets some — but the page menu offers "Forget session" for them. Hidden
 * on narrow screens like the host link next to it.
 */
function SiteLogin() {
  useSiteSessionSync();
  const session = useStore((s) => s.siteSession);
  if (!session?.signedIn) return null;
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className="hidden h-6 shrink-0 items-center gap-1 rounded-full bg-hover px-2 text-[11px] font-medium text-ink-2 hover:text-ink md:inline-flex"
          title={`Redline keeps your login on ${session.site} for this account`}
          aria-label={`Signed in to ${session.site}`}
        >
          <KeyRound size={11} className="text-green" />
          <span className="max-w-[160px] truncate">Signed in to {session.site}</span>
          <ChevronDown size={11} className="text-ink-3" />
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="w-[260px]">
        <MenuLabel>Login on {session.site}</MenuLabel>
        <div className="px-2 pb-1.5 text-[11.5px] leading-snug text-ink-3">Kept for your Redline account only — teammates sign in themselves.</div>
        <MenuSeparator />
        <MenuItem onSelect={forgetSiteSession}>
          <LogOut size={13} className="text-ink-2" /> Forget login
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
