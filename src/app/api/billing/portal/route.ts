import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, HttpError, requireUser } from "@/lib/auth/server";
import { billingFakeEnabled } from "@/lib/billing/fake";
import { appOrigin, createPortalSession, stripeEnabled } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST → { url } of the Stripe customer portal (invoices, card, cancel, switch plans). Paying customers only. */
export const POST = guarded(async (req: NextRequest) => {
  const user = await requireUser();
  if (!stripeEnabled() && !billingFakeEnabled()) throw new HttpError(503, "Payments aren't set up on this server yet.");
  const sub = await (await db()).getSubscription(user.id);
  if (!sub?.stripe_customer_id) throw new HttpError(404, "There is no subscription on this account yet.");
  const url = await createPortalSession(sub.stripe_customer_id, appOrigin(req));
  return Response.json({ url });
});
