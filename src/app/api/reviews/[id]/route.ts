import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, reviewAccess } from "@/lib/auth/server";
import type { Review } from "@/lib/types";
import { publicReview } from "@/lib/review";

export const runtime = "nodejs";

export const GET = guarded(async (_req: NextRequest, ctx: RouteContext<"/api/reviews/[id]">) => {
  const { id } = await ctx.params;
  const { user, review, role } = await reviewAccess(id);
  const d = await db();
  const [comments, shapes] = await Promise.all([d.listComments(id), d.listShapes(id)]);
  return Response.json({ review: publicReview(review, role, user.id), comments, shapes });
});

export const PATCH = guarded(async (req: NextRequest, ctx: RouteContext<"/api/reviews/[id]">) => {
  const { id } = await ctx.params;
  const { user, review, role } = await reviewAccess(id, "edit");
  const body = (await req.json().catch(() => ({}))) as Partial<Review>;
  const patch: Partial<Review> = {};
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim().slice(0, 200);
  if (typeof body.default_viewport === "number") patch.default_viewport = body.default_viewport;
  if (body.mode === "live" && review.mode === "frozen") {
    patch.mode = "live";
    patch.snapshot_path = null;
  }
  const d = await db();
  // Move to another project: needs edit access there too.
  if (typeof body.project_id === "string" && body.project_id !== review.project_id) {
    const targetRole = await d.memberRole(body.project_id, user.id);
    if (!targetRole || targetRole === "view") return Response.json({ error: "You need edit access to the project you're moving this page to." }, { status: 403 });
    patch.project_id = body.project_id;
    await d.updateProject(body.project_id, {});
  }
  const updated = await d.updateReview(id, patch);
  if (review.project_id) await d.updateProject(review.project_id, {});
  return Response.json({ review: publicReview(updated!, patch.project_id ? (await d.memberRole(patch.project_id, user.id)) || role : role, user.id) });
});

/** Delete: project admins, or whoever created the review. */
export const DELETE = guarded(async (_req: NextRequest, ctx: RouteContext<"/api/reviews/[id]">) => {
  const { id } = await ctx.params;
  const { user, review, role } = await reviewAccess(id);
  if (role !== "admin" && review.created_by_id !== user.id) {
    return Response.json({ error: "Only project admins or the person who created this review can delete it." }, { status: 403 });
  }
  const d = await db();
  await d.deleteReview(id);
  return Response.json({ ok: true });
});
