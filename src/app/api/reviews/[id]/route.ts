import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import type { Review } from "@/lib/types";
import { publicReview } from "@/lib/review";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/reviews/[id]">) {
  const { id } = await ctx.params;
  const d = await db();
  const review = await d.getReview(id);
  if (!review) return Response.json({ error: "not found" }, { status: 404 });
  const [comments, shapes] = await Promise.all([d.listComments(id), d.listShapes(id)]);
  return Response.json({
    review: publicReview(review, req.headers.get("x-owner-key")),
    comments,
    shapes,
  });
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/reviews/[id]">) {
  const { id } = await ctx.params;
  const d = await db();
  const review = await d.getReview(id);
  if (!review) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as Partial<Review>;
  const patch: Partial<Review> = {};
  // Title can be set by anyone (it's filled in from the page after load).
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim().slice(0, 200);
  // Owner-only fields.
  const isOwner = req.headers.get("x-owner-key") === review.owner_key;
  if (isOwner) {
    if (typeof body.default_viewport === "number") patch.default_viewport = body.default_viewport;
    if (body.mode === "live" && review.mode === "frozen") {
      patch.mode = "live";
      patch.snapshot_path = null;
    }
  }
  const updated = await d.updateReview(id, patch);
  return Response.json({ review: publicReview(updated!, req.headers.get("x-owner-key")) });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/reviews/[id]">) {
  const { id } = await ctx.params;
  const d = await db();
  const review = await d.getReview(id);
  if (!review) return Response.json({ error: "not found" }, { status: 404 });
  if (req.headers.get("x-owner-key") !== review.owner_key) {
    return Response.json({ error: "Only the person who created this review can delete it." }, { status: 403 });
  }
  await d.deleteReview(id);
  return Response.json({ ok: true });
}
