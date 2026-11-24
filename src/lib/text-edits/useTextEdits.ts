"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";
import { useStore, type TextView } from "@/lib/store";
import { frame } from "@/lib/frame/controller";
import { watchDocument } from "./apply";
import { jumpToEdit, syncFrame } from "./sync";
import { noteDrawing, redoText, undoText } from "./actions";

const VIEW_KEY = "redline:text-view:";
const VIEWS: TextView[] = ["original", "edited", "changes"];

function readView(reviewId: string): TextView | null {
  try {
    const v = sessionStorage.getItem(VIEW_KEY + reviewId);
    return VIEWS.includes(v as TextView) ? (v as TextView) : null;
  } catch {
    return null;
  }
}

function writeView(reviewId: string, v: TextView) {
  try {
    sessionStorage.setItem(VIEW_KEY + reviewId, v);
  } catch {
    /* private mode */
  }
}

/** Shift+T: Original → Edited → Changes → Original. */
export function cycleTextView() {
  const st = useStore.getState();
  st.setTextView(VIEWS[(VIEWS.indexOf(st.textView) + 1) % VIEWS.length]);
}

/**
 * Copy edits for the open review: load them, keep the frame showing them in
 * the chosen view (on load, on every change of edits or view, and when the
 * page re-renders a block), pick the view's default when the Text tool comes
 * and goes, remember the view for the tab, and follow a `?copy=<id>` link.
 */
export function useTextEdits(reviewId: string) {
  // load (realtime keeps them in sync afterwards)
  useEffect(() => {
    let alive = true;
    api.textEdits
      .list(reviewId)
      .then(({ edits }) => alive && useStore.getState().setTextEdits(edits))
      .catch(() => {});
    const saved = readView(reviewId);
    if (saved) useStore.getState().setTextView(saved);
    return () => {
      alive = false;
    };
  }, [reviewId]);

  // the view: a pick is remembered per review (for this tab); Changes while the Text tool is on, and back after
  useEffect(() => {
    let before: TextView | null = null;
    let switching = false;
    const autoSet = (v: TextView) => {
      switching = true;
      useStore.getState().setTextView(v);
      switching = false;
    };
    return useStore.subscribe((s, p) => {
      if (s.textView !== p.textView && !switching) {
        writeView(reviewId, s.textView);
        // picked by hand while the tool is on: that view stays afterwards
        if (s.mode === "text") before = null;
      }
      if (s.mode === p.mode) return;
      // drawings are made in the Draw tool: until it is left, they may be the newest thing to undo
      if (s.mode === "draw" || p.mode === "draw") noteDrawing();
      if (s.mode === "text" && p.mode !== "text") {
        before = s.textView;
        if (s.textView !== "changes") autoSet("changes");
      } else if (p.mode === "text" && s.mode !== "text") {
        if (before && before !== s.textView) autoSet(before);
        before = null;
      }
    });
  }, [reviewId]);

  // apply: whenever the document, the edits or the view change, and when the page re-renders
  const frameReady = useStore((s) => s.frameReady);
  const navigatedAway = useStore((s) => s.navigatedAway);
  useEffect(() => {
    if (!frameReady || navigatedAway) return;
    const doc = frame().doc;
    if (!doc) return;
    syncFrame();
    const stopWatch = watchDocument(doc, syncFrame);
    const unsub = useStore.subscribe((s, p) => {
      if (s.textEdits !== p.textEdits || s.textView !== p.textView) syncFrame();
    });
    return () => {
      stopWatch();
      unsub();
    };
  }, [frameReady, navigatedAway]);

  // a `?copy=<id>` link: the Copy tab, and the edit on the page, once both have loaded
  const ready = useStore((s) => s.frameReady && s.textEdits.length > 0);
  useEffect(() => {
    if (!ready) return;
    let id: string | null = null;
    try {
      id = new URLSearchParams(window.location.search).get("copy");
    } catch {
      /* no URL */
    }
    if (!id) return;
    const st = useStore.getState();
    if (!st.textEdits.some((e) => e.id === id)) return;
    st.set({ panel: "copy" });
    // after the first pass has put the edits in
    setTimeout(() => {
      if (!jumpToEdit(id!)) useStore.getState().toast("That copy change's text is no longer on the page.");
    }, 150);
    // only the first time this page opens with the link
    const url = new URL(window.location.href);
    url.searchParams.delete("copy");
    window.history.replaceState(window.history.state, "", url.toString());
  }, [ready]);

  // page-level undo / redo of saved copy actions (see useShortcuts: ⌘Z in the Text tool)
  useEffect(() => {
    const u = () => void undoText();
    const r = () => void redoText();
    window.addEventListener("redline:text-undo", u);
    window.addEventListener("redline:text-redo", r);
    return () => {
      window.removeEventListener("redline:text-undo", u);
      window.removeEventListener("redline:text-redo", r);
    };
  }, []);
}
