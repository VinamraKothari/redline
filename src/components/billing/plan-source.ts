import type { BillingStatus } from "@/lib/api";
import { chargeFor, formatPrice, PLAN_BY_ID } from "@/lib/billing/plans";

/**
 * Where an account's plan comes from. The status API reports it (admins and
 * their collaborators are on Team without paying; manual grants and redeemed
 * codes run until a date; Stripe subscriptions renew). The field may sit on
 * the status or on its subscription summary; a server that predates it is
 * read from what the subscription row shows.
 */
export type PlanSource = "admin" | "collaborator" | "stripe" | "manual" | "code" | "free";

type Sourced = { source?: PlanSource | null; until?: string | null };

export function planSource(s: BillingStatus): PlanSource {
  const given = (s as Sourced).source ?? (s.subscription as Sourced | null)?.source;
  if (given) return given;
  if (s.plan === "free") return "free";
  return s.subscription?.paying ? "stripe" : "manual";
}

/** When the plan ends or renews: the grant's expiry, or the Stripe period end. */
export function planUntil(s: BillingStatus): string | null {
  return (s as Sourced).until ?? (s.subscription as Sourced | null)?.until ?? s.subscription?.current_period_end ?? null;
}

/** Nobody on a complimentary plan should ever be sold an upgrade. */
export const isComplimentary = (source: PlanSource) => source === "admin" || source === "collaborator";

export const formatDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * Why the account is on its plan, in plain words, to sit under the plan's
 * name: "you're an admin", "€15/month, renews 3 Nov 2026", "manual grant
 * until 3 Jan 2027".
 */
export function planReason(s: BillingStatus): string {
  const source = planSource(s);
  const until = planUntil(s);
  const sub = s.subscription;
  switch (source) {
    case "admin":
      return "you're a Redline admin";
    case "collaborator":
      return "complimentary, because you share a project with a Redline admin";
    case "manual":
      return until ? `manual grant until ${formatDay(until)}` : "granted manually, no end date";
    case "code":
      return until ? `from a code, until ${formatDay(until)}` : "from a code";
    case "stripe": {
      if (s.plan === "free") return freeReason(sub);
      const price = sub?.interval === "year" ? `${formatPrice(chargeFor(PLAN_BY_ID[s.plan], "year"))}/year` : `${formatPrice(PLAN_BY_ID[s.plan].monthly)}/month`;
      if (sub?.status === "past_due") return `${price} — last payment failed`;
      if (!until) return price;
      return `${price}, ${sub?.cancel_at_period_end ? "cancels" : "renews"} ${formatDay(until)}`;
    }
    default:
      return freeReason(sub);
  }
}

/** Free is either never-paid or a subscription that ran out — the row remembers the Stripe customer. */
function freeReason(sub: BillingStatus["subscription"]): string {
  return sub?.paying && sub.status === "canceled" ? "your subscription ended — upgrade again any time" : "free forever — upgrade when you need more";
}

/** For a complimentary account that still pays: what the subscription is doing, and whether anything needs doing. */
export function alsoPayingLine(sub: NonNullable<BillingStatus["subscription"]>): string {
  const name = PLAN_BY_ID[sub.plan].name;
  if (sub.cancel_at_period_end && sub.current_period_end) return `You're also paying for ${name} until ${formatDay(sub.current_period_end)}, when it ends — you don't need it while you work with an admin, so there is nothing more to do.`;
  return `You're also paying for ${name} — you don't need to while you work with an admin. Cancel it under “Manage billing”; you keep everything either way.`;
}
