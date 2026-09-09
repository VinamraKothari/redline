import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, reviewAccess, syncProfile } from "@/lib/auth/server";
import type { Shape } from "@/lib/types";

export const runtime = "nodejs";

export const GET = guarded(async (_req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/shapes">) => {
  const { id } = await ctx.params;
  await reviewAccess(id);
  const d = await db();
  return Response.json({ shapes: await d.listShapes(id) });
});

/** Upsert one shape (client generates ids so drawing feels instant). */
export const PUT = guarded(async (req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/shapes">) => {
  const { id } = await ctx.params;
  const { user, role } = await reviewAccess(id, "edit");
  const profile = await syncProfile(user);
  const d = await db();
  const s = (await req.json().catch(() => null)) as Shape | null;
  if (!s || !s.id || !s.type || !s.data) return Response.json({ error: "bad shape" }, { status: 400 });
  const json = JSON.stringify(s.data);
  if (json.length > 200_000) return Response.json({ error: "That stroke is too large." }, { status: 413 });
  const existing = await d.getShape(s.id);
  if (existing && existing.author_id !== user.id && role !== "admin") {
    return Response.json({ error: "You can only change your own drawings." }, { status: 403 });
  }
  const now = new Date().toISOString();
  const shape: Shape = {
    ...s,
    review_id: id,
    author_id: existing?.author_id ?? user.id,
    author_name: existing?.author_name ?? profile.name,
    created_at: existing?.created_at || s.created_at || now,
    updated_at: now,
  };
  await d.upsertShape(shape);
  return Response.json({ shape });
});

/** Clear shapes for a viewport (or all with ?all=1) — admins only. */
export const DELETE = guarded(async (req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/shapes">) => {
  const { id } = await ctx.params;
  await reviewAccess(id, "admin");
  const d = await db();
  const all = req.nextUrl.searchParams.get("all") === "1";
  const vp = Number(req.nextUrl.searchParams.get("viewport"));
  await d.deleteShapes(id, all || !vp ? null : vp);
  return Response.json({ ok: true });
});
