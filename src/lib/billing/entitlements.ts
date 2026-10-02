import { db } from "@/lib/db";
import { HttpError, PaywallError } from "@/lib/auth/server";
import { adminEmails } from "@/lib/admin/auth";
import type { Subscription } from "@/lib/types";
import { PLAN_BY_ID, PLANS, planOf, type Plan, type PlanId, type PlanLimits } from "./plans";

/**
 * What an account may do, derived from who it is and its subscription row.
 * Limits are always judged against the *project owner's* plan, so one paid
 * seat covers everyone the owner invites — which is also why every gate
 * takes the caller's id: a member who hits the owner's limit is told whose
 * plan it is instead of being sold an upgrade of their own.
 *
 * The gates are check-then-insert, not atomic: two simultaneous creates can
 * both pass and leave a project one page over its limit. Acceptable for a
 * soft commercial limit; the next create is refused.
 */

/** Subscription statuses that keep the paid plan. past_due is a grace period while Stripe retries the card. */
export const ENTITLED = new Set(["active", "trialing", "past_due"]);

/** Where an account's plan comes from, most privileged first. */
export type PlanSource = "admin" | "collaborator" | "stripe" | "manual" | "code" | "free";

export interface EffectivePlan {
  plan: Plan;
  source: PlanSource;
  /** when the plan ends or renews: a Stripe period end, a grant's expiry, or null for "no end date" */
  until: string | null;
  /** the subscription row, whatever the plan was derived from (null when there is none) */
  row: Subscription | null;
}

/**
 * Who manages a subscription row. A row Stripe wrote always carries the
 * subscription id, so that is the test — not the `source` column, which an
 * older write path may leave stale underneath a Stripe sync.
 */
export function rowSource(row: Subscription): "stripe" | "manual" | "code" {
  if (row.stripe_subscription_id) return "stripe";
  return row.source === "manual" || row.source === "code" ? row.source : "stripe";
}

/** A manual grant or redeemed code counts while it has no end date or the end date is ahead. */
export function grantActive(row: Subscription, now = Date.now()): boolean {
  return row.plan !== "free" && (!row.expires_at || Date.parse(row.expires_at) > now);
}

/** True when Stripe is the system of record for this row — the admin area never edits those. */
export function stripeManaged(row: Subscription | null): boolean {
  return Boolean(row && rowSource(row) === "stripe" && row.stripe_subscription_id && ENTITLED.has(row.status));
}

/**
 * The plan an account actually enjoys. Admins are on Team; so is everyone who
 * shares a project an admin owns ("complimentary" — the owner's collaborators
 * never pay). Then the subscription row: a Stripe subscription in good
 * standing, or a manual grant / redeemed code that hasn't expired. Else Free.
 *
 * `known` lets callers that already hold the facts (the admin user list) skip
 * the lookups; everything missing is fetched.
 */
export async function effectivePlan(
  userId: string,
  known: { email?: string | null; isAdmin?: boolean; collaborator?: boolean; row?: Subscription | null } = {},
): Promise<EffectivePlan> {
  const d = await db();
  // one round trip for everything the caller didn't already know
  const [row, email, dbAdmin, collaborator] = await Promise.all([
    known.row !== undefined ? known.row : d.getSubscription(userId),
    known.email !== undefined ? known.email : known.isAdmin !== undefined ? null : d.getProfile(userId).then((p) => p?.email ?? null),
    known.isAdmin !== undefined ? known.isAdmin : d.isAdmin(userId),
    known.collaborator !== undefined ? known.collaborator : d.isAdminCollaborator(userId),
  ]);
  const admin = known.isAdmin ?? (dbAdmin || Boolean(email && adminEmails().has(email.toLowerCase())));
  if (admin) return { plan: PLAN_BY_ID.team, source: "admin", until: null, row };
  if (collaborator) return { plan: PLAN_BY_ID.team, source: "collaborator", until: null, row };
  if (row) {
    const source = rowSource(row);
    if (source === "stripe") {
      if (ENTITLED.has(row.status)) return { plan: planOf(row.plan), source, until: row.current_period_end, row };
    } else if (grantActive(row)) {
      return { plan: planOf(row.plan), source, until: row.expires_at ?? null, row };
    }
  }
  return { plan: PLAN_BY_ID.free, source: "free", until: null, row };
}

export async function planForUser(userId: string): Promise<Plan> {
  return (await effectivePlan(userId)).plan;
}

interface Owner {
  plan: Plan;
  ownerId: string;
}

/** The owner's effective plan: a project owned by an admin is Team for everyone in it. */
export async function planForProject(projectId: string): Promise<Owner> {
  const project = await (await db()).getProject(projectId);
  if (!project) throw new HttpError(404, "This project doesn't exist or you don't have access to it.");
  return { plan: await planForUser(project.created_by), ownerId: project.created_by };
}

/** First day of the current month, UTC — the window for "Figma comparisons a month". */
export function startOfMonthIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** The cheapest plan whose limit is at least `needed` (or, for flags, has the feature). */
function planThatLifts(key: keyof PlanLimits, needed: number | true): Exclude<PlanId, "free"> {
  const found = PLANS.find((p) => p.id !== "free" && (needed === true ? p.limits[key] === true : (p.limits[key] as number) >= needed));
  return (found?.id as Exclude<PlanId, "free">) || "team";
}

/** `noun` is "singular|plural" when the plural isn't just an s ("person|people"). */
const plural = (n: number, noun: string) => {
  const [one, many = one + "s"] = noun.split("|");
  return `${n} ${n === 1 ? one : many}`;
};

/** Who owns the limit that was hit; the client words the dialog differently for members. */
async function ownership(ownerId: string, callerId: string): Promise<{ owner: boolean; ownerName?: string }> {
  if (ownerId === callerId) return { owner: true };
  const profile = await (await db()).getProfile(ownerId);
  return { owner: false, ownerName: profile?.name || profile?.email || "another member" };
}

async function tooMany(o: Owner, callerId: string, key: keyof PlanLimits, count: number, noun: string, scope: string, feature: string): Promise<never> {
  const limit = o.plan.limits[key] as number;
  const next = planThatLifts(key, count + 1);
  const lifts = PLAN_BY_ID[next].limits[key] === Infinity ? `unlimited ${plural(2, noun).slice(2)}` : `${plural(PLAN_BY_ID[next].limits[key] as number, noun)}${scope}`;
  throw new PaywallError(`The ${o.plan.name} plan includes ${plural(limit, noun)}${scope}. Upgrade to ${PLAN_BY_ID[next].name} for ${lifts}.`, next, feature, await ownership(o.ownerId, callerId));
}

/** `what` starts the sentence ("Screen recordings"); `noun` sits mid-sentence ("screen recordings", "PNG exports"). */
async function missingFeature(o: Owner, callerId: string, key: keyof PlanLimits, what: string, noun: string, feature: string): Promise<never> {
  const next = planThatLifts(key, true);
  throw new PaywallError(`${what} are not included in the ${o.plan.name} plan. Upgrade to ${PLAN_BY_ID[next].name} to use ${noun}.`, next, feature, await ownership(o.ownerId, callerId));
}

/** How many projects `userId` owns (membership in other people's projects is free). */
export async function countOwnedProjects(userId: string): Promise<number> {
  return (await (await db()).listProjectsFor(userId)).filter((p) => p.created_by === userId).length;
}

export async function assertCanCreateProject(userId: string): Promise<void> {
  const plan = await planForUser(userId);
  const owned = await countOwnedProjects(userId);
  if (owned >= plan.limits.projects) await tooMany({ plan, ownerId: userId }, userId, "projects", owned, "project", "", "projects");
}

/** Adding a page — created, uploaded, captured as a frozen version, or moved in from another project. */
export async function assertCanAddPage(projectId: string, mode: "live" | "upload" | "frozen", callerId: string): Promise<void> {
  const o = await planForProject(projectId);
  if (mode === "frozen" && !o.plan.limits.frozenVersions) await missingFeature(o, callerId, "frozenVersions", "Frozen versions", "frozen versions", "frozenVersions");
  const pages = (await (await db()).listReviews(projectId)).length;
  if (pages >= o.plan.limits.pagesPerProject) await tooMany(o, callerId, "pagesPerProject", pages, "page", " per project", "pages");
}

/** Freezing a page in place is the same feature as saving a frozen copy. */
export async function assertCanFreeze(projectId: string, callerId: string): Promise<void> {
  const o = await planForProject(projectId);
  if (!o.plan.limits.frozenVersions) await missingFeature(o, callerId, "frozenVersions", "Frozen versions", "frozen versions", "frozenVersions");
}

/** Members plus pending invites count against the seats of a project. */
export async function assertCanInvite(projectId: string, callerId: string): Promise<void> {
  const o = await planForProject(projectId);
  const d = await db();
  const seats = (await d.listMembers(projectId)).length + (await d.listInvites(projectId)).filter((i) => !i.accepted_at).length;
  if (seats >= o.plan.limits.membersPerProject) await tooMany(o, callerId, "membersPerProject", seats, "person|people", " per project", "members");
}

/** Returns the owner id so the caller can record the run against the right account afterwards. */
export async function assertCanCompareFigma(projectId: string, callerId: string): Promise<{ ownerId: string }> {
  const o = await planForProject(projectId);
  const runs = await (await db()).countFigmaRuns(o.ownerId, startOfMonthIso());
  if (runs >= o.plan.limits.figmaComparesPerMonth) {
    await tooMany(o, callerId, "figmaComparesPerMonth", runs, "Figma comparison", " a month (the count resets on the 1st, UTC)", "figmaCompares");
  }
  return { ownerId: o.ownerId };
}

export async function assertCanRecord(projectId: string, callerId: string): Promise<void> {
  const o = await planForProject(projectId);
  if (!o.plan.limits.recordings) await missingFeature(o, callerId, "recordings", "Screen recordings", "screen recordings", "recordings");
}

export async function assertCanExportPng(projectId: string, callerId: string): Promise<void> {
  const o = await planForProject(projectId);
  if (!o.plan.limits.pngExport) await missingFeature(o, callerId, "pngExport", "PNG exports", "PNG exports", "pngExport");
}

/** The numbers the billing page shows next to the plan's limits. */
export async function usageFor(userId: string): Promise<{ projects: number; figmaRunsThisMonth: number }> {
  return {
    projects: await countOwnedProjects(userId),
    figmaRunsThisMonth: await (await db()).countFigmaRuns(userId, startOfMonthIso()),
  };
}

/** The subscription as the browser sees it: no Stripe ids, plus where the plan comes from. */
export interface SubscriptionSummaryData {
  plan: PlanId;
  status: string;
  interval: Subscription["interval"];
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  /** the account has a Stripe customer — it pays, or paid, through Stripe and can open the portal for its invoices */
  paying: boolean;
  source: PlanSource;
  until: string | null;
}

/**
 * What GET /api/billing/status and POST /api/billing/redeem answer with
 * (`stripeEnabled` is added by the route). An admin or collaborator without a
 * row still gets a summary, so the account page has something to describe.
 */
export async function billingStatusFor(userId: string): Promise<{ plan: PlanId; source: PlanSource; until: string | null; subscription: SubscriptionSummaryData | null; usage: { projects: number; figmaRunsThisMonth: number } }> {
  const [eff, usage] = await Promise.all([effectivePlan(userId), usageFor(userId)]);
  const row = eff.row;
  // a grant written over a lapsed Stripe row keeps the customer id, and with it the way to past invoices
  const paying = Boolean(row?.stripe_customer_id);
  let subscription: SubscriptionSummaryData | null = null;
  if (row) {
    subscription = { plan: row.plan, status: row.status, interval: row.interval, current_period_end: row.current_period_end, cancel_at_period_end: row.cancel_at_period_end, paying, source: eff.source, until: eff.until };
  } else if (eff.source === "admin" || eff.source === "collaborator") {
    subscription = { plan: eff.plan.id, status: "active", interval: null, current_period_end: null, cancel_at_period_end: false, paying: false, source: eff.source, until: null };
  }
  return { plan: eff.plan.id, source: eff.source, until: eff.until, subscription, usage };
}
