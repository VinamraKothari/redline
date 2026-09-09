import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, HttpError, reviewAccess } from "@/lib/auth/server";
import type { Shape } from "@/lib/types";

export const runtime = "nodejs";

async function own(id: string) {
  const d = await db();
  const shape = await d.getShape(id);
  if (!shape) throw new HttpError(404, "That drawing no longer exists.");
  const { user, role } = await reviewAccess(shape.review_id, "edit");
  if (shape.author_id !== user.id && role !== "admin") throw new HttpError(403, "You can only change your own drawings.");
  return { d, shape };
}

export const PATCH = guarded(async (req: NextRequest, ctx: RouteContext<"/api/shapes/[id]">) => {
  const { id } = await ctx.params;
  const { d } = await own(id);
  const patch = (await req.json().catch(() => ({}))) as Partial<Shape>;
  const allowed: Partial<Shape> = {};
  if (patch.data) allowed.data = patch.data;
  if (patch.style) allowed.style = patch.style;
  if (typeof patch.z === "number") allowed.z = patch.z;
  const shape = await d.updateShape(id, allowed);
  return Response.json({ shape });
});

export const DELETE = guarded(async (_req: NextRequest, ctx: RouteContext<"/api/shapes/[id]">) => {
  const { id } = await ctx.params;
  const d = await db();
  if (!(await d.getShape(id))) return Response.json({ ok: true });
  await own(id);
  await d.deleteShape(id);
  return Response.json({ ok: true });
});
