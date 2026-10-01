import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/auth/server";
import { billingFakeEnabled, fakeSubscribe } from "@/lib/billing/fake";
import { isInterval, PLAN_BY_ID, type PlanId } from "@/lib/billing/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The test-mode stand-in for Stripe Checkout (REDLINE_BILLING_FAKE=1 only):
 * marks the signed-in account as subscribed to `?plan=` for `?interval=` and
 * bounces back to the billing page like a real checkout would. `plan=free`
 * puts the account on Free explicitly.
 */
export async function GET(req: NextRequest) {
  if (!billingFakeEnabled()) return new Response("Not found", { status: 404 });
  const user = await currentUser();
  if (!user) return Response.redirect(new URL("/login?next=/account/billing", req.url), 302);
  const plan = req.nextUrl.searchParams.get("plan") || "";
  const interval = req.nextUrl.searchParams.get("interval");
  if (!(plan in PLAN_BY_ID)) return Response.json({ error: "Unknown plan." }, { status: 400 });
  await fakeSubscribe(user.id, plan as PlanId, isInterval(interval) ? interval : "month");
  return Response.redirect(new URL("/account/billing?checkout=success", req.url), 302);
}
