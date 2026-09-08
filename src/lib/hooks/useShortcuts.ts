"use client";

import { useEffect } from "react";
import { useStore, threadRoots } from "@/lib/store";
import { frame } from "@/lib/frame/controller";

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

/** Global keyboard shortcuts (also receives forwarded key events from the iframe). */
export function useShortcuts() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const st = useStore.getState();
      // modifier tracking for inspect
      if (e.key === "Control" || e.key === "Meta") st.set({ deepSelect: true });

      if (isTyping(e)) {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();

      if (e.key === "Escape") {
        if (st.fullscreen) return st.set({ fullscreen: false });
        if (st.draft) return st.set({ draft: null });
        if (st.activeThread) return st.set({ activeThread: null });
        if (st.selected || st.measureTarget) return st.set({ selected: null, measureTarget: null });
        if (st.selectedShape) return st.set({ selectedShape: null });
        if (st.mode !== "browse") return st.setMode("browse");
        return;
      }

      if (mod && k === "z") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(e.shiftKey ? "redline:redo" : "redline:undo"));
        return;
      }
      if (mod && (k === "=" || k === "+")) {
        e.preventDefault();
        st.set({ zoom: Math.min(3, st.zoom * 1.2), fitZoom: false });
        return;
      }
      if (mod && k === "-") {
        e.preventDefault();
        st.set({ zoom: Math.max(0.2, st.zoom / 1.2), fitZoom: false });
        return;
      }
      if (mod && k === "0") {
        e.preventDefault();
        st.set({ fitZoom: true });
        return;
      }
      if (mod && k === "1") {
        e.preventDefault();
        st.set({ zoom: 1, fitZoom: false });
        return;
      }
      if (mod) return;

      if (st.viewOnly) {
        if (k === "f") st.set({ fullscreen: !st.fullscreen });
        return;
      }

      switch (k) {
        case "v":
          st.setMode("browse");
          break;
        case "c":
          if (e.shiftKey) st.set({ showComments: !st.showComments });
          else st.setMode("comment");
          break;
        case "d":
          st.setMode("draw");
          break;
        case "i":
          st.setMode("inspect");
          break;
        case "f":
          st.set({ fullscreen: !st.fullscreen });
          break;
        case "n": {
          const roots = threadRoots(st.comments).filter((c) => st.showResolved || !c.resolved);
          if (!roots.length) break;
          const idx = roots.findIndex((c) => c.id === st.activeThread);
          const next = e.shiftKey
            ? roots[(idx - 1 + roots.length) % roots.length]
            : roots[(idx + 1) % roots.length];
          st.set({ activeThread: next.id, viewport: next.viewport_width });
          if (next.anchor) {
            const pos = frame().resolveAnchor(next.anchor);
            frame().scrollToPage(pos.y);
          }
          break;
        }
        case "p":
          if (st.mode === "draw") st.set({ tool: "pen" });
          break;
        case "h":
          if (st.mode === "draw") st.set({ tool: "highlighter" });
          break;
        case "l":
          if (st.mode === "draw") st.set({ tool: "line" });
          break;
        case "a":
          if (st.mode === "draw") st.set({ tool: "arrow" });
          break;
        case "r":
          if (st.mode === "draw") st.set({ tool: "rect" });
          break;
        case "o":
          if (st.mode === "draw") st.set({ tool: "ellipse" });
          break;
        case "t":
          if (st.mode === "draw") st.set({ tool: "text" });
          break;
        case "s":
          if (st.mode === "draw") st.set({ tool: "select" });
          break;
        case "delete":
        case "backspace":
          if (st.mode === "draw" && st.selectedShape) window.dispatchEvent(new CustomEvent("redline:delete-shape"));
          break;
        case "?":
          window.dispatchEvent(new CustomEvent("redline:help"));
          break;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") useStore.getState().set({ deepSelect: false });
    };
    const blur = () => useStore.getState().set({ deepSelect: false });
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
}
