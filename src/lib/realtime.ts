"use client";

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { api } from "./api";
import { supabaseBrowser } from "./auth/client";
import { useStore } from "./store";
import type { Comment, Shape, Viewer } from "./types";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabase-config";

/**
 * Keeps the store in sync with other reviewers.
 *  - Supabase configured → Postgres change feed + Presence (cursors, avatars)
 *  - otherwise → polling every few seconds (no presence)
 *
 * The change feed runs on the signed-in user's connection, so row level
 * security only delivers rows of reviews in projects they belong to.
 */

function supabase(): SupabaseClient | null {
  return supabaseBrowser();
}

export function realtimeAvailable(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

export interface RealtimeHandle {
  stop: () => void;
  track: (v: Partial<Viewer>) => void;
  /** tell other viewers the review itself changed (freeze / unfreeze / title) */
  announceReview: () => void;
}

/**
 * Starts syncing. Realtime needs a Supabase session on this browser (which
 * e2e test users don't have), so the decision is made once the session is
 * known; until then the handle is a no-op.
 */
export function startRealtime(reviewId: string): RealtimeHandle {
  let inner: RealtimeHandle | null = null;
  let stopped = false;
  const sb = supabase();
  const decide = async () => {
    let live = false;
    if (sb) {
      try {
        live = Boolean((await sb.auth.getSession()).data.session);
      } catch {
        live = false;
      }
    }
    if (stopped) return;
    inner = live && sb ? startLive(sb, reviewId) : startPolling(reviewId);
  };
  void decide();
  return {
    stop: () => {
      stopped = true;
      inner?.stop();
    },
    track: (v) => inner?.track(v),
    announceReview: () => inner?.announceReview(),
  };
}

function startPolling(reviewId: string): RealtimeHandle {
  let alive = true;
  const tick = async () => {
    if (!alive) return;
    try {
      const [{ comments }, { shapes }] = await Promise.all([api.listComments(reviewId), api.listShapes(reviewId)]);
      mergeComments(comments);
      mergeShapes(shapes);
    } catch {
      /* offline */
    }
    if (alive) setTimeout(tick, 4000);
  };
  setTimeout(tick, 4000);
  return { stop: () => (alive = false), track: () => {}, announceReview: () => {} };
}

function startLive(sb: SupabaseClient, reviewId: string): RealtimeHandle {
  const st = useStore.getState;
  const channel: RealtimeChannel = sb.channel(`review:${reviewId}`, {
    config: { presence: { key: st().viewer.key } },
  });

  channel
    .on("postgres_changes", { event: "*", schema: "public", table: "comments", filter: `review_id=eq.${reviewId}` }, (payload) => {
      if (payload.eventType === "DELETE") {
        const old = payload.old as Partial<Comment>;
        if (old.id) st().removeComment(old.id);
      } else {
        st().upsertComment(payload.new as Comment);
      }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "shapes", filter: `review_id=eq.${reviewId}` }, (payload) => {
      if (payload.eventType === "DELETE") {
        const old = payload.old as Partial<Shape>;
        if (old.id) st().removeShape(old.id);
      } else {
        st().upsertShape(payload.new as Shape);
      }
    })
    .on("broadcast", { event: "review" }, ({ payload }) => {
      const r = payload as { mode: string; snapshot_path: string | null; title: string };
      const cur = st().review;
      if (cur && (cur.mode !== r.mode || cur.snapshot_path !== r.snapshot_path || cur.title !== r.title)) {
        st().set({ review: { ...cur, mode: r.mode as typeof cur.mode, snapshot_path: r.snapshot_path, title: r.title } });
      }
    })
    .on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<Viewer>();
      const me = st().viewer;
      const prev = st().viewers;
      const others: Viewer[] = [];
      for (const [key, metas] of Object.entries(state)) {
        if (key === me.key) continue;
        const m = metas[metas.length - 1];
        if (!m) continue;
        // keep the last streamed cursor position across presence re-syncs
        const cursor = prev.find((v) => v.key === key)?.cursor ?? null;
        others.push({ ...m, key, cursor });
      }
      st().set({ viewers: others });
    })
    // Cursors stream over broadcast (fire-and-forget, ~30 Hz) — presence is a
    // state-sync mechanism and lags/batches when used for pointer positions.
    .on("broadcast", { event: "cursor" }, ({ payload }) => {
      const c = payload as { key: string; x: number | null; y: number | null; viewport_width: number };
      const cur = st().viewers;
      const i = cur.findIndex((v) => v.key === c.key);
      if (i < 0) return;
      const next = cur.slice();
      next[i] = { ...next[i], cursor: c.x == null || c.y == null ? null : { x: c.x, y: c.y }, viewport_width: c.viewport_width };
      st().set({ viewers: next });
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        const v = st().viewer;
        await channel.track({ user_id: v.user_id, name: v.name || "Someone", color: v.color, avatar_url: v.avatar_url ?? null, cursor: null, viewport_width: st().viewport });
      }
    });

  // Full-DELETE payloads only contain the id if REPLICA IDENTITY FULL isn't set,
  // which is what we rely on; also do a periodic reconcile to be safe.
  const reconcile = setInterval(async () => {
    try {
      const [{ comments }, { shapes }] = await Promise.all([api.listComments(reviewId), api.listShapes(reviewId)]);
      mergeComments(comments);
      mergeShapes(shapes);
    } catch {
      /* ignore */
    }
  }, 30_000);

  let lastCursor = 0;
  let pending: { x: number | null; y: number | null } | null = null;
  let flushTimer = 0;
  const flushCursor = () => {
    flushTimer = 0;
    if (!pending) return;
    const p = pending;
    pending = null;
    lastCursor = performance.now();
    channel
      .send({ type: "broadcast", event: "cursor", payload: { key: st().viewer.key, x: p.x, y: p.y, viewport_width: st().viewport } })
      .catch(() => {});
  };
  return {
    stop: () => {
      clearInterval(reconcile);
      clearTimeout(flushTimer);
      sb.removeChannel(channel);
    },
    announceReview: () => {
      const r = st().review;
      if (!r) return;
      channel.send({ type: "broadcast", event: "review", payload: { mode: r.mode, snapshot_path: r.snapshot_path, title: r.title } }).catch(() => {});
    },
    track: (v) => {
      if ("cursor" in v) {
        // stream the position; coalesce to one message per ~30 ms
        pending = v.cursor ? { x: v.cursor.x, y: v.cursor.y } : { x: null, y: null };
        const wait = 30 - (performance.now() - lastCursor);
        if (wait <= 0) flushCursor();
        else if (!flushTimer) flushTimer = window.setTimeout(flushCursor, wait);
        return;
      }
      const cur = st().viewer;
      channel
        .track({ user_id: cur.user_id, name: cur.name || "Someone", color: cur.color, avatar_url: cur.avatar_url ?? null, viewport_width: st().viewport, ...v })
        .catch(() => {});
    },
  };
}

function mergeComments(comments: Comment[]) {
  const st = useStore.getState();
  const ids = new Set(comments.map((c) => c.id));
  const changed =
    comments.length !== st.comments.length ||
    comments.some((c) => {
      const cur = st.comments.find((x) => x.id === c.id);
      return !cur || JSON.stringify(cur) !== JSON.stringify(c);
    }) ||
    st.comments.some((c) => !ids.has(c.id));
  if (changed) st.set({ comments: comments.sort((a, b) => a.created_at.localeCompare(b.created_at)) });
}

function mergeShapes(shapes: Shape[]) {
  const st = useStore.getState();
  const cur = st.shapes;
  if (cur.length === shapes.length && cur.every((s, i) => s.id === shapes[i].id && s.updated_at === shapes[i].updated_at)) return;
  st.set({ shapes: shapes.sort((a, b) => a.z - b.z) });
}
