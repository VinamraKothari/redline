import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { sanitizeViewports } from "@/lib/viewports";
import { guarded, reviewAccess, syncProfile } from "@/lib/auth/server";
import type { Comment } from "@/lib/types";
import { newId } from "@/lib/util";

export const runtime = "nodejs";

export const GET = guarded(async (_req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/comments">) => {
  const { id } = await ctx.params;
  await reviewAccess(id);
  const d = await db();
  return Response.json({ comments: await d.listComments(id) });
});

export const POST = guarded(async (req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/comments">) => {
  const { id } = await ctx.params;
  const { user, review } = await reviewAccess(id, "edit");
  const profile = await syncProfile(user);
  const d = await db();

  const body = (await req.json().catch(() => ({}))) as Partial<Comment>;
  const text = (body.body || "").trim();
  const title = (body.title || "").trim().slice(0, 140) || null;
  if (!text && !(body.attachments && body.attachments.length)) {
    return Response.json({ error: "Write something first." }, { status: 400 });
  }
  if (text.length > 5000) return Response.json({ error: "Comments are limited to 5000 characters." }, { status: 400 });

  const isReply = Boolean(body.parent_id);
  if (isReply) {
    const parent = await d.getComment(body.parent_id!);
    if (!parent || parent.review_id !== id || parent.parent_id) {
      return Response.json({ error: "That thread no longer exists." }, { status: 404 });
    }
  } else if (!body.anchor) {
    return Response.json({ error: "A comment needs a position on the page." }, { status: 400 });
  }

  const c: Comment = {
    id: newId(),
    review_id: id,
    parent_id: isReply ? body.parent_id! : null,
    author_id: user.id,
    author_name: profile.name,
    author_color: profile.color,
    title: isReply ? null : title,
    body: text,
    anchor: isReply ? null : { ...body.anchor!, viewports: sanitizeViewports(body.anchor!.viewports) },
    viewport_width: Number(body.viewport_width) || review.default_viewport,
    resolved: false,
    reactions: {},
    attachments: (body.attachments || []).slice(0, 6),
    edited_at: null,
    created_at: new Date().toISOString(),
  };
  await d.createComment(c);
  return Response.json({ comment: c });
});
