"use client";

import type { Anchor, Attachment, Comment, Shape } from "./types";
import type { PublicReview } from "./review";

const OWNER_KEY = "redline:owner:";

export function getOwnerKey(reviewId: string): string | null {
  try {
    return localStorage.getItem(OWNER_KEY + reviewId);
  } catch {
    return null;
  }
}
export function setOwnerKey(reviewId: string, key: string) {
  try {
    localStorage.setItem(OWNER_KEY + reviewId, key);
  } catch {
    /* ignore */
  }
}

async function call<T>(url: string, init: RequestInit & { reviewId?: string; actor?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init.headers as Record<string, string>) };
  if (init.reviewId) {
    const k = getOwnerKey(init.reviewId);
    if (k) headers["x-owner-key"] = k;
  }
  if (init.actor) headers["x-actor"] = init.actor;
  const res = await fetch(url, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  createReview(body: { url?: string; name?: string; viewport?: number; mode?: "live" | "upload"; html?: string; title?: string }) {
    return call<{ review: PublicReview & { owner_key: string } }>("/api/reviews", { method: "POST", body: JSON.stringify(body) });
  },
  loadReview(id: string) {
    return call<{ review: PublicReview; comments: Comment[]; shapes: Shape[] }>(`/api/reviews/${id}`, { reviewId: id, cache: "no-store" });
  },
  patchReview(id: string, patch: Partial<PublicReview>) {
    return call<{ review: PublicReview }>(`/api/reviews/${id}`, { method: "PATCH", body: JSON.stringify(patch), reviewId: id });
  },
  deleteReview(id: string) {
    return call<{ ok: true }>(`/api/reviews/${id}`, { method: "DELETE", reviewId: id });
  },

  listComments(id: string) {
    return call<{ comments: Comment[] }>(`/api/reviews/${id}/comments`, { cache: "no-store" });
  },
  createComment(
    reviewId: string,
    body: {
      parent_id?: string | null;
      author_name: string;
      author_color: string;
      body: string;
      anchor?: Anchor | null;
      viewport_width: number;
      attachments?: Attachment[];
    },
  ) {
    return call<{ comment: Comment }>(`/api/reviews/${reviewId}/comments`, { method: "POST", body: JSON.stringify(body) });
  },
  editComment(reviewId: string, id: string, actor: string, body: string) {
    return call<{ comment: Comment }>(`/api/comments/${id}`, { method: "PATCH", body: JSON.stringify({ action: "edit", actor, body }), reviewId });
  },
  resolveComment(reviewId: string, id: string, actor: string, resolved: boolean) {
    return call<{ comment: Comment }>(`/api/comments/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "resolve", actor, resolved }),
      reviewId,
    });
  },
  react(reviewId: string, id: string, actor: string, emoji: string) {
    return call<{ comment: Comment }>(`/api/comments/${id}`, { method: "PATCH", body: JSON.stringify({ action: "react", actor, emoji }), reviewId });
  },
  moveComment(reviewId: string, id: string, actor: string, anchor: Anchor) {
    return call<{ comment: Comment }>(`/api/comments/${id}`, { method: "PATCH", body: JSON.stringify({ action: "move", actor, anchor }), reviewId });
  },
  deleteComment(reviewId: string, id: string, actor: string) {
    return call<{ ok: true }>(`/api/comments/${id}`, { method: "DELETE", reviewId, actor });
  },

  listShapes(id: string) {
    return call<{ shapes: Shape[] }>(`/api/reviews/${id}/shapes`, { cache: "no-store" });
  },
  putShape(reviewId: string, shape: Shape) {
    return call<{ shape: Shape }>(`/api/reviews/${reviewId}/shapes`, { method: "PUT", body: JSON.stringify(shape) });
  },
  patchShape(id: string, patch: Partial<Shape>) {
    return call<{ shape: Shape }>(`/api/shapes/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  deleteShape(id: string) {
    return call<{ ok: true }>(`/api/shapes/${id}`, { method: "DELETE" });
  },
  clearShapes(reviewId: string, viewport: number | null) {
    const q = viewport ? `?viewport=${viewport}` : "?all=1";
    return call<{ ok: true }>(`/api/reviews/${reviewId}/shapes${q}`, { method: "DELETE" });
  },

  freeze(reviewId: string, html: string) {
    return call<{ review: PublicReview }>(`/api/reviews/${reviewId}/freeze`, { method: "POST", body: JSON.stringify({ html }), reviewId });
  },
};
