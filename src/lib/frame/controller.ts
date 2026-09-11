"use client";

import { useStore } from "@/lib/store";
import type { Anchor } from "@/lib/types";
import { boxModel, buildSelector, pageRect, pathLabel, resolveSelector, targetAt, type Rect } from "./dom";

/**
 * Owns the review iframe. Because the proxied page is same-origin we can talk
 * to its DOM directly; the bridge script only reports navigation intents.
 */
export class FrameController {
  iframe: HTMLIFrameElement | null = null;
  private cleanup: Array<() => void> = [];
  private docCleanup: Array<() => void> = [];
  private raf = 0;
  private mutationTimer = 0;
  onNavigate: ((url: string, newTab: boolean) => void) | null = null;
  /** overlay elements that must move with the page (translated by -scroll) */
  private followers = new Set<HTMLElement>();
  /** the page's own scripts destroyed the document (see bridge.ts) */
  onCrashed: ((reason: string) => void) | null = null;

  attach(iframe: HTMLIFrameElement) {
    this.detach();
    this.iframe = iframe;
    const onLoad = () => this.handleLoad();
    iframe.addEventListener("load", onLoad);
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (!d || !d.__redline) return;
      if (e.source !== iframe.contentWindow) return;
      if (d.type === "navigate") this.onNavigate?.(d.url, Boolean(d.newTab || d.popup));
      if (d.type === "blocked-submit") useStore.getState().toast("Form submissions are disabled while reviewing.");
      if (d.type === "crashed") this.onCrashed?.(String(d.reason || ""));
      if (d.type === "hover-locked") {
        useStore.getState().set({ hoverLocked: true });
        if (!d.count)
          useStore.getState().toast("Nothing is hovered right now. Switch to Browse (V), hover the menu or element, press H to lock it, then comment or inspect it.");
      }
      if (d.type === "hover-unlocked") useStore.getState().set({ hoverLocked: false });
    };
    window.addEventListener("message", onMsg);
    this.cleanup.push(() => iframe.removeEventListener("load", onLoad), () => window.removeEventListener("message", onMsg));
    // If the proxied document is already loaded (e.g. fast cache), initialise now.
    const doc = iframe.contentDocument;
    const root = doc?.documentElement;
    if (doc?.readyState === "complete" && root && (root.hasAttribute("data-redline") || root.hasAttribute("data-redline-error"))) {
      this.handleLoad();
    }
  }

  detach() {
    this.docCleanup.forEach((f) => f());
    this.docCleanup = [];
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
    this.iframe = null;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.mutationTimer);
  }

  get doc(): Document | null {
    try {
      return this.iframe?.contentDocument ?? null;
    } catch {
      return null;
    }
  }
  get win(): Window | null {
    try {
      return this.iframe?.contentWindow ?? null;
    } catch {
      return null;
    }
  }

  private handleLoad() {
    // listeners from the previous document (navigation / reload)
    this.docCleanup.forEach((f) => f());
    this.docCleanup = [];
    const doc = this.doc;
    const win = this.win;
    const st = useStore.getState();
    if (!doc || !win) {
      st.set({ frameReady: false, frameError: "The page could not be accessed." });
      return;
    }
    if (doc.documentElement.getAttribute("data-redline-error")) {
      st.set({ frameReady: false, frameError: doc.title || "The page could not be loaded." });
      return;
    }
    st.set({ frameReady: true, frameError: null, hoverLocked: false, scroll: { x: win.scrollX, y: win.scrollY } });
    this.reportSize();

    // Overlays follow the page synchronously, inside the scroll event itself
    // (before the browser paints); React state follows a frame later for the
    // logic that needs it. A non-passive wheel listener keeps wheel scrolling
    // on the main thread so the page and the overlays move in the same frame
    // instead of the compositor moving the page one frame ahead.
    const onScroll = () => {
      this.applyScroll(win.scrollX, win.scrollY);
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(() => {
        useStore.getState().set({ scroll: { x: win.scrollX, y: win.scrollY } });
      });
    };
    win.addEventListener("scroll", onScroll, { passive: true });
    const onWheel = () => {};
    doc.addEventListener("wheel", onWheel, { passive: false });
    this.applyScroll(win.scrollX, win.scrollY);

    const ro = new ResizeObserver(() => this.reportSize());
    ro.observe(doc.documentElement);
    if (doc.body) ro.observe(doc.body);

    const mo = new MutationObserver(() => {
      clearTimeout(this.mutationTimer);
      this.mutationTimer = window.setTimeout(() => {
        this.reportSize();
        useStore.getState().set({ layoutTick: useStore.getState().layoutTick + 1 });
      }, 150);
    });
    mo.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "open"] });

    // Keyboard events inside the frame should still drive our shortcuts.
    const onKey = (e: KeyboardEvent) => {
      const clone = new KeyboardEvent(e.type, e);
      window.dispatchEvent(clone);
    };
    doc.addEventListener("keydown", onKey);
    doc.addEventListener("keyup", onKey);

    // Fonts may finish after load; re-anchor once they settle.
    doc.fonts?.ready.then(() => this.reportSize()).catch(() => {});

    this.docCleanup.push(
      () => win.removeEventListener("scroll", onScroll),
      () => doc.removeEventListener("wheel", onWheel),
      () => ro.disconnect(),
      () => mo.disconnect(),
      () => doc.removeEventListener("keydown", onKey),
      () => doc.removeEventListener("keyup", onKey),
    );
  }

  /** Register an overlay element positioned in page coordinates. Returns the unregister function. */
  follow(el: HTMLElement): () => void {
    this.followers.add(el);
    const win = this.win;
    const x = win?.scrollX ?? useStore.getState().scroll.x;
    const y = win?.scrollY ?? useStore.getState().scroll.y;
    el.style.transform = `translate(${-x}px, ${-y}px)`;
    return () => {
      this.followers.delete(el);
    };
  }

  private applyScroll(x: number, y: number) {
    const t = `translate(${-x}px, ${-y}px)`;
    this.followers.forEach((el) => {
      el.style.transform = t;
    });
  }

  private reportSize() {
    const doc = this.doc;
    if (!doc?.documentElement) return;
    const h = Math.max(
      doc.documentElement.scrollHeight,
      doc.body?.scrollHeight ?? 0,
      doc.documentElement.clientHeight,
    );
    const w = Math.max(doc.documentElement.scrollWidth, doc.documentElement.clientWidth);
    const st = useStore.getState();
    if (st.docSize.w !== w || st.docSize.h !== h) st.set({ docSize: { w, h }, layoutTick: st.layoutTick + 1 });
  }

  /** Convert host client coords → iframe viewport coords, given the frame's on-screen rect and zoom. */
  toViewport(clientX: number, clientY: number, frameRect: DOMRect, zoom: number) {
    return { vx: (clientX - frameRect.left) / zoom, vy: (clientY - frameRect.top) / zoom };
  }

  elementAtViewport(vx: number, vy: number, deep: boolean): Element | null {
    const doc = this.doc;
    if (!doc) return null;
    return targetAt(doc, vx, vy, deep);
  }

  elementAtPage(px: number, py: number, deep: boolean): Element | null {
    const win = this.win;
    if (!win) return null;
    return this.elementAtViewport(px - win.scrollX, py - win.scrollY, deep);
  }

  hoverInfo(el: Element) {
    return { rect: pageRect(el), label: pathLabel(el, 3), box: boxModel(el) };
  }

  anchorFor(px: number, py: number, region: Rect | null, deep = false): Anchor {
    const el = this.elementAtPage(px, py, deep);
    if (!el || el === this.doc?.body || el === this.doc?.documentElement) {
      return { selector: null, fx: 0, fy: 0, px, py, region, element_label: null };
    }
    const r = pageRect(el);
    return {
      selector: buildSelector(el),
      fx: r.w ? (px - r.x) / r.w : 0,
      fy: r.h ? (py - r.y) / r.h : 0,
      px,
      py,
      region,
      element_label: pathLabel(el, 3),
    };
  }

  /** Where a pin should be drawn now (page coords). `detached` when its element is gone. */
  resolveAnchor(a: Anchor): { x: number; y: number; detached: boolean; rect: Rect | null } {
    const doc = this.doc;
    // region comments are absolute on the page by design
    if (!doc || a.region) return { x: a.px, y: a.py, detached: false, rect: null };
    const el = resolveSelector(doc, a.selector);
    if (!el) return { x: a.px, y: a.py, detached: Boolean(a.selector), rect: null };
    const r = pageRect(el);
    if (r.w === 0 && r.h === 0) return { x: a.px, y: a.py, detached: true, rect: null };
    return { x: r.x + a.fx * r.w, y: r.y + a.fy * r.h, detached: false, rect: r };
  }

  /** Pin / release the page's current hover state (see bridge.ts). */
  lockHover(on: boolean) {
    try {
      this.win?.postMessage({ __redline: true, type: on ? "hover-lock" : "hover-unlock" }, "*");
    } catch {
      /* ignore */
    }
  }

  scrollBy(dx: number, dy: number) {
    this.win?.scrollBy(dx, dy);
  }

  scrollToPage(y: number, x?: number) {
    const win = this.win;
    if (!win) return;
    const vh = win.innerHeight;
    win.scrollTo({ top: Math.max(0, y - vh / 2), left: x != null ? Math.max(0, x - win.innerWidth / 2) : win.scrollX, behavior: "smooth" });
  }

  /** Scroll all the way down (and back) so lazy content renders before a freeze. */
  async warmUp() {
    const win = this.win;
    const doc = this.doc;
    if (!win || !doc) return;
    const start = win.scrollY;
    const step = Math.max(400, win.innerHeight * 0.8);
    let y = 0;
    const max = () => doc.documentElement.scrollHeight;
    while (y < max() && y < 60000) {
      win.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 90));
      y += step;
    }
    win.scrollTo(0, start);
    await new Promise((r) => setTimeout(r, 200));
  }
}

let singleton: FrameController | null = null;
export function frame(): FrameController {
  if (!singleton) singleton = new FrameController();
  return singleton;
}
