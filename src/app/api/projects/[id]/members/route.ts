import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, projectAccess } from "@/lib/auth/server";
import type { ProjectInvite, Role } from "@/lib/types";
import { newId } from "@/lib/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES: Role[] = ["view", "edit", "admin"];
const isRole = (r: unknown): r is Role => typeof r === "string" && (ROLES as string[]).includes(r);

/** Invite by e-mail (admin). Existing accounts join immediately; others when they first sign in. */
export const POST = guarded(async (req: NextRequest, ctx: RouteContext<"/api/projects/[id]/members">) => {
  const { id } = await ctx.params;
  const { user } = await projectAccess(id, "admin");
  const body = (await req.json().catch(() => ({}))) as { email?: string; role?: Role };
  const email = (body.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "Enter a valid e-mail address." }, { status: 400 });
  const role = isRole(body.role) ? body.role : "edit";
  const d = await db();
  const invite: ProjectInvite = { id: newId(), project_id: id, email, role, invited_by: user.id, created_at: new Date().toISOString(), accepted_at: null };
  await d.upsertInvite(invite);
  // If that Google account already exists, membership applies right away.
  const members = await d.listMembers(id);
  const known = members.find((m) => m.profile?.email?.toLowerCase() === email);
  if (known) {
    await d.setMember(id, known.user_id, role);
    await d.deleteInvite(invite.id);
    return Response.json({ member: { ...known, role }, invite: null });
  }
  return Response.json({ member: null, invite });
});

/** Change a member's role (admin). */
export const PATCH = guarded(async (req: NextRequest, ctx: RouteContext<"/api/projects/[id]/members">) => {
  const { id } = await ctx.params;
  const { user } = await projectAccess(id, "admin");
  const body = (await req.json().catch(() => ({}))) as { user_id?: string; role?: Role };
  if (!body.user_id || !isRole(body.role)) return Response.json({ error: "bad request" }, { status: 400 });
  const d = await db();
  if (body.user_id === user.id && body.role !== "admin") {
    const admins = (await d.listMembers(id)).filter((m) => m.role === "admin");
    if (admins.length <= 1) return Response.json({ error: "A project needs at least one admin." }, { status: 400 });
  }
  await d.setMember(id, body.user_id, body.role);
  return Response.json({ ok: true });
});

/** Remove a member (admin, or yourself) or cancel an invite (admin). */
export const DELETE = guarded(async (req: NextRequest, ctx: RouteContext<"/api/projects/[id]/members">) => {
  const { id } = await ctx.params;
  const userId = req.nextUrl.searchParams.get("user_id");
  const inviteId = req.nextUrl.searchParams.get("invite");
  const d = await db();
  if (inviteId) {
    await projectAccess(id, "admin");
    await d.deleteInvite(inviteId);
    return Response.json({ ok: true });
  }
  if (!userId) return Response.json({ error: "bad request" }, { status: 400 });
  const { user, role } = await projectAccess(id);
  if (userId !== user.id && role !== "admin") return Response.json({ error: "Only project admins can remove members." }, { status: 403 });
  const admins = (await d.listMembers(id)).filter((m) => m.role === "admin");
  if (admins.length <= 1 && admins[0]?.user_id === userId) {
    return Response.json({ error: "A project needs at least one admin — make someone else admin first." }, { status: 400 });
  }
  await d.removeMember(id, userId);
  return Response.json({ ok: true });
});
