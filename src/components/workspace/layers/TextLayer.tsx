"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bold, Check, Italic, Link2, Link2Off, RotateCcw, Underline } from "lucide-react";
import { useStore } from "@/lib/store";
import { frame } from "@/lib/frame/controller";
import { buildSelector, pageRect, resolveSelector, type Rect } from "@/lib/frame/dom";
import type { TextEdit } from "@/lib/types";
import { adoptContent, editedHtml, setEditing, track } from "@/lib/text-edits/apply";
import { blockLabel, caretAt, offsetInNewCopy, offsetOf, pickBlock, TextSession, type Marks, type MarkName } from "@/lib/text-edits/editor";
import type { Bounds } from "@/lib/text-edits/slot";
import { normalizeText, safeHref } from "@/lib/text-edits/sanitize";
import { saveCopy } from "@/lib/text-edits/actions";
import { syncFrame } from "@/lib/text-edits/sync";
import { IconButton, Tip } from "@/components/ui/primitives";
import { cn } from "@/lib/util";
import { PageLayer } from "./PageLayer";
import type { StageGeom } from "../Stage";

/** Events the page's own scripts never see while the Text tool is on (except inside the block being edited). */
const KEYS = ["keydown", "keypress", "keyup"] as const;
const BLOCKED = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu", "touchstart", "touchend", "submit"] as const;

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? "⌘" : "Ctrl+";

interface Editing {
  el: HTMLElement;
  rect: Rect;
  marks: Marks;
  dirty: boolean;
  /** the block's saved edit, if any */
  edit: TextEdit | null;
}

interface Meta {
  selector: string;
  label: string;
  editId: string | null;
}

/**
 * A link address as typed: http(s), mailto, tel or a path; a bare domain
 * ("acme.com/pricing") gets https://. Null when it can't be a safe link.
 */
export function linkFromInput(raw: string): string | null {
  let v = raw.trim();
  if (!v) return null;
  if (!/^([a-z][a-z0-9+.-]*:|\/|\.\/|\.\.\/|#|\?)/i.test(v)) {
    if (/^[^\s/]+\.[a-z]{2,}(?:[/?#:]|$)/i.test(v)) v = `https://${v}`;
    else return null;
  }
  const safe = safeHref(v);
  if (!safe || /\s/.test(safe)) return null;
  return safe;
}

/**
 * The Text tool: hover a text block to see it outlined, click to edit it in
 * place, with a small toolbar above it. Also draws the quiet outlines of
 * changed blocks in the Changes view and the flash of "Jump" from the Copy
 * tab. Everything here is drawn in Redline's overlay — nothing on the page's
 * own elements but the edited block's `contenteditable` while it is edited.
 */
export function TextLayer({ geom }: { geom: StageGeom }) {
  const mode = useStore((s) => s.mode);
  const viewOnly = useStore((s) => s.viewOnly);
  const textView = useStore((s) => s.textView);
  const textEdits = useStore((s) => s.textEdits);
  const status = useStore((s) => s.textEditStatus);
  const layoutTick = useStore((s) => s.layoutTick);
  const flash = useStore((s) => s.textFlash);
  const scroll = useStore((s) => s.scroll);
  const active = mode === "text" && !viewOnly;

  const [hover, setHover] = useState<{ rect: Rect; edited: boolean; ok: boolean } | null>(null);
  const [editing, setEditingState] = useState<Editing | null>(null);
  const [link, setLink] = useState<{ value: string; error: string | null } | null>(null);
  /** the copy was emptied and Enter / Done asked to save it: "Remove all of this text?" */
  const [emptyAsk, setEmptyAsk] = useState(false);
  const session = useRef<TextSession | null>(null);
  const meta = useRef<Meta | null>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const cursorStyle = useRef<HTMLStyleElement | null>(null);
  const hoverEl = useRef<Element | null>(null);

  /** Cursor hints in the frame: the text cursor over the block under the pointer and the one being edited. */
  const paintCursor = useCallback(() => {
    const s = cursorStyle.current;
    if (!s) return;
    const q = (el: Element | null) => {
      if (!el) return null;
      try {
        return buildSelector(el);
      } catch {
        return null;
      }
    };
    const hovered = q(hoverEl.current);
    const edited = q(session.current?.el ?? null);
    let css = "html,html *{cursor:default!important}";
    if (hovered) css += `${hovered},${hovered} *{cursor:text!important}`;
    // our outline replaces the browser's focus ring on the edited block
    if (edited) css += `${edited},${edited} *{cursor:text!important}${edited}:focus{outline:none!important}`;
    s.textContent = css;
  }, []);

  const refresh = useCallback(() => {
    const s = session.current;
    if (!s) return;
    const id = meta.current?.editId;
    const edit = id ? (useStore.getState().textEdits.find((e) => e.id === id) ?? null) : null;
    setEditingState({ el: s.el, rect: pageRect(s.el), marks: s.marks(), dirty: s.dirty(), edit });
    // typing something again answers the question
    if (normalizeText(s.html())) setEmptyAsk(false);
  }, []);

  /** End the session and put the block back as it was. */
  const cancel = useCallback(() => {
    const s = session.current;
    if (!s) return;
    session.current = null;
    meta.current = null;
    // the block's own copy from before the session
    s.restoreStart();
    s.end();
    setEditing(s.doc, null);
    adoptContent(s.doc, s.el);
    setEditingState(null);
    setLink(null);
    setEmptyAsk(false);
    paintCursor();
    syncFrame();
  }, [paintCursor]);

  /**
   * End the session and save what changed. Emptying a block entirely is never
   * saved by accident: Enter / Done ask first ("confirmed" is the answer), and
   * a click elsewhere puts the text back.
   */
  const commit = useCallback((how: "enter" | "outside" | "confirmed" = "outside") => {
    const s = session.current;
    const m = meta.current;
    if (!s || !m) return;
    if (how !== "confirmed" && s.dirty() && !normalizeText(s.html())) {
      if (how === "enter") {
        setEmptyAsk(true);
        return;
      }
      cancel();
      useStore.getState().toast("The emptied text wasn't saved. To remove all of it, press Enter and confirm.");
      return;
    }
    setEmptyAsk(false);
    session.current = null;
    meta.current = null;
    const after = s.html();
    const dirty = s.dirty();
    s.end();
    setEditing(s.doc, null);
    adoptContent(s.doc, s.el);
    setEditingState(null);
    setLink(null);
    paintCursor();
    const st = useStore.getState();
    const existing = st.textEdits.find((e) => e.id === m.editId || e.selector === m.selector) ?? null;
    const found = existing ? st.textEditStatus[existing.id] : undefined;
    if (dirty) {
      void saveCopy({
        selector: existing?.selector ?? m.selector,
        label: existing && found === "applied" ? existing.label : m.label,
        original: s.original,
        after,
        existing,
        rebase: Boolean(existing && found && found !== "applied"),
      });
    }
    syncFrame();
  }, [paintCursor, cancel]);

  const openLink = useCallback(() => {
    const s = session.current;
    if (!s) return;
    s.keepSelection();
    setLink({ value: s.marks().href ?? "", error: null });
  }, []);

  /** Start editing `block` with the caret at `caret` characters of its new copy (null: the end). */
  const begin = useCallback(
    (block: HTMLElement, caret: number | null): boolean => {
      const doc = block.ownerDocument;
      const selector = buildSelector(block);
      const edit = useStore.getState().textEdits.find((e) => resolveSelector(doc, e.selector) === block) ?? null;
      const tracked = track(doc, block);
      if (!tracked) return false;
      const { original, bounds } = tracked;
      const applied = edit && useStore.getState().textEditStatus[edit.id] === "applied";
      setEditing(doc, block);
      const s = new TextSession(block, original, bounds, {
        onCommit: () => commit("enter"),
        onCancel: () => cancel(),
        onLinkRequest: () => openLink(),
        onState: () => refresh(),
      });
      // the label quotes the page's own copy of the block
      meta.current = { selector: edit?.selector ?? selector, label: applied ? edit.label : blockLabel(block, normalizeText(original)), editId: edit?.id ?? null };
      session.current = s;
      s.begin(applied ? editedHtml(edit) : null, caret);
      hoverEl.current = null;
      setHover(null);
      paintCursor();
      refresh();
      return true;
    },
    [commit, cancel, openLink, refresh, paintCursor],
  );

  // the frame, while the Text tool is on: hover, click to edit, and the page's own handlers kept out
  useEffect(() => {
    if (!active) return;
    const doc = frame().doc;
    const win = frame().win;
    if (!doc || !win) return;
    const style = doc.createElement("style");
    style.setAttribute("data-redline-text-mode", "");
    (doc.head || doc.documentElement).appendChild(style);
    cursorStyle.current = style;
    paintCursor();

    let last: Element | null = null;
    const setHoverBlock = (b: { el: Element; ok: boolean } | null) => {
      if ((b?.el ?? null) === last) return;
      last = b?.el ?? null;
      hoverEl.current = b?.ok ? b.el : null;
      paintCursor();
      if (!b) return setHover(null);
      const edited = useStore.getState().textEdits.some((e) => resolveSelector(doc, e.selector) === b.el);
      setHover({ rect: pageRect(b.el), edited, ok: b.ok });
    };
    /**
     * The press that starts editing a block is Redline's to finish: the block
     * switches from track changes to the new copy when the session starts, so
     * the browser's own caret, double-click and drag would land on other
     * words. The press and any drag are read on the rendering the user sees
     * — positions counted in the new copy, deleted words skipped — and the
     * session starts on release with that caret or selection. A second and
     * third press there select the word and all of the copy.
     */
    let pending: { block: HTMLElement; bounds: Bounds; anchor: number; focus: number; clicks: number; x: number; y: number; at: { node: Node; offset: number } | null } | null = null;
    let gesture: { anchor: number; clicks: number; x: number; y: number; at: number; dragging: boolean } | null = null;
    /** Where a viewport point falls in a block's new copy (before it: 0, after it: the end). */
    const offsetIn = (block: HTMLElement, bounds: Bounds, x: number, y: number) => {
      const p = caretAt(doc, x, y);
      if (p && block.contains(p.node)) return { off: offsetInNewCopy(block, bounds, p.node, p.offset), p };
      const r = block.getBoundingClientRect();
      const before = y < r.top || (y <= r.bottom && x < r.left);
      return { off: before ? 0 : offsetOf(block, bounds, block, block.childNodes.length - bounds.trail.length, true), p: null };
    };
    const finish = () => {
      const pd = pending;
      pending = null;
      if (!pd) return;
      doc.getSelection()?.removeAllRanges();
      if (!begin(pd.block, pd.anchor)) return;
      const s = session.current!;
      s.selectFor(pd.clicks, pd.anchor, pd.focus);
      gesture = { anchor: pd.anchor, clicks: pd.clicks, x: pd.x, y: pd.y, at: Date.now(), dragging: false };
    };
    const onMove = (e: MouseEvent) => {
      const s = session.current;
      const t = e.target as Node | null;
      if (pending) {
        if (!(e.buttons & 1)) return finish();
        const { off, p } = offsetIn(pending.block, pending.bounds, e.clientX, e.clientY);
        pending.focus = off;
        // what the drag covers, shown on the page as it is now
        if (pending.at && p) doc.getSelection()?.setBaseAndExtent(pending.at.node, pending.at.offset, p.node, p.offset);
        return;
      }
      if (gesture?.dragging && s) {
        if (e.buttons & 1) s.selectFor(gesture.clicks, gesture.anchor, s.offsetAtPoint(e.clientX, e.clientY));
        else gesture.dragging = false;
      }
      if (s && t && s.el.contains(t)) return setHoverBlock(null);
      setHoverBlock(pickBlock(t));
    };
    const onLeave = () => setHoverBlock(null);
    const onBlocked = (e: Event) => {
      const s = session.current;
      const t = e.target as Node | null;
      if (e.type === "mouseup" && gesture) gesture.dragging = false;
      if (e.type === "mouseup" && pending) {
        e.stopImmediatePropagation();
        e.preventDefault();
        return finish();
      }
      if (s && t && (t === s.el || s.el.contains(t))) {
        // the block being edited gets its caret and selection; the page's scripts get nothing, and a link in it doesn't navigate
        e.stopImmediatePropagation();
        if (e.type === "click" || e.type === "auxclick") e.preventDefault();
        const me = e as MouseEvent;
        if (e.type === "mousedown" && me.button === 0) {
          const g = gesture;
          // the second and third press of the click that started editing: the word / all, where the first press was
          if (g && me.detail >= 2 && Date.now() - g.at < 800 && Math.abs(me.clientX - g.x) < 6 && Math.abs(me.clientY - g.y) < 6) {
            e.preventDefault();
            g.clicks = me.detail;
            g.at = Date.now();
            g.dragging = true;
            s.selectFor(g.clicks, g.anchor);
          } else gesture = null; // a fresh press in the block: the browser's own caret and selection
        }
        return;
      }
      e.stopImmediatePropagation();
      // pointer and touch events keep their default: cancelling them would suppress the mouse events that follow
      if (!e.type.startsWith("pointer") && !e.type.startsWith("touch")) e.preventDefault();
      if (e.type !== "mousedown" || (e as MouseEvent).button !== 0) return;
      const me = e as MouseEvent;
      if (s) commit();
      const block = pickBlock(t);
      if (!block?.ok) return;
      // editing in the Original view would hide the result the moment it is saved: show the changes first
      if (useStore.getState().textView === "original") useStore.getState().setTextView("changes");
      const tracked = track(doc, block.el);
      if (!tracked) return;
      const { off, p } = offsetIn(block.el, tracked.bounds, me.clientX, me.clientY);
      pending = { block: block.el, bounds: tracked.bounds, anchor: off, focus: off, clicks: Math.min(3, Math.max(1, me.detail || 1)), x: me.clientX, y: me.clientY, at: p };
    };
    // the page's own key handlers (site shortcuts, a framework's listeners) stay out while the tool is on;
    // Redline's shortcuts still get the keys — handed over here, as the frame controller does otherwise
    const onKey = (e: KeyboardEvent) => {
      const s = session.current;
      const t = e.target as HTMLElement | null;
      if (s && t && (t === s.el || s.el.contains(t))) return; // the editing session handles those
      e.stopImmediatePropagation();
      if (e.type === "keypress") return;
      const typing = Boolean(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT"));
      if (typing && e.key === "Escape" && e.type === "keydown") t?.blur();
      if (typing && e.key !== "Control" && e.key !== "Meta") return;
      window.dispatchEvent(new KeyboardEvent(e.type, e));
    };
    win.addEventListener("mousemove", onMove, true);
    doc.documentElement.addEventListener("mouseleave", onLeave);
    BLOCKED.forEach((t) => win.addEventListener(t, onBlocked, true));
    KEYS.forEach((t) => win.addEventListener(t, onKey as EventListener, true));
    return () => {
      KEYS.forEach((t) => win.removeEventListener(t, onKey as EventListener, true));
      win.removeEventListener("mousemove", onMove, true);
      doc.documentElement.removeEventListener("mouseleave", onLeave);
      BLOCKED.forEach((t) => win.removeEventListener(t, onBlocked, true));
      // leaving the tool (or the page) saves what is being edited
      commit();
      style.remove();
      cursorStyle.current = null;
      hoverEl.current = null;
      setHover(null);
    };
  }, [active, begin, commit, paintCursor]);

  // a click anywhere in Redline outside the toolbar saves, like a click elsewhere on the page
  const isEditing = editing !== null;
  // leaving the page with unsaved copy asks first
  useEffect(() => {
    if (!isEditing) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!session.current?.dirty()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [isEditing]);
  const editingBlock = editing?.el ?? null;
  useEffect(() => {
    if (!isEditing) return;
    const onDown = (e: PointerEvent) => {
      if (toolbar.current?.contains(e.target as Node)) return;
      commit();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [isEditing, commit]);

  // the edited block may have moved (a realtime change above it, a resize)
  useEffect(() => {
    void layoutTick;
    if (session.current) refresh();
  }, [layoutTick, refresh]);

  // blocks with copy changes, outlined quietly in the Changes view
  const changed = useMemo(() => {
    void layoutTick;
    if (textView !== "changes") return [];
    const doc = frame().doc;
    if (!doc) return [];
    const editingEl = editingBlock;
    return textEdits
      .filter((e) => status[e.id] === "applied")
      .map((e) => {
        const el = resolveSelector(doc, e.selector);
        return el && el !== editingEl ? { id: e.id, rect: pageRect(el) } : null;
      })
      .filter((x): x is { id: string; rect: Rect } => Boolean(x));
  }, [textEdits, status, textView, layoutTick, editingBlock]);

  const flashRect = useMemo(() => {
    void layoutTick;
    if (!flash) return null;
    const e = textEdits.find((x) => x.id === flash.id);
    const doc = frame().doc;
    const el = e && doc ? resolveSelector(doc, e.selector) : null;
    return el ? pageRect(el) : null;
  }, [flash, textEdits, layoutTick]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => {
      if (useStore.getState().textFlash === flash) useStore.getState().set({ textFlash: null });
    }, 1700);
    return () => clearTimeout(t);
  }, [flash]);

  const inv = 1 / geom.zoom;
  const pad = 3 * inv;

  return (
    <PageLayer className="z-[45]">
      {changed.map((c) => (
        <div
          key={c.id}
          data-copy-outline={c.id}
          className="absolute rounded-[3px]"
          style={{ left: c.rect.x - pad, top: c.rect.y - pad, width: c.rect.w + pad * 2, height: c.rect.h + pad * 2, outline: `${inv}px dashed color-mix(in srgb, var(--copy) 55%, transparent)` }}
        />
      ))}

      {active && hover && (
        <>
          <div
            data-text-hover={hover.ok ? "" : "refused"}
            className="absolute rounded-[3px]"
            style={{
              left: hover.rect.x - pad,
              top: hover.rect.y - pad,
              width: hover.rect.w + pad * 2,
              height: hover.rect.h + pad * 2,
              outline: `${1.5 * inv}px dotted ${hover.ok ? "var(--copy)" : "var(--ink-3)"}`,
            }}
          />
          <div className="absolute" style={{ left: hover.rect.x - pad, top: hover.rect.y - pad - 2 * inv }}>
            <div
              className="absolute bottom-0 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10.5px] font-medium text-white"
              style={{ background: hover.ok ? "var(--copy)" : "var(--ink-2)", transform: `scale(${inv})`, transformOrigin: "0 100%" }}
            >
              {!hover.ok ? "This text can't be edited here" : hover.edited ? "Click to edit · changed" : "Click to edit"}
            </div>
          </div>
        </>
      )}

      {editing && (
        <div
          className="absolute rounded-[3px]"
          style={{ left: editing.rect.x - pad, top: editing.rect.y - pad, width: editing.rect.w + pad * 2, height: editing.rect.h + pad * 2, outline: `${1.5 * inv}px solid var(--copy)` }}
        />
      )}

      {flashRect && flash && (
        <div
          key={flash.at}
          data-copy-flash={flash.id}
          className="rl-flash absolute rounded-[4px]"
          style={{ left: flashRect.x - pad * 2, top: flashRect.y - pad * 2, width: flashRect.w + pad * 4, height: flashRect.h + pad * 4, outline: `${2 * inv}px solid var(--copy)` }}
        />
      )}

      {editing && (
        <Toolbar
          ref={toolbar}
          rect={editing.rect}
          inv={inv}
          scroll={scroll}
          marks={editing.marks}
          canReset={Boolean(editing.edit) || editing.dirty}
          link={link}
          onToggle={(m) => {
            session.current?.focus();
            session.current?.toggle(m);
          }}
          onLink={openLink}
          onLinkChange={(value) => setLink({ value, error: null })}
          onLinkApply={() => {
            if (!link) return;
            const href = linkFromInput(link.value);
            if (!href) {
              setLink({ ...link, error: "Use a web address (https://…), mailto:, tel: or a path like /pricing." });
              return;
            }
            setLink(null);
            session.current?.focus();
            session.current?.setLink(href);
          }}
          onLinkRemove={() => {
            setLink(null);
            session.current?.focus();
            session.current?.setLink(null);
          }}
          onLinkClose={() => {
            setLink(null);
            session.current?.focus();
          }}
          onReset={() => {
            const s = session.current;
            if (!s) return;
            s.replaceWith(s.original);
            commit("enter");
          }}
          onDone={() => commit("enter")}
          emptyAsk={emptyAsk}
          onConfirmEmpty={() => commit("confirmed")}
          onKeepEditing={() => {
            setEmptyAsk(false);
            session.current?.focus();
          }}
        />
      )}
    </PageLayer>
  );
}

interface ToolbarProps {
  rect: Rect;
  inv: number;
  scroll: { x: number; y: number };
  marks: Marks;
  canReset: boolean;
  link: { value: string; error: string | null } | null;
  onToggle: (m: MarkName) => void;
  onLink: () => void;
  onLinkChange: (v: string) => void;
  onLinkApply: () => void;
  onLinkRemove: () => void;
  onLinkClose: () => void;
  onReset: () => void;
  onDone: () => void;
  emptyAsk: boolean;
  onConfirmEmpty: () => void;
  onKeepEditing: () => void;
}

/**
 * The floating toolbar over the block being edited. It sits above the block
 * (below it near the top of the page), inside the visible part of the stage,
 * and at the same size whatever the zoom. Its buttons never take the focus
 * from the block (mousedown is cancelled), so the selection stays put.
 */
function Toolbar({ ref, rect, inv, scroll, marks, canReset, link, onToggle, onLink, onLinkChange, onLinkApply, onLinkRemove, onLinkClose, onReset, onDone, emptyAsk, onConfirmEmpty, onKeepEditing }: ToolbarProps & { ref: React.RefObject<HTMLDivElement | null> }) {
  const [size, setSize] = useState({ w: 280, h: 40 });
  const input = useRef<HTMLInputElement>(null);
  // its own size (unscaled), to keep it inside the stage — the link field makes it taller
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  const linkOpen = Boolean(link);
  useEffect(() => {
    if (linkOpen) input.current?.focus();
  }, [linkOpen]);

  const win = frame().win;
  const vw = win?.innerWidth ?? 1440;
  const vh = win?.innerHeight ?? 900;
  const w = size.w * inv;
  const h = size.h * inv;
  const gap = 10 * inv;
  const edge = 6 * inv;
  let top = rect.y - h - gap;
  if (top < scroll.y + edge) top = rect.y + rect.h + gap;
  top = Math.max(scroll.y + edge, Math.min(top, scroll.y + vh - h - edge));
  const left = Math.max(scroll.x + edge, Math.min(rect.x - 3 * inv, scroll.x + vw - w - edge));

  const keep = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("input")) return;
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Text formatting"
      data-text-toolbar=""
      onMouseDown={keep}
      className="pointer-events-auto absolute z-[5]"
      style={{ left, top, transform: `scale(${inv})`, transformOrigin: "0 0" }}
    >
      {/* the entrance animation has its own transform: it lives on an inner box, so the outer one keeps the zoom compensation */}
      <div className="flex flex-col rounded-xl glass p-1 shadow-pop hairline toast-in">
        <div className="flex items-center gap-0.5">
          <Tip label="Bold" kbd={`${MOD}B`} side="top">
            <IconButton size="sm" active={marks.strong} aria-pressed={marks.strong} aria-label="Bold" onClick={() => onToggle("strong")}>
              <Bold size={14} strokeWidth={2.4} />
            </IconButton>
          </Tip>
          <Tip label="Italic" kbd={`${MOD}I`} side="top">
            <IconButton size="sm" active={marks.em} aria-pressed={marks.em} aria-label="Italic" onClick={() => onToggle("em")}>
              <Italic size={14} />
            </IconButton>
          </Tip>
          <Tip label="Underline" kbd={`${MOD}U`} side="top">
            <IconButton size="sm" active={marks.u} aria-pressed={marks.u} aria-label="Underline" onClick={() => onToggle("u")}>
              <Underline size={14} />
            </IconButton>
          </Tip>
          <Tip label={marks.href ? "Edit link" : "Link"} kbd={`${MOD}K`} side="top">
            <IconButton size="sm" active={Boolean(marks.href) || linkOpen} aria-label="Link" onClick={onLink}>
              <Link2 size={14} />
            </IconButton>
          </Tip>
          {canReset && (
            <>
              <div className="mx-1 h-4 w-px bg-line" />
              <Tip label="Reset to original — the page's own copy" side="top">
                <IconButton size="sm" aria-label="Reset to original" onClick={onReset}>
                  <RotateCcw size={14} />
                </IconButton>
              </Tip>
            </>
          )}
          <div className="mx-1 h-4 w-px bg-line" />
          <Tip label="Save — or click anywhere else. Esc discards" kbd="Enter" side="top">
            <button
              type="button"
              onClick={onDone}
              className="press flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-semibold text-white"
              style={{ background: "var(--copy)" }}
            >
              <Check size={13} strokeWidth={2.6} /> Done
            </button>
          </Tip>
        </div>
        {emptyAsk && (
          <div role="alertdialog" aria-label="Remove all of this text?" className="mt-1 flex items-center gap-1.5 border-t border-line px-1.5 pb-0.5 pt-1.5">
            <span className="flex-1 whitespace-nowrap pr-2 text-[12px] font-medium text-ink">Remove all of this text?</span>
            <button type="button" onClick={onKeepEditing} className="press h-7 rounded-md px-2 text-[12px] font-medium text-ink-2 hover:bg-hover">
              Keep editing
            </button>
            <button type="button" onClick={onConfirmEmpty} className="press h-7 rounded-md bg-red px-2 text-[12px] font-semibold text-white hover:bg-red-ink">
              Remove
            </button>
          </div>
        )}
        {link && (
          <form
            className="mt-1 flex w-[300px] flex-col gap-1 border-t border-line px-1 pb-0.5 pt-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              onLinkApply();
            }}
          >
            <div className="flex items-center gap-1">
              <input
                ref={input}
                value={link.value}
                onChange={(e) => onLinkChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    onLinkClose();
                  }
                }}
                placeholder="https://… or /path"
                aria-label="Link address"
                aria-invalid={Boolean(link.error)}
                className={cn("h-7 min-w-0 flex-1 rounded-md bg-panel px-2 text-[12.5px] text-ink hairline placeholder:text-ink-3 focus:shadow-[0_0_0_2px_var(--copy)]", link.error && "shadow-[0_0_0_1.5px_var(--red)]")}
              />
              <button type="submit" className="press h-7 rounded-md bg-ink px-2 text-[12px] font-medium text-white hover:bg-black">
                Apply
              </button>
              {marks.href && (
                <Tip label="Remove link" side="top">
                  <IconButton size="sm" aria-label="Remove link" onClick={onLinkRemove}>
                    <Link2Off size={14} />
                  </IconButton>
                </Tip>
              )}
            </div>
            {link.error && <p className="px-0.5 text-[11px] leading-snug text-red">{link.error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
