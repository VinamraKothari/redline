import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, reviewAccess } from "@/lib/auth/server";
import { publicReview } from "@/lib/review";
import { screenshotPage, screenshotsAvailable } from "@/lib/screenshot";
import { STALE_MS } from "@/lib/thumbnail-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Headless Chromium needs a while on a cold start. */
export const maxDuration = 60;

/**
 * POST — render a preview of the page on the server and store it.
 * Any member may ask; the capture only happens when the preview is missing or
 * stale, unless `?force=1` (edit role) asks for a fresh one.
 */
export const POST = guarded(async (req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/thumbnail">) => {
  const { id } = await ctx.params;
  const force = req.nextUrl.searchParams.get("force") === "1";
  const { user, role, review } = await reviewAccess(id, force ? "edit" : "view");

  const fresh = review.thumbnail_at && Date.now() - new Date(review.thumbnail_at).getTime() < STALE_MS;
  if (review.thumbnail_url && fresh && !force) return Response.json({ review: publicReview(review, role, user.id), captured: false });
  if (!screenshotsAvailable()) return Response.json({ error: "Previews are not available on this server." }, { status: 501 });

  const d = await db();
  // uploaded files render from the stored HTML; everything else opens the live URL
  const upload = review.url.startsWith("upload://");
  const html = upload && review.snapshot_path ? ((await d.getSnapshot(review.snapshot_path)) ?? undefined) : undefined;
  const url = upload ? undefined : review.url;
  if (html == null && !url) return Response.json({ error: "Nothing to capture." }, { status: 400 });

  let bytes: Uint8Array;
  try {
    bytes = await screenshotPage({ url: html == null ? url : undefined, html, width: review.default_viewport, height: Math.round(review.default_viewport * 0.72), outWidth: 800 });
  } catch (e) {
    return Response.json({ error: `Couldn't render a preview: ${(e as Error).message}` }, { status: 502 });
  }
  const stored = await d.putThumbnail(id, bytes, "image/jpeg");
  const updated = await d.updateReview(id, { thumbnail_url: stored, thumbnail_at: new Date().toISOString() });
  return Response.json({ review: publicReview(updated!, role, user.id), captured: true });
});
