import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, reviewAccess } from "@/lib/auth/server";
import { publicReview } from "@/lib/review";

export const runtime = "nodejs";

/** POST { html } — store a snapshot of the rendered page and switch the review to it (edit role). */
export const POST = guarded(async (req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/freeze">) => {
  const { id } = await ctx.params;
  const { user, role } = await reviewAccess(id, "edit");
  const { html } = (await req.json().catch(() => ({}))) as { html?: string };
  if (!html || html.length < 100) return Response.json({ error: "Nothing to freeze." }, { status: 400 });
  if (html.length > 4 * 1024 * 1024) return Response.json({ error: "The page is too large to freeze (4 MB limit)." }, { status: 413 });
  const d = await db();
  const path = `${id}/frozen-${Date.now()}.html`;
  await d.putSnapshot(path, html);
  const updated = await d.updateReview(id, { mode: "frozen", snapshot_path: path });
  return Response.json({ review: publicReview(updated!, role, user.id) });
});
