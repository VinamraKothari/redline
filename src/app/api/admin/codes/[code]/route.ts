import type { NextRequest } from "next/server";
import { guarded, HttpError } from "@/lib/auth/server";
import { requireAdmin } from "@/lib/admin/auth";
import { setCodeActive } from "@/lib/admin/grants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { active: boolean } — switch a code off (or back on). Redemptions already made are untouched. */
export const POST = guarded(async (req: NextRequest, ctx: RouteContext<"/api/admin/codes/[code]">) => {
  const { user } = await requireAdmin();
  const { code } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { active?: unknown };
  if (typeof body.active !== "boolean") throw new HttpError(400, "Send { active: true | false }.");
  return Response.json({ code: await setCodeActive(code, body.active, user.id) });
});
