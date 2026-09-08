import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import type { Shape } from "@/lib/types";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/shapes/[id]">) {
  const { id } = await ctx.params;
  const d = await db();
  const patch = (await req.json().catch(() => ({}))) as Partial<Shape>;
  const allowed: Partial<Shape> = {};
  if (patch.data) allowed.data = patch.data;
  if (patch.style) allowed.style = patch.style;
  if (typeof patch.z === "number") allowed.z = patch.z;
  const shape = await d.updateShape(id, allowed);
  if (!shape) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ shape });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/shapes/[id]">) {
  const { id } = await ctx.params;
  const d = await db();
  await d.deleteShape(id);
  return Response.json({ ok: true });
}
