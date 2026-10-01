import { db } from "@/lib/db";
import type { Subscription } from "@/lib/types";
import type { Interval, PlanId } from "./plans";

/**
 * Test-mode stand-in for Stripe. Real payments can't be exercised by the
 * end-to-end suite, so with REDLINE_BILLING_FAKE=1 (never on Vercel — the same
 * guard as test sign-in) checkout and the customer portal become local URLs:
 *
 *  - checkout → GET /api/billing/fake-checkout?plan=…&interval=… which marks
 *    the signed-in account as subscribed and bounces back to the billing page
 *  - portal   → /account/billing
 *
 * Everything lives in this module so the production code paths in stripe.ts
 * and entitlements.ts stay free of test branches beyond one `if`.
 */
export function billingFakeEnabled(): boolean {
  return process.env.REDLINE_BILLING_FAKE === "1" && !process.env.VERCEL;
}

/**
 * Test sign-in grants a plan to accounts that never touched billing: the e2e
 * suite predates plans and creates many projects, recordings and exports per
 * user. REDLINE_BILLING_FAKE_PLAN picks it (default "team"); tests that want
 * the Free experience go through the fake checkout with `plan=free`, which
 * writes a row this grant then leaves alone.
 */
export async function fakeGrantOnSignIn(userId: string): Promise<void> {
  if (!billingFakeEnabled()) return;
  const env = process.env.REDLINE_BILLING_FAKE_PLAN;
  const plan: PlanId = env === "free" || env === "pro" || env === "team" ? env : "team";
  if (await (await db()).getSubscription(userId)) return;
  await fakeSubscribe(userId, plan, "month");
}

export function fakeCheckoutUrl(plan: PlanId, interval: Interval): string {
  return `/api/billing/fake-checkout?plan=${plan}&interval=${interval}`;
}

export const FAKE_PORTAL_URL = "/account/billing";

/** What the fake checkout "charges": an active subscription for a paid plan, or a plain Free row. */
export async function fakeSubscribe(userId: string, plan: PlanId, interval: Interval): Promise<Subscription> {
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + (interval === "year" ? 12 : 1));
  const paid = plan !== "free";
  const row: Subscription = {
    user_id: userId,
    plan,
    status: paid ? "active" : "none",
    interval: paid ? interval : null,
    stripe_customer_id: paid ? `cus_fake_${userId.slice(0, 8)}` : null,
    stripe_subscription_id: paid ? `sub_fake_${now.getTime().toString(36)}` : null,
    price_id: paid ? `price_fake_${plan}_${interval}` : null,
    current_period_end: paid ? periodEnd.toISOString() : null,
    cancel_at_period_end: false,
    updated_at: now.toISOString(),
  };
  return (await db()).upsertSubscription(row);
}
