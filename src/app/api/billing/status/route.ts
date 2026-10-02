import { guarded, requireUser } from "@/lib/auth/server";
import { billingStatusFor } from "@/lib/billing/entitlements";
import { billingFakeEnabled } from "@/lib/billing/fake";
import { stripeEnabled } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The caller's effective plan and where it comes from (Stripe, a manual grant,
 * a redeemed code, admin, or complimentary as an admin's collaborator), the
 * shape of their subscription (no Stripe ids — the browser has no use for
 * them), usage against the limits, and whether payments work on this server.
 */
export const GET = guarded(async () => {
  const user = await requireUser();
  const status = await billingStatusFor(user.id);
  return Response.json({ ...status, stripeEnabled: stripeEnabled() || billingFakeEnabled() });
});
