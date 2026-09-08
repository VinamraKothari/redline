import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { publicReview } from "@/lib/review";
import { toJiraCsv, toMarkdown } from "@/lib/export";

export const runtime = "nodejs";

/** GET ?format=jira|md — downloadable export of all comments. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/export">) {
  const { id } = await ctx.params;
  const d = await db();
  const review = await d.getReview(id);
  if (!review) return new Response("not found", { status: 404 });
  const comments = await d.listComments(id);
  const origin = req.nextUrl.origin;
  const format = req.nextUrl.searchParams.get("format") || "jira";
  const safe = review.title.replace(/[^\w.-]+/g, "-").slice(0, 60) || "redline";

  if (format === "md") {
    return new Response(toMarkdown(publicReview(review), comments, origin), {
      headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${safe}-feedback.md"` },
    });
  }
  return new Response(toJiraCsv(publicReview(review), comments, origin), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${safe}-jira.csv"` },
  });
}
