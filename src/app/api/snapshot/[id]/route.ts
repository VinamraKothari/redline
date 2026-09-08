import type { NextRequest } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serves a frozen or uploaded HTML snapshot for a review. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/snapshot/[id]">) {
  const { id } = await ctx.params;
  const d = await db();
  const review = await d.getReview(id);
  if (!review || !review.snapshot_path) return new Response("not found", { status: 404 });
  const html = await d.getSnapshot(review.snapshot_path);
  if (html == null) return new Response("snapshot missing", { status: 404 });
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, max-age=60",
      "content-security-policy": "frame-ancestors 'self'",
    },
  });
}
