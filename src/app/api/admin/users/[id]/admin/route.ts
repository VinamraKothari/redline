import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, HttpError } from "@/lib/auth/server";
import { adminEmails, requireAdmin } from "@/lib/admin/auth";
import { audit } from "@/lib/admin/grants";
import { userDetail } from "@/lib/admin/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { admin: boolean } — make someone an admin, or stop them being one. Never yourself, never the last one. */
export const POST = guarded(async (req: NextRequest, ctx: RouteContext<"/api/admin/users/[id]/admin">) => {
  const { user } = await requireAdmin();
  const { id } = await ctx.params;
  const d = await db();
  const target = await d.getProfile(id);
  if (!target) throw new HttpError(404, "No account with that id.");
  const body = (await req.json().catch(() => ({}))) as { admin?: unknown };
  if (typeof body.admin !== "boolean") throw new HttpError(400, "Send { admin: true | false }.");
  if (!body.admin) {
    if (id === user.id) throw new HttpError(400, "You can't remove your own admin access — ask another admin to.");
    if (adminEmails().has(target.email.toLowerCase())) throw new HttpError(400, "This account is listed in REDLINE_ADMIN_EMAILS; remove it from the environment variable instead.");
    const admins = await d.listAdmins();
    if (admins.length <= 1 && admins.some((a) => a.id === id)) throw new HttpError(400, "Redline needs at least one admin — make someone else admin first.");
  }
  await d.setAdmin(id, body.admin, body.admin ? `by ${user.email}` : undefined);
  await audit(user.id, body.admin ? "admin.grant" : "admin.revoke", id, { email: target.email });
  return Response.json(await userDetail(id));
});
