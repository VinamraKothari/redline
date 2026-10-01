import type { NextRequest } from "next/server";
import { getStripe, handleStripeEvent, stripeEnabled } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe → Redline. No user session here: the request is authenticated by
 * its signature over the raw body, so the body must be read as text, not
 * JSON. Stripe retries anything that isn't a 2xx, hence the quick 200 even
 * for events we don't handle.
 */
export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing Stripe signature." }, { status: 400 });
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeEnabled() || !secret) return Response.json({ error: "Payments aren't set up on this server yet." }, { status: 503 });
  const payload = await req.text();
  let event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, secret);
  } catch (e) {
    return Response.json({ error: `Invalid signature: ${(e as Error).message}` }, { status: 400 });
  }
  try {
    const note = await handleStripeEvent(event);
    console.log(`[redline] stripe ${event.id}: ${note}`);
    return Response.json({ received: true });
  } catch (e) {
    // A 500 makes Stripe retry later, which is what we want for a database hiccup.
    console.error("[redline] stripe webhook failed", event.type, e);
    return Response.json({ error: (e as Error).message || "Webhook failed." }, { status: 500 });
  }
}
