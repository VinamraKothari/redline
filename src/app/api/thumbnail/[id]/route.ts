import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, reviewAccess } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serves a page preview from the local adapter (development; Supabase uses its public bucket). */
export const GET = guarded(async (_req: NextRequest, ctx: RouteContext<"/api/thumbnail/[id]">) => {
  const { id } = await ctx.params;
  await reviewAccess(id);
  const t = await (await db()).getThumbnail(id);
  if (!t) return new Response("not found", { status: 404 });
  return new Response(t.bytes as BodyInit, { headers: { "content-type": t.contentType, "cache-control": "private, max-age=300" } });
});
