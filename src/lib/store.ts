"use client";

import { create } from "zustand";
import type { Comment, Profile, Shape, ShapeStyle, ShapeType, Viewer } from "./types";
import type { PublicReview } from "./review";
import type { ElementInfo, Rect } from "./frame/dom";

export type Mode = "browse" | "comment" | "draw" | "inspect";
export type Panel = "comments" | "inspect" | null;
export type CommentFilter = "all" | "unread" | "mine" | "mentions";
export type CommentSort = "newest" | "oldest" | "unread";

export interface HoverInfo {
  rect: Rect;
  label: string;
  box?: ReturnType<typeof import("./frame/dom").boxModel>;
}

export interface DraftPin {
  px: number;
  py: number;
  region: Rect | null;
  selector: string | null;
  fx: number;
  fy: number;
  element_label: string | null;
  /** the composer has text — don't discard on click-outside */
  dirty?: boolean;
}

export interface Toast {
  id: number;
  text: string;
  kind?: "info" | "error" | "success";
  action?: { label: string; onClick: () => void };
}

interface State {
  review: PublicReview | null;
  viewOnly: boolean;
  comments: Comment[];
  shapes: Shape[];
  /** the signed-in account (null until /api/me answered) */
  me: Profile | null;
  viewer: Viewer;
  viewers: Viewer[]; // others present

  mode: Mode;
  panel: Panel;
  fullscreen: boolean;
  viewport: number;
  zoom: number;
  fitZoom: boolean;
  scroll: { x: number; y: number };
  docSize: { w: number; h: number };
  frameReady: boolean;
  frameError: string | null;
  navigatedAway: string | null;
  /** run the reviewed site's own scripts (off = static render) */
  scripts: boolean;
  /** the page's hover/focus state is pinned (bridge "hover lock") */
  hoverLocked: boolean;
  layoutTick: number; // bump to re-anchor pins

  // comments
  showComments: boolean;
  showResolved: boolean;
  commentFilter: CommentFilter;
  commentSort: CommentSort;
  activeThread: string | null;
  draft: DraftPin | null;
  readAt: Record<string, string>; // thread id -> iso last read, or "!" + iso when marked unread

  // inspect
  hover: HoverInfo | null;
  selected: ElementInfo | null;
  measureTarget: HoverInfo | null;
  deepSelect: boolean;

  // draw
  tool: ShapeType | "select";
  style: ShapeStyle;
  selectedShape: string | null;
  showOthersDrawings: boolean;

  toasts: Toast[];

  // actions
  set: (p: Partial<State>) => void;
  setMode: (m: Mode) => void;
  toast: (text: string, kind?: Toast["kind"], action?: Toast["action"]) => void;
  dismissToast: (id: number) => void;
  upsertComment: (c: Comment) => void;
  removeComment: (id: string) => void;
  upsertShape: (s: Shape) => void;
  removeShape: (id: string) => void;
  markRead: (threadId: string) => void;
  /** flag a thread to come back to — it shows as unread until opened again */
  markUnread: (threadId: string) => void;
  markAllRead: () => void;
}

const READ_KEY = "redline:read:";

/** Per-tab presence key; identity comes from the signed-in profile. */
function initialViewer(): Viewer {
  return { user_id: "", name: "", color: "#e2342b", avatar_url: null, key: Math.random().toString(36).slice(2, 10) };
}

export const useStore = create<State>((set, get) => ({
  review: null,
  viewOnly: false,
  comments: [],
  shapes: [],
  me: null,
  viewer: initialViewer(),
  viewers: [],

  mode: "browse",
  panel: "comments",
  fullscreen: false,
  viewport: 1440,
  zoom: 1,
  fitZoom: true,
  scroll: { x: 0, y: 0 },
  docSize: { w: 1440, h: 900 },
  frameReady: false,
  frameError: null,
  navigatedAway: null,
  scripts: true,
  hoverLocked: false,
  layoutTick: 0,

  showComments: true,
  showResolved: false,
  commentFilter: "all",
  commentSort: "newest",
  activeThread: null,
  draft: null,
  readAt: {},

  hover: null,
  selected: null,
  measureTarget: null,
  deepSelect: false,

  tool: "pen",
  style: { stroke: "#e2342b", width: 3, opacity: 1, fill: null, fontSize: 18 },
  selectedShape: null,
  showOthersDrawings: true,

  toasts: [],

  set: (p) => set(p),
  setMode: (m) =>
    set((s) => ({
      mode: m,
      panel: m === "inspect" ? "inspect" : m === "comment" ? "comments" : s.panel === "inspect" ? "comments" : s.panel,
      hover: null,
      measureTarget: null,
      draft: m === "comment" ? s.draft : null,
      selectedShape: m === "draw" ? s.selectedShape : null,
    })),
  toast: (text, kind = "info", action) => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts, { id, text, kind, action }] }));
    setTimeout(() => get().dismissToast(id), action ? 8000 : 3500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  upsertComment: (c) =>
    set((s) => {
      const i = s.comments.findIndex((x) => x.id === c.id);
      if (i === -1) return { comments: [...s.comments, c].sort((a, b) => a.created_at.localeCompare(b.created_at)) };
      const next = s.comments.slice();
      next[i] = c;
      return { comments: next };
    }),
  removeComment: (id) => set((s) => ({ comments: s.comments.filter((c) => c.id !== id && c.parent_id !== id) })),
  upsertShape: (sh) =>
    set((s) => {
      const i = s.shapes.findIndex((x) => x.id === sh.id);
      if (i === -1) return { shapes: [...s.shapes, sh].sort((a, b) => a.z - b.z) };
      const next = s.shapes.slice();
      next[i] = sh;
      return { shapes: next };
    }),
  removeShape: (id) => set((s) => ({ shapes: s.shapes.filter((x) => x.id !== id) })),
  markRead: (threadId) => {
    const now = new Date().toISOString();
    set((s) => ({ readAt: { ...s.readAt, [threadId]: now } }));
    saveReads(get);
  },
  markUnread: (threadId) => {
    set((s) => ({ readAt: { ...s.readAt, [threadId]: "!" + new Date().toISOString() } }));
    saveReads(get);
  },
  markAllRead: () => {
    const now = new Date().toISOString();
    set((s) => {
      const readAt = { ...s.readAt };
      for (const c of s.comments) if (c.parent_id === null) readAt[c.id] = now;
      return { readAt };
    });
    saveReads(get);
  },
}));

/** Read marks are ISO times; an unread mark is "!" + the time it was set. The later mark wins. */
export function laterRead(a: string, b: string | undefined): boolean {
  if (b === undefined) return true;
  return a.replace(/^!/, "") > b.replace(/^!/, "");
}

/** Whether a thread counts as unread for this viewer. */
export function isUnread(readAt: Record<string, string>, rootId: string, lastActivity: string, othersInvolved: boolean): boolean {
  const r = readAt[rootId];
  if (r?.startsWith("!")) return true; // deliberately marked unread
  return othersInvolved && (!r || r < lastActivity);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** Keep the browser copy immediately and the account copy shortly after. */
function saveReads(get: () => State) {
  const rid = get().review?.id;
  if (!rid) return;
  try {
    localStorage.setItem(READ_KEY + rid, JSON.stringify(get().readAt));
  } catch {
    /* ignore */
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const st = get();
    if (!st.review || st.review.id !== rid) return;
    void import("./api").then(({ api }) => api.putReads(rid, st.readAt)).catch(() => {});
  }, 1200);
}

/** Merge the account's read state (from another device) into this tab's. */
export function mergeReads(remote: Record<string, string>) {
  useStore.setState((s) => {
    const readAt = { ...s.readAt };
    for (const [k, v] of Object.entries(remote)) if (laterRead(v, readAt[k])) readAt[k] = v;
    return { readAt };
  });
  const rid = useStore.getState().review?.id;
  if (rid) {
    try {
      localStorage.setItem(READ_KEY + rid, JSON.stringify(useStore.getState().readAt));
    } catch {
      /* ignore */
    }
  }
}

/** Adopt the signed-in profile as this tab's identity. */
export function setMe(p: Profile) {
  useStore.setState((s) => ({ me: p, viewer: { ...s.viewer, user_id: p.id, name: p.name, color: p.color, avatar_url: p.avatar_url } }));
}

export function loadReadState(reviewId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(READ_KEY + reviewId);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/* selectors */
export const threadRoots = (comments: Comment[]) => comments.filter((c) => c.parent_id === null);
export const repliesOf = (comments: Comment[], id: string) => comments.filter((c) => c.parent_id === id);
