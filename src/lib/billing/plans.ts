/**
 * Plans, prices and limits — the single source of truth for the pricing page,
 * the upgrade dialog, the API gates and the Stripe products (created from
 * these lookup keys on first use).
 *
 * Prices are in euro cents. Yearly = 10 months for the price of 12.
 */
export type PlanId = "free" | "pro" | "team";
export type Interval = "month" | "year";

export interface PlanLimits {
  /** projects the account can own (Infinity = unlimited) */
  projects: number;
  /** pages (reviews) per project */
  pagesPerProject: number;
  /** members per project, the owner included */
  membersPerProject: number;
  /** "Compare with Figma" runs per calendar month across the account */
  figmaComparesPerMonth: number;
  /** screen recordings attached to comments */
  recordings: boolean;
  /** frozen versions ("Save state as a new page") */
  frozenVersions: boolean;
  /** PNG section exports (the Jira CSV is always available) */
  pngExport: boolean;
}

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** euro cents per month when billed monthly / yearly (0 for free) */
  monthly: number;
  yearly: number;
  limits: PlanLimits;
  /** bullet points for the pricing page, in order */
  features: string[];
  /** Stripe price lookup keys */
  lookup: { month: string; year: string } | null;
}

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    tagline: "For trying Redline on a page or two.",
    monthly: 0,
    yearly: 0,
    limits: { projects: 1, pagesPerProject: 3, membersPerProject: 2, figmaComparesPerMonth: 2, recordings: false, frozenVersions: false, pngExport: false },
    features: ["1 project, 3 pages", "2 people per project", "Comments, drawing, inspect & measure", "2 Figma comparisons a month", "Jira CSV export"],
    lookup: null,
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For designers and developers shipping every week.",
    monthly: 1500,
    yearly: 1250,
    limits: { projects: Infinity, pagesPerProject: Infinity, membersPerProject: 5, figmaComparesPerMonth: Infinity, recordings: true, frozenVersions: true, pngExport: true },
    features: ["Unlimited projects and pages", "5 people per project", "Unlimited Figma comparisons", "Screen recordings in comments", "Frozen versions of a page", "PNG and Jira exports"],
    lookup: { month: "redline_pro_month", year: "redline_pro_year" },
  },
  {
    id: "team",
    name: "Team",
    tagline: "For agencies and product teams reviewing together.",
    monthly: 4900,
    yearly: 4083,
    limits: { projects: Infinity, pagesPerProject: Infinity, membersPerProject: Infinity, figmaComparesPerMonth: Infinity, recordings: true, frozenVersions: true, pngExport: true },
    features: ["Everything in Pro", "Unlimited people per project", "Shared projects across the whole team", "Priority support", "Invoices with your company details"],
    lookup: { month: "redline_team_month", year: "redline_team_year" },
  },
];

export const PLAN_BY_ID: Record<PlanId, Plan> = Object.fromEntries(PLANS.map((p) => [p.id, p])) as Record<PlanId, Plan>;

export function planOf(id: string | null | undefined): Plan {
  return (id && PLAN_BY_ID[id as PlanId]) || PLAN_BY_ID.free;
}

/** "€15" / "€12.50" */
export function formatPrice(cents: number, currency = "EUR"): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en-IE", { style: "currency", currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(cents / 100);
}

export const CURRENCY = "eur";

/** What Stripe charges per period, in cents: the monthly price, or ten months when billed yearly. */
export function chargeFor(plan: Plan, interval: Interval): number {
  return interval === "year" ? plan.monthly * 10 : plan.monthly;
}

/** Paid plans only — the ones with Stripe prices. */
export const PAID_PLAN_IDS = PLANS.filter((p) => p.lookup).map((p) => p.id) as Exclude<PlanId, "free">[];
export const isPaidPlan = (id: unknown): id is Exclude<PlanId, "free"> => typeof id === "string" && (PAID_PLAN_IDS as string[]).includes(id);
export const isInterval = (v: unknown): v is Interval => v === "month" || v === "year";

/** What a year costs when billed yearly, in cents rounded to whole euros (12 × €40.83 → €490). */
export function yearlyTotal(plan: Plan): number {
  return Math.round((plan.yearly * 12) / 100) * 100;
}
