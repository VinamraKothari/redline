import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import type { Anchor, Comment } from "@/lib/types";

export const runtime = "nodejs";

/**
 * PATCH actions on a comment. Identity is name-based (no login), so the
 * server enforces only what it can: the author name must match for edits and
 * deletes, unless the caller holds the review's owner key.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/comments/[id]">) {
  const { id } = await ctx.params;
  const d = await db();
  const c = await d.getComment(id);
  if (!c) return Response.json({ error: "not found" }, { status: 404 });
  const review = await d.getReview(c.review_id);
  const isOwner = Boolean(review && req.headers.get("x-owner-key") === review.owner_key);

  const body = (await req.json().catch(() => ({}))) as {
    action: "edit" | "resolve" | "react" | "move";
    actor: string;
    body?: string;
    resolved?: boolean;
    emoji?: string;
    anchor?: Anchor;
  };
  const actor = (body.actor || "").trim();
  const patch: Partial<Comment> = {};

  switch (body.action) {
    case "edit": {
      if (actor !== c.author_name && !isOwner) return Response.json({ error: "You can only edit your own comments." }, { status: 403 });
      const text = (body.body || "").trim();
      if (!text) return Response.json({ error: "Write something first." }, { status: 400 });
      patch.body = text.slice(0, 5000);
      patch.edited_at = new Date().toISOString();
      break;
    }
    case "resolve": {
      if (c.parent_id) return Response.json({ error: "Only threads can be resolved." }, { status: 400 });
      patch.resolved = Boolean(body.resolved);
      break;
    }
    case "react": {
      const emoji = (body.emoji || "").slice(0, 8);
      if (!emoji || !actor) return Response.json({ error: "bad request" }, { status: 400 });
      const reactions = { ...c.reactions };
      const who = new Set(reactions[emoji] || []);
      if (who.has(actor)) who.delete(actor);
      else who.add(actor);
      if (who.size) reactions[emoji] = Array.from(who);
      else delete reactions[emoji];
      patch.reactions = reactions;
      break;
    }
    case "move": {
      if (c.parent_id || !body.anchor) return Response.json({ error: "bad request" }, { status: 400 });
      if (actor !== c.author_name && !isOwner) return Response.json({ error: "You can only move your own pins." }, { status: 403 });
      patch.anchor = body.anchor;
      break;
    }
    default:
      return Response.json({ error: "unknown action" }, { status: 400 });
  }

  const updated = await d.updateComment(id, patch);
  return Response.json({ comment: updated });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/comments/[id]">) {
  const { id } = await ctx.params;
  const d = await db();
  const c = await d.getComment(id);
  if (!c) return Response.json({ ok: true });
  const review = await d.getReview(c.review_id);
  const isOwner = Boolean(review && req.headers.get("x-owner-key") === review.owner_key);
  const actor = (req.headers.get("x-actor") || "").trim();
  if (actor !== c.author_name && !isOwner) {
    return Response.json({ error: "You can only delete your own comments." }, { status: 403 });
  }
  if (c.parent_id) await d.deleteComment(id);
  else await d.deleteThread(id);
  return Response.json({ ok: true });
}
