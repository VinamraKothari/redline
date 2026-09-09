import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, reviewAccess } from "@/lib/auth/server";
import { publicReview } from "@/lib/review";
import { toJiraCsv, toMarkdown } from "@/lib/export";

export const runtime = "nodejs";

/** GET ?format=jira|md — downloadable export of all comments. */
export const GET = guarded(async (req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/export">) => {
  const { id } = await ctx.params;
  const { user, review, role } = await reviewAccess(id);
  const d = await db();
  const comments = await d.listComments(id);
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;
  const format = req.nextUrl.searchParams.get("format") || "jira";
  const safe = review.title.replace(/[^\w.-]+/g, "-").slice(0, 60) || "redline";
  const pub = publicReview(review, role, user.id);

  if (format === "md") {
    return new Response(toMarkdown(pub, comments, origin), {
      headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${safe}-feedback.md"` },
    });
  }
  return new Response(toJiraCsv(pub, comments, origin), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${safe}-jira.csv"` },
  });
});
