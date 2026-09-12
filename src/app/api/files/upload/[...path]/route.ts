import type { NextRequest } from "next/server";
import { db, hasSupabase } from "@/lib/db";
import { guarded, requireUser } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Receives direct uploads for the local adapter (development only; Supabase takes them itself). */
export const PUT = guarded(async (req: NextRequest, ctx: RouteContext<"/api/files/upload/[...path]">) => {
  if (hasSupabase() || process.env.VERCEL) return new Response("not found", { status: 404 });
  await requireUser();
  const { path } = await ctx.params;
  const p = path.join("/");
  if (!/^(recordings|attachments)\/[\w-]+\/[\w.-]+$/.test(p)) return new Response("bad path", { status: 400 });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > 60 * 1024 * 1024) return new Response("too large", { status: 413 });
  const url = await (await db()).putPublicFile(p, bytes, req.headers.get("content-type") || "application/octet-stream");
  return Response.json({ url });
});
