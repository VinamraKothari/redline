import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, reviewAccess } from "@/lib/auth/server";
import { publicReview } from "@/lib/review";

export const runtime = "nodejs";

/** POST { html } — store a snapshot of the rendered page and switch the review to it (edit role). */
export const POST = guarded(async (req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/freeze">) => {
  const { id } = await ctx.params;
  const { user, role } = await reviewAccess(id, "edit");
  let html: string | undefined;
  try {
    if (req.headers.get("x-redline-gzip") === "1") {
      const { gunzipSync } = await import("node:zlib");
      html = (JSON.parse(gunzipSync(Buffer.from(await req.arrayBuffer())).toString("utf8")) as { html?: string }).html;
    } else html = ((await req.json()) as { html?: string }).html;
  } catch {
    html = undefined;
  }
  if (!html || html.length < 100) return Response.json({ error: "Nothing to freeze." }, { status: 400 });
  if (html.length > 12 * 1024 * 1024) return Response.json({ error: "The page is too large to freeze (12 MB limit)." }, { status: 413 });
  const d = await db();
  const path = `${id}/frozen-${Date.now()}.html`;
  await d.putSnapshot(path, html);
  const updated = await d.updateReview(id, { mode: "frozen", snapshot_path: path });
  return Response.json({ review: publicReview(updated!, role, user.id) });
});
