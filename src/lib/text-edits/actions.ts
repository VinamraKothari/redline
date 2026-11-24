"use client";

import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { TextEdit } from "@/lib/types";
import { normalizeText, parseInline, sanitizeInline, serializeRuns } from "./sanitize";
import { sameCopy } from "./diff";

/**
 * Saving copy edits, and the page-level undo/redo of saved actions (a save,
 * a reset, "Restore all"). Undo inside an editing session is the session's
 * own (see editor.ts); this stack takes over once the copy is saved.
 *
 * Bringing a deleted edit back needs the signed undo token the DELETE routes
 * hand out (the API restores nothing else), so every step that deletes a
 * row keeps its token, and the step that undoes it hands the token back.
 * Every action is optimistic in the store and put back, with a toast, when
 * the server refuses it.
 */

interface Base {
  /** when it was done, undone or redone last — what decides between copy and drawing undo */
  at: number;
  /** the toast offering its Undo, dismissed once the action is undone or redone */
  toast?: number;
}
type Action = Base &
  (
    | /** new copy saved; `token` brings `next` back after an undo deleted a new edit */
    { kind: "save"; prev: TextEdit | null; next: TextEdit; token?: string }
    | { kind: "reset"; rows: TextEdit[]; tokens: string[] }
    | { kind: "restore-all"; rows: TextEdit[]; tokens: string[] }
    /** a block whose edit no longer matched the page got new copy: the old edit replaced by a fresh one */
    | { kind: "rebase"; prev: TextEdit; next: TextEdit; prevToken: string; nextToken?: string }
  );

const undoStack: Action[] = [];
const redoStack: Action[] = [];
let stackReview: string | null = null;
const MAX_STEPS = 50;
/** the last time a drawing could have been made (draw mode left, or on) */
let lastDrawing = 0;

/** The stacks belong to one page: opening another starts them empty. */
function stacksFor(reviewId: string) {
  if (stackReview !== reviewId) {
    undoStack.length = 0;
    redoStack.length = 0;
    stackReview = reviewId;
  }
}

function push(a: Action) {
  const rid = useStore.getState().review?.id;
  if (!rid) return;
  stacksFor(rid);
  undoStack.push(a);
  if (undoStack.length > MAX_STEPS) undoStack.shift();
  redoStack.length = 0;
}

const err = (e: unknown) => useStore.getState().toast((e as Error).message || "That didn't work.", "error");

/** Show a toast and return its id. */
function toastWith(text: string, action?: { label: string; onClick: () => void }): number | undefined {
  const st = useStore.getState();
  st.toast(text, "success", action);
  return useStore.getState().toasts.at(-1)?.id;
}

function describe(a: Action): string {
  if (a.kind === "save" || a.kind === "rebase") return `copy change to ${a.next.label}`;
  if (a.kind === "reset") return `reset of ${a.rows[0]?.label ?? "a text block"}`;
  return `restore of ${a.rows.length} block${a.rows.length === 1 ? "" : "s"}`;
}

/**
 * The reviewed site's own links as the site writes them. Inside the reviewer
 * the proxy has made every link absolute (`https://shop.test/guide` for the
 * site's `/guide`); a hand-off should show the site's URL, so links to the
 * reviewed site's origin go back to path, query and hash. Other links, and
 * pages without a web origin (uploads), stay as they are.
 */
export function siteLinks(html: string): string {
  let origin: string | null = null;
  try {
    const u = new URL(useStore.getState().review?.url ?? "");
    if (u.protocol === "http:" || u.protocol === "https:") origin = u.origin;
  } catch {
    /* no site */
  }
  if (!origin || !html.includes("href")) return html;
  const local = (href: string | null) => {
    if (!href) return href;
    try {
      const u = new URL(href);
      return u.origin === origin ? u.pathname + u.search + u.hash || "/" : href;
    } catch {
      return href; // already relative
    }
  };
  const runs = parseInline(html).map((r) => (r.t === "text" ? { ...r, marks: r.marks.map((m) => (m.tag === "a" ? { ...m, href: local(m.href) } : m)) } : r));
  return sanitizeInline(serializeRuns(runs));
}

export interface SaveInput {
  selector: string;
  label: string;
  /** the block's own copy on the page */
  original: string;
  /** the cleaned new copy */
  after: string;
  /** the block's edit, when it has one */
  existing: TextEdit | null;
  /**
   * whether `existing` started from other copy than the page shows now: an
   * edit that is live on the site or out of date. New copy for the block then
   * starts a fresh edit from what the page says today.
   */
  rebase?: boolean;
}

/** Save one block's copy (or reset it, when the copy is the original again). */
export async function saveCopy(input: SaveInput): Promise<void> {
  const st = useStore.getState();
  const review = st.review;
  if (!review) return;
  const { existing } = input;
  if (existing && input.rebase) return rebase(input, existing);
  const before = existing ? existing.before_html : siteLinks(sanitizeInline(input.original));
  const after = siteLinks(input.after);
  // back to the original: that is a reset (which keeps an undo token), not a save
  if (sameCopy(after, before)) {
    if (existing) await resetEdit(existing);
    return;
  }
  if (existing && sameCopy(after, existing.after_html)) return;

  const now = new Date().toISOString();
  const optimistic: TextEdit = existing
    ? { ...existing, after_html: after, after_text: normalizeText(after), status: "open", updated_at: now }
    : {
        id: `tmp-${Math.random().toString(36).slice(2, 10)}`,
        review_id: review.id,
        selector: input.selector,
        label: input.label,
        before_html: before,
        before_text: normalizeText(before),
        after_html: after,
        after_text: normalizeText(after),
        viewport_width: st.viewport,
        status: "open",
        note: null,
        author_id: st.me?.id ?? null,
        author_name: st.viewer.name || "You",
        author_color: st.viewer.color,
        created_at: now,
        updated_at: now,
      };
  st.upsertTextEdit(optimistic);

  try {
    const res = await api.textEdits.put(review.id, {
      selector: input.selector,
      label: input.label,
      before_html: siteLinks(sanitizeInline(input.original)),
      after_html: after,
      viewport_width: Math.round(st.viewport),
    });
    const s = useStore.getState();
    if ("edit" in res) {
      if (optimistic.id !== res.edit.id) s.removeTextEdit(optimistic.id);
      s.upsertTextEdit(res.edit);
      push({ kind: "save", prev: existing, next: res.edit, at: Date.now() });
    } else {
      // the server read it as the original after all
      s.removeTextEdit(optimistic.id);
      if (res.deleted) s.removeTextEdit(res.deleted);
    }
  } catch (e) {
    const s = useStore.getState();
    s.removeTextEdit(optimistic.id);
    if (existing) s.upsertTextEdit(existing);
    err(e);
  }
}

/**
 * New copy for a block whose edit started from other text. The API keeps an
 * edit's `before_*` for good (one edit per block), so the old edit is
 * deleted first — its undo token kept — and the new one saved; if that save
 * fails, the old edit is put straight back with the token.
 */
async function rebase(input: SaveInput, old: TextEdit) {
  const st = useStore.getState();
  const review = st.review!;
  const before = siteLinks(sanitizeInline(input.original));
  const after = siteLinks(input.after);
  st.removeTextEdit(old.id);
  let prevToken: string | null = null;
  try {
    const removed = await api.textEdits.remove(review.id, old.id);
    prevToken = removed.token;
    if (sameCopy(after, before)) {
      // the page's copy today, unchanged: the stale edit is simply gone
      const a: Action = { kind: "reset", rows: [removed.edit], tokens: [removed.token], at: Date.now() };
      push(a);
      a.toast = toastWith(`Reset ${old.label} to the original.`, { label: "Undo", onClick: () => void undoIfLast(a) });
      return;
    }
    const res = await api.textEdits.put(review.id, {
      selector: old.selector,
      label: input.label,
      before_html: before,
      after_html: after,
      viewport_width: Math.round(st.viewport),
    });
    if (!("edit" in res)) throw new Error("The new copy could not be saved.");
    useStore.getState().upsertTextEdit(res.edit);
    push({ kind: "rebase", prev: removed.edit, next: res.edit, prevToken: removed.token, at: Date.now() });
  } catch (e) {
    err(e);
    if (prevToken) await putBack(review.id, [prevToken]).catch(() => {});
    else useStore.getState().upsertTextEdit(old);
  }
}

/** "Reset to original" for one edit, with an Undo in the toast. */
export async function resetEdit(edit: TextEdit): Promise<void> {
  const st = useStore.getState();
  if (!st.review) return;
  st.removeTextEdit(edit.id);
  try {
    const { edit: row, token } = await api.textEdits.remove(st.review.id, edit.id);
    const a: Action = { kind: "reset", rows: [row], tokens: [token], at: Date.now() };
    push(a);
    a.toast = toastWith(`Reset ${edit.label} to the original.`, { label: "Undo", onClick: () => void undoIfLast(a) });
  } catch (e) {
    useStore.getState().upsertTextEdit(edit);
    err(e);
  }
}

/** "Restore all on this page": every block back to its original, with an Undo in the toast. */
export async function restoreAll(): Promise<void> {
  const st = useStore.getState();
  if (!st.review || !st.textEdits.length) return;
  const before = st.textEdits;
  st.setTextEdits([]);
  try {
    const { edits, tokens } = await api.textEdits.removeAll(st.review.id);
    const a: Action = { kind: "restore-all", rows: edits, tokens, at: Date.now() };
    push(a);
    a.toast = toastWith(`Restored ${edits.length} text block${edits.length === 1 ? "" : "s"} to the original.`, { label: "Undo", onClick: () => void undoIfLast(a) });
  } catch (e) {
    useStore.getState().setTextEdits(before);
    err(e);
  }
}

export async function setEditStatus(edit: TextEdit, status: TextEdit["status"]) {
  const st = useStore.getState();
  if (!st.review) return;
  st.upsertTextEdit({ ...edit, status });
  try {
    const res = await api.textEdits.patch(st.review.id, edit.id, { status });
    if ("edit" in res) useStore.getState().upsertTextEdit(res.edit);
  } catch (e) {
    useStore.getState().upsertTextEdit(edit);
    err(e);
  }
}

export async function setEditNote(edit: TextEdit, note: string) {
  const st = useStore.getState();
  if (!st.review) return;
  const value = note.trim() || null;
  if (value === edit.note) return;
  st.upsertTextEdit({ ...edit, note: value });
  try {
    const res = await api.textEdits.patch(st.review.id, edit.id, { note: value });
    if ("edit" in res) useStore.getState().upsertTextEdit(res.edit);
  } catch (e) {
    useStore.getState().upsertTextEdit(edit);
    err(e);
  }
}

/* ─── undo / redo ─────────────────────────────────────────────────────── */

/** Bring deleted rows back with their tokens. */
async function putBack(reviewId: string, tokens: string[]) {
  const { edits, skipped } = await api.textEdits.restore(reviewId, tokens);
  const s = useStore.getState();
  edits.forEach((e) => s.upsertTextEdit(e));
  if (skipped.length) s.toast(`${skipped.length} block${skipped.length === 1 ? " has" : "s have"} newer copy and stayed as they are.`);
}

/** Delete a row; its token is what brings it back. */
async function removeRow(reviewId: string, id: string): Promise<string> {
  useStore.getState().removeTextEdit(id);
  return (await api.textEdits.remove(reviewId, id)).token;
}

/** Set a saved row back to the copy and status it had in `to`. */
async function rewrite(reviewId: string, id: string, to: TextEdit) {
  const res = await api.textEdits.patch(reviewId, id, { after_html: to.after_html, status: to.status });
  const s = useStore.getState();
  if ("edit" in res) s.upsertTextEdit(res.edit);
  else s.removeTextEdit(res.deleted);
}

async function run(a: Action, direction: "undo" | "redo") {
  const rid = useStore.getState().review!.id;
  const undo = direction === "undo";
  switch (a.kind) {
    case "save":
      if (a.prev) await rewrite(rid, a.next.id, undo ? a.prev : a.next);
      else if (undo) a.token = await removeRow(rid, a.next.id);
      else await putBack(rid, [a.token!]);
      return;
    case "rebase":
      if (undo) {
        a.nextToken = await removeRow(rid, a.next.id);
        await putBack(rid, [a.prevToken]);
      } else {
        a.prevToken = await removeRow(rid, a.prev.id);
        await putBack(rid, [a.nextToken!]);
      }
      return;
    case "reset":
      if (undo) await putBack(rid, a.tokens);
      else a.tokens = await Promise.all(a.rows.map((r) => removeRow(rid, r.id)));
      return;
    case "restore-all":
      if (undo) await putBack(rid, a.tokens);
      else {
        useStore.getState().setTextEdits([]);
        const res = await api.textEdits.removeAll(rid);
        a.rows = res.edits;
        a.tokens = res.tokens;
      }
  }
}

let busy = false;

async function step(direction: "undo" | "redo") {
  const st = useStore.getState();
  if (!st.review || busy) return;
  stacksFor(st.review.id);
  const from = direction === "undo" ? undoStack : redoStack;
  const to = direction === "undo" ? redoStack : undoStack;
  const a = from.pop();
  if (!a) {
    st.toast(direction === "undo" ? "Nothing to undo." : "Nothing to redo.");
    return;
  }
  busy = true;
  try {
    await run(a, direction);
    a.at = Date.now();
    to.push(a);
    // its old toast offers something that no longer applies
    if (a.toast !== undefined) useStore.getState().dismissToast(a.toast);
    a.toast = undefined;
    st.toast(`${direction === "undo" ? "Undone" : "Redone"}: ${describe(a)}.`, "success");
  } catch (e) {
    err(e);
    // the server copy is the truth again
    api.textEdits
      .list(st.review.id)
      .then(({ edits }) => useStore.getState().setTextEdits(edits))
      .catch(() => {});
  } finally {
    busy = false;
  }
}

export const undoText = () => step("undo");
export const redoText = () => step("redo");

/** A toast's Undo: only while its action is still the last one — an older toast must not undo something newer. */
function undoIfLast(a: Action) {
  if (undoStack[undoStack.length - 1] === a) return step("undo");
  useStore.getState().toast("That can't be undone from here any more — use ⌘Z / Ctrl+Z.");
}

/** Draw mode was on until now: a drawing may be the newest thing to undo. */
export function noteDrawing() {
  lastDrawing = Date.now();
}

/**
 * Whether ⌘Z / ⌘⇧Z outside the Text and Draw tools is for copy: the newest
 * copy action is more recent than the last time drawings could be made.
 */
export function copyStepFirst(direction: "undo" | "redo"): boolean {
  const rid = useStore.getState().review?.id;
  if (!rid || stackReview !== rid) return false;
  const top = (direction === "undo" ? undoStack : redoStack).at(-1);
  return Boolean(top && top.at > lastDrawing);
}
