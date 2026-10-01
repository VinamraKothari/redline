import type { NextRequest } from "next/server";
import Stripe from "stripe";
import { db } from "@/lib/db";
import { HttpError, type SessionUser } from "@/lib/auth/server";
import type { Subscription } from "@/lib/types";
import { billingFakeEnabled, FAKE_PORTAL_URL, fakeCheckoutUrl } from "./fake";
import { chargeFor, CURRENCY, PLAN_BY_ID, PLANS, type Interval, type PlanId } from "./plans";

/**
 * Everything that talks to Stripe. Server-only. Needs STRIPE_SECRET_KEY (and
 * STRIPE_WEBHOOK_SECRET for the webhook route); without them the app keeps
 * working with every account on the Free plan and the billing page says so.
 *
 * Products and prices are created on first use from the lookup keys in
 * plans.ts, so the Stripe account needs no manual product setup.
 */

export function stripeEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeEnabled()) throw new HttpError(503, "Payments aren't set up on this server yet.");
  // The e2e suite points the SDK at a static mock (never on Vercel) to exercise signed webhook events.
  const mock = !process.env.VERCEL && process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY as string, {
    appInfo: { name: "Redline", url: "https://redline-wheat.vercel.app" },
    ...(mock ? { host: mock.hostname, port: Number(mock.port) || (mock.protocol === "https:" ? 443 : 80), protocol: mock.protocol.replace(":", "") as "http" | "https", maxNetworkRetries: 0 } : {}),
  });
  return client;
}

/** lookup key → Stripe price id */
type PriceMap = Record<string, string>;

let pricesPending: Promise<PriceMap> | null = null;

/**
 * The Stripe price for every paid plan and interval, created when missing.
 * Idempotent: prices are found by lookup key first, and the result is cached
 * for the life of the process so checkout doesn't list prices on every click.
 */
export function ensurePrices(): Promise<PriceMap> {
  pricesPending ??= loadPrices().catch((e) => {
    pricesPending = null;
    throw e;
  });
  return pricesPending;
}

async function loadPrices(): Promise<PriceMap> {
  const stripe = getStripe();
  const keys = PLANS.flatMap((p) => (p.lookup ? [p.lookup.month, p.lookup.year] : []));
  const existing = await stripe.prices.list({ lookup_keys: keys, expand: ["data.product"], limit: 100 });
  const map: PriceMap = {};
  for (const price of existing.data) if (price.lookup_key && price.active) map[price.lookup_key] = price.id;

  for (const plan of PLANS) {
    if (!plan.lookup) continue;
    const intervals: Interval[] = ["month", "year"];
    const missing = intervals.filter((i) => !map[plan.lookup![i]]);
    if (!missing.length) continue;
    // The sibling price (say monthly exists, yearly doesn't) tells us the product.
    const sibling = existing.data.find((p) => p.lookup_key === plan.lookup!.month || p.lookup_key === plan.lookup!.year);
    let productId = typeof sibling?.product === "string" ? sibling.product : sibling?.product?.id;
    if (!productId) {
      const product = await stripe.products.create({ name: `Redline ${plan.name}`, description: plan.tagline, metadata: { redline_plan: plan.id } });
      productId = product.id;
    }
    for (const interval of missing) {
      const price = await stripe.prices.create({
        product: productId,
        currency: CURRENCY,
        unit_amount: chargeFor(plan, interval),
        recurring: { interval },
        lookup_key: plan.lookup[interval],
        transfer_lookup_key: true,
        nickname: `${plan.name} · ${interval === "year" ? "yearly" : "monthly"}`,
        metadata: { redline_plan: plan.id, redline_interval: interval },
      });
      map[plan.lookup[interval]] = price.id;
    }
  }
  return map;
}

/** The public origin Stripe sends people back to: APP_URL when set, else where the request came from. */
export function appOrigin(req: NextRequest): string {
  return process.env.APP_URL?.replace(/\/$/, "") || req.headers.get("origin") || req.nextUrl.origin;
}

/** Where Stripe sends people back to; `returnTo` is the app's origin (from the request). */
const billingUrl = (returnTo: string, query = "") => `${returnTo.replace(/\/$/, "")}/account/billing${query}`;

/**
 * Starts a subscription checkout and returns the URL to send the browser to.
 * Someone who already pays gets the customer portal's plan-change flow
 * instead, so one account never ends up with two subscriptions.
 */
export async function createCheckoutSession(opts: { user: SessionUser; plan: Exclude<PlanId, "free">; interval: Interval; returnTo: string }): Promise<string> {
  const { user, plan, interval, returnTo } = opts;
  if (billingFakeEnabled()) return fakeCheckoutUrl(plan, interval);
  const stripe = getStripe();
  const prices = await ensurePrices();
  const price = prices[PLAN_BY_ID[plan].lookup![interval]];
  const current = await (await db()).getSubscription(user.id);

  if (current?.stripe_customer_id && current.stripe_subscription_id && ["active", "trialing", "past_due"].includes(current.status)) {
    const session = await stripe.billingPortal.sessions.create({
      customer: current.stripe_customer_id,
      return_url: billingUrl(returnTo),
      configuration: process.env.STRIPE_PORTAL_CONFIGURATION || undefined,
      flow_data: {
        type: "subscription_update_confirm",
        subscription_update_confirm: {
          subscription: current.stripe_subscription_id,
          items: [{ id: await firstItemId(stripe, current.stripe_subscription_id), price, quantity: 1 }],
        },
        after_completion: { type: "redirect", redirect: { return_url: billingUrl(returnTo, "?checkout=success") } },
      },
    });
    return session.url;
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    client_reference_id: user.id,
    metadata: { user_id: user.id, plan, interval },
    subscription_data: { metadata: { user_id: user.id, plan, interval } },
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    // Stripe Tax is a paid add-on; switch it on once the account has it.
    ...(process.env.STRIPE_AUTOMATIC_TAX === "1" ? { automatic_tax: { enabled: true } } : {}),
    ...(current?.stripe_customer_id ? { customer: current.stripe_customer_id, customer_update: { address: "auto", name: "auto" } } : { customer_email: user.email }),
    success_url: billingUrl(returnTo, "?checkout=success"),
    cancel_url: billingUrl(returnTo, "?checkout=cancel"),
  });
  if (!session.url) throw new HttpError(502, "Stripe didn't return a checkout page.");
  return session.url;
}

async function firstItemId(stripe: Stripe, subscriptionId: string): Promise<string> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const item = sub.items.data[0];
  if (!item) throw new HttpError(409, "Your subscription has no items — please contact support.");
  return item.id;
}

/** The customer portal: invoices, card, cancel, switch plans. */
export async function createPortalSession(customerId: string, returnTo: string): Promise<string> {
  if (billingFakeEnabled()) return FAKE_PORTAL_URL;
  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: billingUrl(returnTo),
    configuration: process.env.STRIPE_PORTAL_CONFIGURATION || undefined,
  });
  return session.url;
}

function planFromPrice(price: Stripe.Price | undefined, fallback: PlanId): PlanId {
  if (!price) return fallback;
  for (const plan of PLANS) {
    if (plan.lookup && (price.lookup_key === plan.lookup.month || price.lookup_key === plan.lookup.year)) return plan.id;
  }
  const tagged = price.metadata?.redline_plan || (typeof price.product === "object" && !price.product.deleted ? price.product.metadata?.redline_plan : undefined);
  if (tagged && tagged in PLAN_BY_ID) return tagged as PlanId;
  return fallback;
}

/**
 * Mirrors a Stripe subscription into our `subscriptions` row. The account is
 * found through the metadata we set at checkout, the checkout session's
 * client reference (passed as `userHint`), or an earlier row for the same
 * customer. Returns null (and logs) when none of those match — an event for a
 * subscription created outside the app.
 *
 * What makes out-of-order deliveries safe is that the caller passes a
 * subscription it has just re-fetched from Stripe, so every event applies
 * the *current* state whatever its payload said. The timestamp check is belt
 * and braces on top: `eventCreated` (Stripe's timestamp of the event) is
 * stored as the row's `updated_at`, and an event older than what the row
 * already reflects is reported as skipped. (A manual grant stamps `now`, so
 * only events from before the grant are ignored — which is what one wants.)
 */
export async function syncFromStripeSubscription(
  sub: Stripe.Subscription,
  userHint?: string | null,
  eventCreated?: number,
): Promise<{ row: Subscription | null; skipped: boolean }> {
  const d = await db();
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const byCustomer = await d.getSubscriptionByCustomer(customerId);
  const userId = sub.metadata?.user_id || userHint || byCustomer?.user_id;
  if (!userId) {
    console.warn("[redline] stripe subscription without a user", sub.id, customerId);
    return { row: null, skipped: false };
  }
  const current = byCustomer?.user_id === userId ? byCustomer : await d.getSubscription(userId);
  if (eventCreated && current && Date.parse(current.updated_at) > eventCreated * 1000) return { row: current, skipped: true };
  const item = sub.items.data[0];
  const price = item?.price;
  const plan = planFromPrice(price, current?.plan ?? "pro");
  if (plan === "free") return { row: null, skipped: false };
  const row = await d.upsertSubscription({
    user_id: userId,
    plan,
    status: sub.status,
    interval: price?.recurring?.interval === "year" ? "year" : "month",
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    price_id: price?.id ?? null,
    current_period_end: item?.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null,
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    updated_at: new Date(eventCreated ? eventCreated * 1000 : Date.now()).toISOString(),
  });
  return { row, skipped: false };
}

/**
 * One webhook event. The event's payload is only used for the subscription
 * id: the state is re-fetched from Stripe so the latest wins whatever order
 * deliveries arrive in (and whatever API version the endpoint is pinned to).
 * Returns a short note for the log; unknown event types are ignored so the
 * endpoint can be subscribed to more than it needs.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<string> {
  const stripe = getStripe();
  const apply = async (subscriptionId: string, userHint?: string | null) => {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const { row, skipped } = await syncFromStripeSubscription(sub, userHint, event.created);
    if (skipped) return `${event.type} skipped: older than the row`;
    return row ? `${event.type} → ${row.plan} ${row.status} for ${row.user_id}` : `${event.type} for an unknown user`;
  };
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (!subId) return "checkout without a subscription";
      return apply(subId, session.client_reference_id || session.metadata?.user_id);
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return apply(event.data.object.id);
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      // `parent` is where current API versions put it; an endpoint pinned to an older version still sends `subscription`.
      const ref = invoice.parent?.subscription_details?.subscription ?? (invoice as unknown as { subscription?: string | { id: string } | null }).subscription;
      const subId = typeof ref === "string" ? ref : ref?.id;
      if (subId) return apply(subId);
      // An invoice with no subscription (one-off) can't change a plan; note it and move on.
      return "payment failed on an invoice without a subscription";
    }
    default:
      return `ignored ${event.type}`;
  }
}
