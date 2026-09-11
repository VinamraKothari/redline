import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { sanitizeViewports } from "@/lib/viewports";
import { guarded, HttpError, reviewAccess } from "@/lib/auth/server";
import type { Anchor, Comment } from "@/lib/types";

export const runtime = "nodejs";

/**
 * PATCH actions on a comment. Authors may edit/move/retitle/delete their own
 * comments; project admins may do so for anyone; anyone with edit access may
 * resolve threads and react.
 */
export const PATCH = guarded(async (req: NextRequest, ctx: RouteContext<"/api/comments/[id]">) => {
  const { id } = await ctx.params;
  const d = await db();
  const c = await d.getComment(id);
  if (!c) throw new HttpError(404, "That comment no longer exists.");
  const { user, role } = await reviewAccess(c.review_id, "edit");
  const mine = c.author_id === user.id;
  const may = mine || role === "admin";

  const body = (await req.json().catch(() => ({}))) as {
    action: "edit" | "resolve" | "react" | "move" | "title" | "viewports";
    viewports?: { min: number; max: number } | null;
    body?: string;
    title?: string;
    resolved?: boolean;
    emoji?: string;
    anchor?: Anchor;
  };
  const patch: Partial<Comment> = {};

  switch (body.action) {
    case "edit": {
      if (!may) throw new HttpError(403, "You can only edit your own comments.");
      const text = (body.body || "").trim();
      if (!text) throw new HttpError(400, "Write something first.");
      patch.body = text.slice(0, 5000);
      patch.edited_at = new Date().toISOString();
      break;
    }
    case "title": {
      if (c.parent_id) throw new HttpError(400, "Only threads have titles.");
      if (!may) throw new HttpError(403, "You can only retitle your own comments.");
      patch.title = (body.title || "").trim().slice(0, 140) || null;
      break;
    }
    case "resolve": {
      if (c.parent_id) throw new HttpError(400, "Only threads can be resolved.");
      patch.resolved = Boolean(body.resolved);
      break;
    }
    case "react": {
      const emoji = (body.emoji || "").slice(0, 8);
      if (!emoji) throw new HttpError(400, "bad request");
      const reactions = { ...c.reactions };
      const who = new Set(reactions[emoji] || []);
      const me = user.id;
      if (who.has(me)) who.delete(me);
      else who.add(me);
      if (who.size) reactions[emoji] = Array.from(who);
      else delete reactions[emoji];
      patch.reactions = reactions;
      break;
    }
    case "move": {
      if (c.parent_id || !body.anchor) throw new HttpError(400, "bad request");
      if (!may) throw new HttpError(403, "You can only move your own pins.");
      // moving a pin keeps the viewport band it applies to
      patch.anchor = { ...body.anchor, viewports: body.anchor.viewports === undefined ? (c.anchor?.viewports ?? null) : sanitizeViewports(body.anchor.viewports) };
      break;
    }
    case "viewports": {
      if (c.parent_id || !c.anchor) throw new HttpError(400, "bad request");
      if (!may) throw new HttpError(403, "You can only change your own threads.");
      patch.anchor = { ...c.anchor, viewports: sanitizeViewports(body.viewports) };
      break;
    }
    default:
      throw new HttpError(400, "unknown action");
  }

  const updated = await d.updateComment(id, patch);
  return Response.json({ comment: updated });
});

export const DELETE = guarded(async (_req: NextRequest, ctx: RouteContext<"/api/comments/[id]">) => {
  const { id } = await ctx.params;
  const d = await db();
  const c = await d.getComment(id);
  if (!c) return Response.json({ ok: true });
  const { user, role } = await reviewAccess(c.review_id, "edit");
  if (c.author_id !== user.id && role !== "admin") throw new HttpError(403, "You can only delete your own comments.");
  if (c.parent_id) await d.deleteComment(id);
  else await d.deleteThread(id);
  return Response.json({ ok: true });
});
