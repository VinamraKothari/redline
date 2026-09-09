import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, reviewAccess } from "@/lib/auth/server";
import { publicReview } from "@/lib/review";

export const runtime = "nodejs";

const MAX = 600 * 1024;

/** POST image/jpeg body — the reviewer captured a preview of the page. */
export const POST = guarded(async (req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/thumbnail">) => {
  const { id } = await ctx.params;
  const { user, role } = await reviewAccess(id, "edit");
  const ct = req.headers.get("content-type") || "";
  if (!/^image\/(jpeg|png|webp)/.test(ct)) return Response.json({ error: "Send a JPEG, PNG or WebP body." }, { status: 400 });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX) return Response.json({ error: "Preview must be 1 byte – 600 KB." }, { status: 413 });
  const d = await db();
  const url = await d.putThumbnail(id, bytes, ct.split(";")[0]);
  const updated = await d.updateReview(id, { thumbnail_url: url, thumbnail_at: new Date().toISOString() });
  return Response.json({ review: publicReview(updated!, role, user.id) });
});
