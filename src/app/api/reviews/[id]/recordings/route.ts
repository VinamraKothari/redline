import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, HttpError, reviewAccess } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RECORDING_BYTES = 60 * 1024 * 1024;

/**
 * POST { type, size } → where to PUT a screen recording and the public URL it
 * gets. The browser uploads straight to storage: recordings are far bigger
 * than the request body a serverless function accepts.
 */
export const POST = guarded(async (req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/recordings">) => {
  const { id } = await ctx.params;
  await reviewAccess(id, "edit");
  const body = (await req.json().catch(() => ({}))) as { type?: string; size?: number };
  const type = String(body.type || "");
  const size = Number(body.size) || 0;
  const ext = /^video\/mp4/.test(type) ? "mp4" : /^video\/webm/.test(type) ? "webm" : null;
  if (!ext) throw new HttpError(400, "Only WebM or MP4 recordings can be attached.");
  if (size <= 0) throw new HttpError(400, "Empty recording.");
  if (size > MAX_RECORDING_BYTES) throw new HttpError(413, "Recordings must be under 60 MB — keep them under two minutes.");
  const rid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const target = await (await db()).createPublicUpload(`recordings/${id}/${rid}.${ext}`, type.split(";")[0]);
  return Response.json({ id: rid, ...target });
});
