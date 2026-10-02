import type { NextRequest } from "next/server";
import { guarded, HttpError } from "@/lib/auth/server";
import { requireAdmin } from "@/lib/admin/auth";
import { audit } from "@/lib/admin/grants";
import { createPromo, listPromos, PROMOS_UNAVAILABLE_NOTE, promosAvailable, type NewPromo } from "@/lib/admin/stripe-promos";
import type { PromoList } from "@/lib/admin/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stripe promotion codes with their coupons; an empty list and a note when Stripe isn't connected. */
export const GET = guarded(async () => {
  await requireAdmin();
  const body: PromoList = promosAvailable() ? { available: true, note: null, promos: await listPromos() } : { available: false, note: PROMOS_UNAVAILABLE_NOTE, promos: [] };
  return Response.json(body);
});

/** POST { name, code, percent_off | amount_off, duration, duration_in_months?, max_redemptions?, expires_at? } → the new promotion code. */
export const POST = guarded(async (req: NextRequest) => {
  const { user } = await requireAdmin();
  if (!promosAvailable()) throw new HttpError(503, PROMOS_UNAVAILABLE_NOTE);
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));
  const duration = b.duration === "repeating" || b.duration === "forever" ? b.duration : "once";
  const input: NewPromo = {
    name: String(b.name ?? ""),
    code: String(b.code ?? ""),
    percent_off: num(b.percent_off),
    amount_off: num(b.amount_off),
    duration,
    duration_in_months: num(b.duration_in_months),
    max_redemptions: num(b.max_redemptions),
    expires_at: b.expires_at ? String(b.expires_at) : null,
  };
  const promo = await createPromo(input);
  await audit(user.id, "promo.create", null, { id: promo.id, code: promo.code, coupon: promo.coupon.id, name: promo.coupon.name, percent_off: promo.coupon.percent_off, amount_off: promo.coupon.amount_off, duration: promo.coupon.duration, duration_in_months: promo.coupon.duration_in_months, max_redemptions: promo.max_redemptions, expires_at: promo.expires_at });
  return Response.json({ promo });
});
