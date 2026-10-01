import { db } from "@/lib/db";
import { guarded, requireUser } from "@/lib/auth/server";
import { planForUser, usageFor } from "@/lib/billing/entitlements";
import { billingFakeEnabled } from "@/lib/billing/fake";
import { stripeEnabled } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The caller's plan, the shape of their subscription (no Stripe ids — the
 * browser has no use for them), usage against the limits, and whether
 * payments work on this server.
 */
export const GET = guarded(async () => {
  const user = await requireUser();
  const [plan, row, usage] = await Promise.all([planForUser(user.id), (await db()).getSubscription(user.id), usageFor(user.id)]);
  const subscription = row
    ? { plan: row.plan, status: row.status, interval: row.interval, current_period_end: row.current_period_end, cancel_at_period_end: row.cancel_at_period_end, paying: Boolean(row.stripe_customer_id) }
    : null;
  return Response.json({ plan: plan.id, subscription, usage, stripeEnabled: stripeEnabled() || billingFakeEnabled() });
});
