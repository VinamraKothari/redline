"use client";

import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { api } from "./api";
import { useStore } from "./store";
import type { Comment, Shape, Viewer } from "./types";

/**
 * Keeps the store in sync with other reviewers.
 *  - Supabase configured → Postgres change feed + Presence (cursors, avatars)
 *  - otherwise → polling every few seconds (no presence)
 */

let client: SupabaseClient | null = null;
function supabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!client) client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export function realtimeAvailable(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export interface RealtimeHandle {
  stop: () => void;
  track: (v: Partial<Viewer>) => void;
  /** tell other viewers the review itself changed (freeze / unfreeze / title) */
  announceReview: () => void;
}

export function startRealtime(reviewId: string): RealtimeHandle {
  const sb = supabase();
  const st = useStore.getState;

  if (!sb) {
    // Polling fallback
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
      const me = st().viewer.key;
      const others: Viewer[] = [];
      for (const [key, metas] of Object.entries(state)) {
        if (key === me) continue;
        const m = metas[metas.length - 1];
        if (m) others.push({ ...m, key });
      }
      st().set({ viewers: others });
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        const v = st().viewer;
        await channel.track({ name: v.name || "Anonymous", color: v.color, cursor: null, viewport_width: st().viewport });
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

  let last = 0;
  return {
    stop: () => {
      clearInterval(reconcile);
      sb.removeChannel(channel);
    },
    announceReview: () => {
      const r = st().review;
      if (!r) return;
      channel.send({ type: "broadcast", event: "review", payload: { mode: r.mode, snapshot_path: r.snapshot_path, title: r.title } }).catch(() => {});
    },
    track: (v) => {
      const now = performance.now();
      if (now - last < 40) return; // throttle cursor updates
      last = now;
      const cur = st().viewer;
      channel.track({ name: cur.name || "Anonymous", color: cur.color, viewport_width: st().viewport, ...v }).catch(() => {});
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
