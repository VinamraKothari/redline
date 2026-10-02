import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, HttpError } from "@/lib/auth/server";
import { requireAdmin } from "@/lib/admin/auth";
import { grantPlan, isPlanId, parseMonths } from "@/lib/admin/grants";
import { userDetail } from "@/lib/admin/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { plan: "free"|"pro"|"team", months?: number|null, note, mode?: "replace"|"extend" }
 * — a manual grant (`months` empty = no end date), an extension of the running
 * grant by `months`, or Free to take a grant away. Rows Stripe manages are
 * refused with 409 and a link to the customer in Stripe.
 */
export const POST = guarded(async (req: NextRequest, ctx: RouteContext<"/api/admin/users/[id]/plan">) => {
  const { user } = await requireAdmin();
  const { id } = await ctx.params;
  if (!(await (await db()).getProfile(id))) throw new HttpError(404, "No account with that id.");
  const body = (await req.json().catch(() => ({}))) as { plan?: unknown; months?: unknown; note?: unknown; mode?: unknown };
  if (!isPlanId(body.plan)) throw new HttpError(400, "Pick Free, Pro or Team.");
  const months = body.plan === "free" ? null : parseMonths(body.months);
  const note = String(body.note ?? "").trim().slice(0, 200);
  await grantPlan({ targetId: id, plan: body.plan, months, note, actorId: user.id, mode: body.mode === "extend" ? "extend" : "replace" });
  return Response.json(await userDetail(id));
});
