import type { NextRequest } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public image URL for a comment attachment, so that Jira's CSV importer can
 * download it. Deliberately unauthenticated: the URL is unguessable (two
 * random ids) and only ever exposes the one image it names.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/attachments/[comment]/[att]">) {
  const { comment, att } = await ctx.params;
  const d = await db();
  const c = await d.getComment(comment);
  const a = c?.attachments?.find((x) => x.id === att);
  if (!a) return new Response("not found", { status: 404 });
  const m = a.url.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/);
  if (!m) return Response.redirect(a.url, 302);
  const bytes = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");
  const ext = m[1] === "image/png" ? "png" : m[1] === "image/webp" ? "webp" : "jpg";
  return new Response(bytes, {
    headers: {
      "content-type": m[1],
      "content-disposition": `inline; filename="${(a.name || "image").replace(/[^\w.-]+/g, "-").replace(/\.[^.]+$/, "")}.${ext}"`,
      "cache-control": "public, max-age=86400",
    },
  });
}
