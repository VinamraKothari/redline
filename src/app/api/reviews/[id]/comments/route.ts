import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import type { Comment } from "@/lib/types";
import { colorFor, newId } from "@/lib/util";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/comments">) {
  const { id } = await ctx.params;
  const d = await db();
  return Response.json({ comments: await d.listComments(id) });
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/comments">) {
  const { id } = await ctx.params;
  const d = await db();
  const review = await d.getReview(id);
  if (!review) return Response.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Partial<Comment>;
  const author = (body.author_name || "").trim().slice(0, 60);
  const text = (body.body || "").trim();
  if (!author) return Response.json({ error: "Add your name first." }, { status: 400 });
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
    author_name: author,
    author_color: body.author_color || colorFor(author),
    body: text,
    anchor: isReply ? null : body.anchor!,
    viewport_width: Number(body.viewport_width) || review.default_viewport,
    resolved: false,
    reactions: {},
    attachments: (body.attachments || []).slice(0, 6),
    edited_at: null,
    created_at: new Date().toISOString(),
  };
  await d.createComment(c);
  return Response.json({ comment: c });
}
