import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, reviewAccess } from "@/lib/auth/server";
import { publicReview } from "@/lib/review";
import { screenshotPage, screenshotsAvailable } from "@/lib/screenshot";
import { unproxyHtml } from "@/lib/render";
import { STALE_MS } from "@/lib/thumbnail-policy";
import { loadJar } from "@/lib/proxy/sessions";

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

  // `thumbnail_at` without a URL records a capture that was skipped (the site
  // answered with its sign-in form); it is retried after STALE_MS like a stale one
  const fresh = review.thumbnail_at && Date.now() - new Date(review.thumbnail_at).getTime() < STALE_MS;
  if (fresh && !force) return Response.json({ review: publicReview(review, role, user.id), captured: false });
  if (!screenshotsAvailable()) return Response.json({ error: "Previews are not available on this server." }, { status: 501 });

  const d = await db();
  // uploads and frozen states render from the stored HTML; live pages open the URL
  const upload = review.url.startsWith("upload://");
  const fromSnapshot = (upload || review.mode === "frozen") && !!review.snapshot_path;
  let html = fromSnapshot ? ((await d.getSnapshot(review.snapshot_path!)) ?? undefined) : undefined;
  if (html && review.mode === "frozen") html = unproxyHtml(html, review.url);
  const url = upload ? undefined : review.url;
  if (html == null && !url) return Response.json({ error: "Nothing to capture." }, { status: 400 });

  // A page behind a login renders with the caller's session on the site
  // (docs/site-sessions.md), the way they see it in the review.
  const cookies = url && html == null ? (await loadJar(user.id, new URL(url).hostname)).jar.toJSON() : [];
  let shot: Awaited<ReturnType<typeof screenshotPage>>;
  try {
    shot = await screenshotPage({ url: html == null ? url : undefined, html, width: review.default_viewport, height: Math.round(review.default_viewport * 0.72), outWidth: 800, cookies });
  } catch (e) {
    return Response.json({ error: `Couldn't render a preview: ${(e as Error).message}` }, { status: 502 });
  }
  // the site answered with its sign-in form instead of the page: not a
  // preview of the page — the card keeps waiting for a real one, and the
  // next try waits STALE_MS instead of launching a browser on every open
  if (shot.loginForm) {
    const skipped = await d.updateReview(id, { thumbnail_at: new Date().toISOString() });
    return Response.json({ review: publicReview(skipped ?? review, role, user.id), captured: false, loginForm: true });
  }
  const stored = await d.putThumbnail(id, shot.bytes, "image/jpeg");
  const updated = await d.updateReview(id, { thumbnail_url: stored, thumbnail_at: new Date().toISOString() });
  return Response.json({ review: publicReview(updated!, role, user.id), captured: true });
});
