import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { publicReview } from "@/lib/review";

export const runtime = "nodejs";

/** POST { html } — store a snapshot of the rendered page and switch the review to it. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/freeze">) {
  const { id } = await ctx.params;
  const d = await db();
  const review = await d.getReview(id);
  if (!review) return Response.json({ error: "not found" }, { status: 404 });
  const ownerKey = req.headers.get("x-owner-key");
  if (ownerKey !== review.owner_key) {
    return Response.json({ error: "Only the person who created this review can freeze it." }, { status: 403 });
  }
  const { html } = (await req.json().catch(() => ({}))) as { html?: string };
  if (!html || html.length < 100) return Response.json({ error: "Nothing to freeze." }, { status: 400 });
  if (html.length > 4 * 1024 * 1024) return Response.json({ error: "The page is too large to freeze (4 MB limit)." }, { status: 413 });
  const path = `${id}/frozen-${Date.now()}.html`;
  await d.putSnapshot(path, html);
  const updated = await d.updateReview(id, { mode: "frozen", snapshot_path: path });
  return Response.json({ review: publicReview(updated!, ownerKey) });
}
