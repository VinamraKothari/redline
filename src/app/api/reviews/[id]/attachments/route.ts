import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, HttpError, reviewAccess } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX = 4 * 1024 * 1024;

/**
 * POST image body → stored file. Comments then carry a URL instead of the
 * image itself, which keeps comment payloads small (Vercel refuses request
 * bodies over 4.5 MB, and every poll used to re-download every inline image).
 */
export const POST = guarded(async (req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/attachments">) => {
  const { id } = await ctx.params;
  await reviewAccess(id, "edit");
  const ct = (req.headers.get("content-type") || "").split(";")[0].trim();
  if (!/^image\/(jpeg|png|webp|gif)$/.test(ct)) throw new HttpError(400, "Only JPEG, PNG, WebP and GIF images can be attached.");
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.byteLength) throw new HttpError(400, "Empty image.");
  if (bytes.byteLength > MAX) throw new HttpError(413, "Images must be under 4 MB.");
  const ext = ct === "image/png" ? "png" : ct === "image/webp" ? "webp" : ct === "image/gif" ? "gif" : "jpg";
  const aid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const url = await (await db()).putPublicFile(`attachments/${id}/${aid}.${ext}`, bytes, ct);
  return Response.json({ id: aid, url });
});
