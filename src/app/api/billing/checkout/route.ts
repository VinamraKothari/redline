import type { NextRequest } from "next/server";
import { guarded, HttpError, requireUser, syncProfile } from "@/lib/auth/server";
import { billingFakeEnabled } from "@/lib/billing/fake";
import { isInterval, isPaidPlan } from "@/lib/billing/plans";
import { appOrigin, createCheckoutSession, stripeEnabled } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { plan, interval } → { url } of the Stripe Checkout page (or the portal's plan-change flow for existing customers). */
export const POST = guarded(async (req: NextRequest) => {
  const user = await requireUser();
  await syncProfile(user);
  if (!stripeEnabled() && !billingFakeEnabled()) throw new HttpError(503, "Payments aren't set up on this server yet.");
  const body = (await req.json().catch(() => ({}))) as { plan?: string; interval?: string };
  if (!isPaidPlan(body.plan)) throw new HttpError(400, "Pick the Pro or Team plan.");
  const interval = isInterval(body.interval) ? body.interval : "month";
  const url = await createCheckoutSession({ user, plan: body.plan, interval, returnTo: appOrigin(req) });
  return Response.json({ url });
});
