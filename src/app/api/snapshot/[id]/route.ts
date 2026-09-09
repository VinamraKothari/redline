import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, reviewAccess } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serves a frozen or uploaded HTML snapshot for a review (members only). */
export const GET = guarded(async (_req: NextRequest, ctx: RouteContext<"/api/snapshot/[id]">) => {
  const { id } = await ctx.params;
  const { review } = await reviewAccess(id);
  if (!review.snapshot_path) return new Response("not found", { status: 404 });
  const d = await db();
  const html = await d.getSnapshot(review.snapshot_path);
  if (html == null) return new Response("snapshot missing", { status: 404 });
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, max-age=60", "content-security-policy": "frame-ancestors 'self'" },
  });
});
