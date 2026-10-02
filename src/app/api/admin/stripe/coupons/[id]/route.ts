import type { NextRequest } from "next/server";
import { guarded, HttpError } from "@/lib/auth/server";
import { requireAdmin } from "@/lib/admin/auth";
import { audit } from "@/lib/admin/grants";
import { PROMOS_UNAVAILABLE_NOTE, promosAvailable, setPromoActive } from "@/lib/admin/stripe-promos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { active: boolean } — switch a Stripe promotion code off or on. */
export const POST = guarded(async (req: NextRequest, ctx: RouteContext<"/api/admin/stripe/coupons/[id]">) => {
  const { user } = await requireAdmin();
  if (!promosAvailable()) throw new HttpError(503, PROMOS_UNAVAILABLE_NOTE);
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { active?: unknown };
  if (typeof body.active !== "boolean") throw new HttpError(400, "Send { active: true | false }.");
  const promo = await setPromoActive(id, body.active);
  await audit(user.id, body.active ? "promo.enable" : "promo.disable", null, { id, code: promo.code });
  return Response.json({ promo });
});
