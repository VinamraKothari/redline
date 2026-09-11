import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, requireUser } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serves files stored by the local adapter (development only; Supabase serves its own buckets). */
export const GET = guarded(async (_req: NextRequest, ctx: RouteContext<"/api/files/[kind]/[...path]">) => {
  const { kind, path } = await ctx.params;
  if (kind !== "public" && kind !== "private") return new Response("not found", { status: 404 });
  if (kind === "private") await requireUser();
  const f = await (await db()).getFile(kind, path.join("/"));
  if (!f) return new Response("not found", { status: 404 });
  return new Response(f.bytes as BodyInit, { headers: { "content-type": f.contentType, "cache-control": kind === "public" ? "public, max-age=31536000" : "private, max-age=300" } });
});
