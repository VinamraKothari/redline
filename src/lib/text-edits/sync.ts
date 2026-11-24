"use client";

import { useStore, type TextEditFound } from "@/lib/store";
import { frame } from "@/lib/frame/controller";
import { pageRect, resolveSelector } from "@/lib/frame/dom";
import { applyEdits, editingIn } from "./apply";

/**
 * The glue between the store and the frame: one pass of applyEdits with the
 * store's edits and view, statuses written back only when they changed.
 */

function sameStatus(a: Record<string, TextEditFound>, b: Record<string, TextEditFound>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

/** Make the frame show the store's copy edits in the store's view. */
export function syncFrame() {
  const st = useStore.getState();
  const doc = frame().doc;
  // another page in the frame (a link followed in Browse mode) is not the page these edits belong to
  if (!doc || !st.frameReady || st.navigatedAway || !st.review) return;
  const status = applyEdits(doc, st.textEdits, st.textView, st.textEditStatus);
  if (!sameStatus(status, st.textEditStatus)) st.set({ textEditStatus: status });
}

/**
 * Run `fn` with the page showing its original copy, then put the view back —
 * for anything that captures the page (Freeze, Figma compare, a saved state):
 * the edits stay in Redline, on top of the page, never baked into it.
 */
export function withOriginal<T>(fn: () => T): T {
  const st = useStore.getState();
  const doc = frame().doc;
  if (!doc) return fn();
  // the Text tool's own traces: its cursor stylesheet and the block being edited
  // (the track-changes stylesheet goes with the Original view below)
  const parked = Array.from(doc.querySelectorAll("style[data-redline-text-mode]")).map((n) => ({ n, parent: n.parentNode!, next: n.nextSibling }));
  parked.forEach(({ n }) => n.parentNode?.removeChild(n));
  const editing = editingIn(doc);
  const editable = editing?.getAttribute("contenteditable") ?? null;
  if (editing) editing.removeAttribute("contenteditable");
  if (st.textEdits.length) applyEdits(doc, st.textEdits, "original", st.textEditStatus);
  try {
    return fn();
  } finally {
    for (const { n, parent, next } of parked) parent.insertBefore(n, next && next.parentNode === parent ? next : null);
    if (editing && editable !== null) editing.setAttribute("contenteditable", editable);
    if (st.textEdits.length) syncFrame();
  }
}

/** Scroll the frame to an edit's block and flash it. Returns false when the block is not on the page. */
export function jumpToEdit(id: string): boolean {
  const st = useStore.getState();
  const edit = st.textEdits.find((e) => e.id === id);
  const doc = frame().doc;
  const el = edit && doc ? resolveSelector(doc, edit.selector) : null;
  if (!el) return false;
  const r = pageRect(el);
  const win = frame().win;
  const visible = win && r.y >= win.scrollY + 40 && r.y + r.h <= win.scrollY + win.innerHeight - 40;
  if (!visible) frame().scrollToPage(r.y + r.h / 2);
  st.set({ textFlash: { id, at: Date.now() } });
  return true;
}
