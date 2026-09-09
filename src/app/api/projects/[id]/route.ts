import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, projectAccess } from "@/lib/auth/server";
import { publicReview } from "@/lib/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A project with its reviews, members and (for admins) pending invites. */
export const GET = guarded(async (_req: NextRequest, ctx: RouteContext<"/api/projects/[id]">) => {
  const { id } = await ctx.params;
  const { user, role } = await projectAccess(id);
  const d = await db();
  const project = await d.getProject(id);
  if (!project) return Response.json({ error: "not found" }, { status: 404 });
  const [reviews, members, invites] = await Promise.all([d.listReviews(id), d.listMembers(id), role === "admin" ? d.listInvites(id) : Promise.resolve([])]);
  return Response.json({
    project: { ...project, role },
    reviews: reviews.map((r) => publicReview(r, role, user.id)),
    members,
    invites,
  });
});

/** Rename (admin). */
export const PATCH = guarded(async (req: NextRequest, ctx: RouteContext<"/api/projects/[id]">) => {
  const { id } = await ctx.params;
  await projectAccess(id, "admin");
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const name = (body.name || "").trim().slice(0, 80);
  if (!name) return Response.json({ error: "Give the project a name." }, { status: 400 });
  const d = await db();
  const project = await d.updateProject(id, { name });
  return Response.json({ project });
});

/** Delete the project and everything in it (admin). */
export const DELETE = guarded(async (_req: NextRequest, ctx: RouteContext<"/api/projects/[id]">) => {
  const { id } = await ctx.params;
  await projectAccess(id, "admin");
  const d = await db();
  await d.deleteProject(id);
  return Response.json({ ok: true });
});
