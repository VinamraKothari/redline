import type Stripe from "stripe";
import { HttpError } from "@/lib/auth/server";
import { billingFakeEnabled } from "@/lib/billing/fake";
import { CURRENCY } from "@/lib/billing/plans";
import { getStripe, stripeEnabled } from "@/lib/billing/stripe";

/**
 * Stripe promotion codes — discounts on a paid subscription, as opposed to
 * the grant codes in grants.ts, which give a plan away without a card. A
 * promotion code is the customer-facing string ("LAUNCH20") that applies a
 * coupon (the actual discount) at checkout; checkout already accepts them
 * (`allow_promotion_codes`), so creating one here is all it takes.
 */

export interface Promo {
  id: string;
  code: string;
  active: boolean;
  times_redeemed: number;
  max_redemptions: number | null;
  expires_at: string | null;
  created: string;
  coupon: {
    id: string;
    name: string | null;
    percent_off: number | null;
    /** cents */
    amount_off: number | null;
    currency: string | null;
    duration: "once" | "repeating" | "forever";
    duration_in_months: number | null;
    valid: boolean;
  };
}

/** Stripe is wired up for real — the test-mode fake stands in for Stripe and has no coupons. */
export function promosAvailable(): boolean {
  return stripeEnabled() && !billingFakeEnabled();
}

export const PROMOS_UNAVAILABLE_NOTE = "Stripe isn't connected on this server, so there are no coupons to manage. Set STRIPE_SECRET_KEY to enable them; redeemable codes above work either way.";

const toIso = (unix: number | null | undefined) => (unix ? new Date(unix * 1000).toISOString() : null);

function toPromo(p: Stripe.PromotionCode): Promo {
  // Older API versions put the coupon on the promotion code itself; current ones nest it under `promotion`.
  const ref = p.promotion?.coupon ?? (p as unknown as { coupon?: string | Stripe.Coupon }).coupon ?? null;
  const c = typeof ref === "string" || !ref ? null : ref;
  return {
    id: p.id,
    code: p.code,
    active: p.active,
    times_redeemed: p.times_redeemed,
    max_redemptions: p.max_redemptions ?? null,
    expires_at: toIso(p.expires_at),
    created: new Date(p.created * 1000).toISOString(),
    coupon: {
      id: c?.id ?? (typeof ref === "string" ? ref : ""),
      name: c?.name ?? null,
      percent_off: c?.percent_off ?? null,
      amount_off: c?.amount_off ?? null,
      currency: c?.currency ?? null,
      duration: (c?.duration as Promo["coupon"]["duration"]) ?? "once",
      duration_in_months: c?.duration_in_months ?? null,
      valid: c?.valid ?? true,
    },
  };
}

export async function listPromos(): Promise<Promo[]> {
  const stripe = getStripe();
  const res = await stripe.promotionCodes.list({ limit: 100, expand: ["data.promotion.coupon"] });
  return res.data.map(toPromo).sort((a, b) => b.created.localeCompare(a.created));
}

export interface NewPromo {
  name: string;
  code: string;
  percent_off?: number | null;
  /** cents */
  amount_off?: number | null;
  duration: "once" | "repeating" | "forever";
  duration_in_months?: number | null;
  max_redemptions?: number | null;
  expires_at?: string | null;
}

/** A coupon plus the promotion code that applies it. Validation mirrors Stripe's rules so the error is ours, not a 400 from the API. */
export async function createPromo(input: NewPromo): Promise<Promo> {
  const name = input.name.trim().slice(0, 40);
  const code = input.code.trim().toUpperCase().replace(/\s+/g, "");
  if (!name) throw new HttpError(400, "Give the coupon a name — customers see it on their invoice.");
  if (!/^[A-Z0-9-]{3,32}$/.test(code)) throw new HttpError(400, "Promotion codes are 3–32 letters, digits or dashes.");
  const percent = input.percent_off ?? null;
  const amount = input.amount_off ?? null;
  if ((percent === null) === (amount === null)) throw new HttpError(400, "Choose either a percentage or a fixed amount off.");
  if (percent !== null && !(percent > 0 && percent <= 100)) throw new HttpError(400, "Percent off must be between 1 and 100.");
  if (amount !== null && !(Number.isInteger(amount) && amount > 0)) throw new HttpError(400, "Amount off must be a whole number of cents above zero.");
  if (input.duration === "repeating" && !(input.duration_in_months && input.duration_in_months >= 1)) throw new HttpError(400, "A repeating coupon needs a number of months.");
  if (input.max_redemptions != null && !(Number.isInteger(input.max_redemptions) && input.max_redemptions >= 1)) throw new HttpError(400, "Max redemptions must be a whole number of at least 1.");
  const expires = input.expires_at ? Math.floor(Date.parse(input.expires_at) / 1000) : null;
  if (input.expires_at && (!expires || expires * 1000 < Date.now())) throw new HttpError(400, "The expiry date must be in the future.");

  const stripe = getStripe();
  const coupon = await stripe.coupons.create({
    name,
    duration: input.duration,
    ...(input.duration === "repeating" ? { duration_in_months: input.duration_in_months as number } : {}),
    ...(percent !== null ? { percent_off: percent } : { amount_off: amount as number, currency: CURRENCY }),
    metadata: { redline: "admin" },
  });
  const promo = await stripe.promotionCodes.create({
    promotion: { type: "coupon", coupon: coupon.id },
    code,
    ...(input.max_redemptions ? { max_redemptions: input.max_redemptions } : {}),
    ...(expires ? { expires_at: expires } : {}),
    metadata: { redline: "admin" },
    expand: ["promotion.coupon"],
  });
  return toPromo(promo);
}

/** Switch a promotion code off (or back on); the coupon itself stays so existing discounts keep applying. */
export async function setPromoActive(id: string, active: boolean): Promise<Promo> {
  const stripe = getStripe();
  const promo = await stripe.promotionCodes.update(id, { active, expand: ["promotion.coupon"] });
  return toPromo(promo);
}
