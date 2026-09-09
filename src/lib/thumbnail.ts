"use client";

import { useStore } from "./store";
export { STALE_MS } from "./thumbnail-policy";

/**
 * Asks the server to render a preview of the page (headless Chromium) and
 * updates the review in the store. Best effort: failures are ignored.
 */
export async function captureThumbnail(reviewId: string, force = false): Promise<void> {
  const r = await fetch(`/api/reviews/${reviewId}/thumbnail${force ? "?force=1" : ""}`, { method: "POST" });
  if (!r.ok) return;
  const { review } = (await r.json()) as { review: { thumbnail_url: string | null; thumbnail_at: string | null } };
  const cur = useStore.getState().review;
  if (cur && cur.id === reviewId) useStore.getState().set({ review: { ...cur, thumbnail_url: review.thumbnail_url, thumbnail_at: review.thumbnail_at } });
}
