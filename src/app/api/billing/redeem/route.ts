import type { NextRequest } from "next/server";
import { guarded, requireUser, syncProfile } from "@/lib/auth/server";
import { redeemCode } from "@/lib/admin/grants";
import { billingStatusFor } from "@/lib/billing/entitlements";
import { billingFakeEnabled } from "@/lib/billing/fake";
import { stripeEnabled } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { code } — redeem a code for a plan without a card. Answers with the
 * same body as GET /api/billing/status so the account page can swap it in.
 * Refusals are 4xx with a message written for the person typing the code.
 */
export const POST = guarded(async (req: NextRequest) => {
  const user = await requireUser();
  await syncProfile(user);
  const body = (await req.json().catch(() => ({}))) as { code?: unknown };
  await redeemCode(body.code, user.id);
  const status = await billingStatusFor(user.id);
  return Response.json({ ...status, stripeEnabled: stripeEnabled() || billingFakeEnabled() });
});
