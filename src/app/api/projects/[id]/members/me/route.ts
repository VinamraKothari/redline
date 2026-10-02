import { db } from "@/lib/db";
import { guarded, HttpError, projectAccess } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Leave a project you were invited to. The owner can't leave what they own —
 * the project would be left without the account its plan is judged by — so
 * they are pointed at deleting it instead; and a project always keeps at
 * least one admin.
 */
export const DELETE = guarded(async (_req: Request, ctx: RouteContext<"/api/projects/[id]/members/me">) => {
  const { id } = await ctx.params;
  const { user, role } = await projectAccess(id);
  const d = await db();
  const project = await d.getProject(id);
  if (project?.created_by === user.id) throw new HttpError(400, "You own this project. Delete it instead of leaving it.");
  if (role === "admin") {
    const admins = (await d.listMembers(id)).filter((m) => m.role === "admin");
    if (admins.length <= 1) throw new HttpError(400, "A project needs at least one admin — make someone else admin first.");
  }
  await d.removeMember(id, user.id);
  return Response.json({ ok: true });
});
