import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, reviewAccess } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The signed-in user's read state for a review's threads: thread id → when it
 * was last read (ISO), or "!" + that time for a thread deliberately marked unread. Synced
 * across devices; the browser keeps a local copy too.
 */
export const GET = guarded(async (_req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/reads">) => {
  const { id } = await ctx.params;
  const { user } = await reviewAccess(id, "view");
  const d = await db();
  return Response.json({ reads: await d.getReads(user.id, id) });
});

export const PUT = guarded(async (req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/reads">) => {
  const { id } = await ctx.params;
  const { user } = await reviewAccess(id, "view");
  const body = (await req.json().catch(() => ({}))) as { reads?: Record<string, unknown> };
  const reads: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.reads ?? {})) {
    if (typeof v === "string" && k.length <= 64 && v.length <= 40) reads[k] = v;
    if (Object.keys(reads).length >= 5000) break;
  }
  const d = await db();
  // merge with what other devices wrote: the later timestamp wins per thread
  const current = await d.getReads(user.id, id);
  const merged = { ...current };
  const t = (v: string) => v.replace(/^!/, "");
  for (const [k, v] of Object.entries(reads)) if (!(k in merged) || t(v) > t(merged[k])) merged[k] = v;
  await d.putReads(user.id, id, merged);
  return Response.json({ reads: merged });
});
