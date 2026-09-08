import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import type { Shape } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/shapes">) {
  const { id } = await ctx.params;
  const d = await db();
  return Response.json({ shapes: await d.listShapes(id) });
}

/** Upsert one shape (client generates ids so drawing feels instant). */
export async function PUT(req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/shapes">) {
  const { id } = await ctx.params;
  const d = await db();
  const review = await d.getReview(id);
  if (!review) return Response.json({ error: "not found" }, { status: 404 });
  const s = (await req.json().catch(() => null)) as Shape | null;
  if (!s || !s.id || !s.type || !s.data) return Response.json({ error: "bad shape" }, { status: 400 });
  const json = JSON.stringify(s.data);
  if (json.length > 200_000) return Response.json({ error: "That stroke is too large." }, { status: 413 });
  const now = new Date().toISOString();
  const shape: Shape = {
    ...s,
    review_id: id,
    author_name: (s.author_name || "Anonymous").slice(0, 60),
    created_at: s.created_at || now,
    updated_at: now,
  };
  await d.upsertShape(shape);
  return Response.json({ shape });
}

/** Clear shapes for a viewport (or all with ?all=1). */
export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/shapes">) {
  const { id } = await ctx.params;
  const d = await db();
  const all = req.nextUrl.searchParams.get("all") === "1";
  const vp = Number(req.nextUrl.searchParams.get("viewport"));
  await d.deleteShapes(id, all || !vp ? null : vp);
  return Response.json({ ok: true });
}
