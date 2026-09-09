"use client";

import { toCanvas } from "html-to-image";
import { frame } from "./frame/controller";
import { useStore } from "./store";
import { withProxiedFetch } from "./png";

/** Preview width in pixels (the project page shows tiles ~300px wide; 2× for retina). */
const WIDTH = 640;
/** How much of the page (in page pixels) the preview shows. */
const PAGE_HEIGHT = 1100;
/** Refresh a preview when it is older than this. */
export const STALE_MS = 6 * 60 * 60 * 1000;

/**
 * Renders the top of the reviewed page into a small JPEG and uploads it as
 * the review's preview. Best effort: any failure is silently ignored.
 */
export async function captureThumbnail(reviewId: string, viewport: number): Promise<void> {
  const doc = frame().doc;
  if (!doc?.documentElement) return;
  const st = useStore.getState();
  const h = Math.min(Math.max(st.docSize.h, 400), PAGE_HEIGHT);
  const scale = WIDTH / viewport;

  const canvas = await withProxiedFetch(() =>
    toCanvas(doc.documentElement as HTMLElement, {
      width: viewport,
      height: h,
      pixelRatio: scale,
      cacheBust: false,
      skipFonts: false,
      filter: (n) => !(n instanceof HTMLScriptElement) && !(n instanceof HTMLIFrameElement),
      style: { transform: "none" },
    }),
  );
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.78));
  if (!blob || blob.size > 600 * 1024) return;
  const r = await fetch(`/api/reviews/${reviewId}/thumbnail`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: blob });
  if (r.ok) {
    const { review } = (await r.json()) as { review: { thumbnail_url: string | null; thumbnail_at: string | null } };
    const cur = useStore.getState().review;
    if (cur && cur.id === reviewId) useStore.getState().set({ review: { ...cur, thumbnail_url: review.thumbnail_url, thumbnail_at: review.thumbnail_at } });
  }
}
