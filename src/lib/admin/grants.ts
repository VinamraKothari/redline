import { customAlphabet } from "nanoid";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth/server";
import { ENTITLED, grantActive, rowSource, stripeManaged } from "@/lib/billing/entitlements";
import { PLAN_BY_ID, type PlanId } from "@/lib/billing/plans";
import type { AuditEntry, GrantCode, Subscription } from "@/lib/types";

/**
 * Plans that don't come from Stripe: an admin's manual grant, or a code a
 * user redeems. Both live in the same `subscriptions` row as a Stripe plan
 * would, flagged by `source`, so every gate keeps reading one row — and both
 * leave a Stripe-managed row alone: Stripe is the system of record for
 * anything it bills, and the Stripe dashboard is where that gets changed.
 */

const RANK: Record<PlanId, number> = { free: 0, pro: 1, team: 2 };
const MAX_MONTHS = 120;

/** `months` added to `from`, keeping the day of month where the calendar allows. */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/** Whole months, 1–120, or null for "no end date". */
export function parseMonths(v: unknown): number | null {
  if (v === undefined || v === null || v === "" || v === "forever") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_MONTHS) throw new HttpError(400, `Duration must be between 1 and ${MAX_MONTHS} months, or left empty for no end date.`);
  return n;
}

export const isPlanId = (v: unknown): v is PlanId => v === "free" || v === "pro" || v === "team";

/** One line in the audit log. `details` is whatever helps reconstruct the change later. */
export async function audit(actorId: string | null, action: string, targetUserId: string | null, details: Record<string, unknown> = {}): Promise<void> {
  const entry: AuditEntry = { actor_id: actorId, action, target_user_id: targetUserId, details, at: new Date().toISOString() };
  await (await db()).appendAudit(entry);
}

/** The Stripe dashboard page for a customer; test-mode customers live under /test. */
export function stripeCustomerUrl(customerId: string): string {
  const live = process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_");
  return `https://dashboard.stripe.com/${live ? "" : "test/"}customers/${customerId}`;
}

function refuseStripeManaged(row: Subscription): never {
  throw new HttpError(409, "Managed by Stripe; use the Stripe dashboard to change this subscription.", {
    stripe: true,
    stripe_customer_id: row.stripe_customer_id,
    stripe_url: row.stripe_customer_id ? stripeCustomerUrl(row.stripe_customer_id) : null,
  });
}

/**
 * Writes a manual grant: `plan` for `months` (null = forever), or Free, which
 * takes a manual/code grant away. With `mode: "extend"` the months are added
 * to the running grant's end date instead of starting over from today.
 *
 * The Stripe customer id is kept whatever happens, so a later checkout reuses
 * the customer instead of creating a second one: a revoke on a row that has
 * one writes a plain Free row rather than deleting it.
 */
export async function grantPlan(opts: { targetId: string; plan: PlanId; months: number | null; note: string; actorId: string; mode?: "replace" | "extend" }): Promise<Subscription | null> {
  const { targetId, plan, months, actorId, mode = "replace" } = opts;
  const d = await db();
  const current = await d.getSubscription(targetId);
  if (stripeManaged(current)) refuseStripeManaged(current as Subscription);
  const now = new Date();
  const running = current && rowSource(current) !== "stripe" && grantActive(current, now.getTime()) ? current : null;
  const previous = current ? { plan: current.plan, source: rowSource(current), status: current.status, expires_at: current.expires_at ?? null, note: current.note ?? null } : null;
  // an empty note on an extension keeps the one that is there
  const note = opts.note || (mode === "extend" && running?.note) || "";

  if (plan === "free") {
    // Only grants are ours to take away; a lapsed Stripe row or no row at all is already Free.
    if (!current || rowSource(current) === "stripe" || current.plan === "free") throw new HttpError(409, "There is no grant to remove — this account is already on Free.");
    if (current.stripe_customer_id) {
      await d.upsertSubscription({ ...current, plan: "free", status: "none", interval: null, price_id: null, current_period_end: null, cancel_at_period_end: false, updated_at: now.toISOString(), source: "manual", note: null, granted_by: null, expires_at: null });
    } else {
      await d.deleteSubscription(targetId);
    }
    await audit(actorId, "plan.revoke", targetId, { previous, note: opts.note });
    return null;
  }

  let expiresAt: string | null;
  if (mode === "extend") {
    if (!running) throw new HttpError(409, "There is no running grant to extend — grant a plan instead.");
    if (!running.expires_at) throw new HttpError(409, "This grant has no end date, so there is nothing to extend.");
    if (!months) throw new HttpError(400, "How many months should be added?");
    expiresAt = addMonths(new Date(Math.max(Date.parse(running.expires_at), now.getTime())), months).toISOString();
  } else {
    expiresAt = months ? addMonths(now, months).toISOString() : null;
  }

  const row: Subscription = {
    user_id: targetId,
    plan,
    status: "active",
    interval: null,
    stripe_customer_id: current?.stripe_customer_id ?? null,
    stripe_subscription_id: null,
    price_id: null,
    current_period_end: null,
    cancel_at_period_end: false,
    updated_at: now.toISOString(),
    source: "manual",
    note: note || null,
    granted_by: actorId,
    expires_at: expiresAt,
  };
  const saved = await d.upsertSubscription(row);
  await audit(actorId, mode === "extend" ? "plan.extend" : "plan.grant", targetId, { plan, months, expires_at: row.expires_at, note, previous, replaced: mode !== "extend" && Boolean(running) });
  return saved;
}

/* ─── Codes ──────────────────────────────────────────────────────────────── */

// No 0/O/1/I so a code read aloud or typed from a screenshot survives.
const codeChars = customAlphabet("23456789ABCDEFGHJKMNPQRSTUVWXYZ", 6);

/** "PRO-7K3M-QZ": the plan up front so the recipient knows what they're getting. */
export function generateCode(plan: Exclude<PlanId, "free">): string {
  const s = codeChars();
  return `${plan.toUpperCase()}-${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Upper-case, trimmed, inner whitespace dropped — what people paste is rarely tidy. */
export function normalizeCode(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

export async function createCode(opts: { code?: string; plan: Exclude<PlanId, "free">; months: number; max_uses: number; expires_at: string | null; note: string; actorId: string }): Promise<GrantCode> {
  const d = await db();
  let code = normalizeCode(opts.code);
  if (code) {
    if (!/^[A-Z0-9-]{6,32}$/.test(code) || code.replace(/-/g, "").length < 6) throw new HttpError(400, "Codes are 6–32 letters, digits or dashes (at least six letters or digits).");
    if (await d.getGrantCode(code)) throw new HttpError(409, `The code ${code} already exists.`);
  } else {
    // generated codes are 36^6 strong; a clash is theoretical, but checking is cheap
    do code = generateCode(opts.plan);
    while (await d.getGrantCode(code));
  }
  const row: GrantCode = {
    code,
    plan: opts.plan,
    months: opts.months,
    max_uses: opts.max_uses,
    uses: 0,
    active: true,
    expires_at: opts.expires_at,
    note: opts.note || null,
    created_by: opts.actorId,
    created_at: new Date().toISOString(),
  };
  const saved = await d.upsertGrantCode(row);
  await audit(opts.actorId, "code.create", null, { code, plan: row.plan, months: row.months, max_uses: row.max_uses, expires_at: row.expires_at, note: row.note });
  return saved;
}

export async function setCodeActive(code: string, active: boolean, actorId: string): Promise<GrantCode> {
  const d = await db();
  const row = await d.getGrantCode(normalizeCode(code));
  if (!row) throw new HttpError(404, "That code doesn't exist.");
  const saved = await d.upsertGrantCode({ ...row, active });
  await audit(actorId, active ? "code.enable" : "code.disable", null, { code: row.code });
  return saved;
}

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * Guessing protection: ten refused attempts an hour per account, then a 429.
 * The attempt is recorded *before* the code is looked up, so a burst of
 * concurrent guesses counts in full; a success (or a refusal that was about
 * the account's own plan, not the code) takes it back.
 *
 * Kept in memory, i.e. per server instance: on a serverless host every
 * instance has its own counter, which still blunts a brute force without a
 * table; a restart simply forgives.
 */
const ATTEMPT_LIMIT = 10;
const ATTEMPT_WINDOW_MS = 60 * 60 * 1000;
const attempts = new Map<string, number[]>();

function recentAttempts(userId: string, now: number): number[] {
  const list = (attempts.get(userId) ?? []).filter((t) => now - t < ATTEMPT_WINDOW_MS);
  attempts.set(userId, list);
  return list;
}

/** Counts an attempt; the returned function takes it back again. */
function recordAttempt(userId: string, now: number): () => void {
  const list = recentAttempts(userId, now);
  list.push(now);
  return () => {
    const i = list.indexOf(now);
    if (i >= 0) list.splice(i, 1);
  };
}

/**
 * A signed-in user redeems a code. Every check that can fail runs before the
 * redemption is recorded, and the adapter counts the use atomically (so a
 * code with one use left goes to exactly one of two people who race for it).
 * The result is a `code`-sourced row: a new one, or the user's existing grant
 * extended by the code's months (and lifted to the code's plan when that is
 * higher).
 */
export async function redeemCode(rawCode: unknown, userId: string): Promise<Subscription> {
  const now = new Date();
  const earlier = recentAttempts(userId, now.getTime());
  if (earlier.length >= ATTEMPT_LIMIT) {
    const wait = Math.ceil((ATTEMPT_WINDOW_MS - (now.getTime() - earlier[0])) / 60000);
    throw new HttpError(429, `Too many tries — please wait ${wait === 1 ? "a minute" : `${wait} minutes`} before entering another code.`);
  }
  const forgive = recordAttempt(userId, now.getTime());
  const code = normalizeCode(rawCode);
  if (!code) throw new HttpError(400, "Enter a code.");
  const d = await db();
  const gc = await d.getGrantCode(code);
  if (!gc) throw new HttpError(404, "That code doesn't exist — check it for typos.");
  if (!gc.active) throw new HttpError(410, "This code is no longer active.");
  if (gc.expires_at && Date.parse(gc.expires_at) < now.getTime()) throw new HttpError(410, `This code expired on ${fmtDay(gc.expires_at)}.`);
  if (gc.uses >= gc.max_uses) throw new HttpError(410, "This code has been used up.");

  // from here on the code is real: a refusal is about this account, not a guess
  forgive();
  const current = await d.getSubscription(userId);
  if (current && rowSource(current) === "stripe" && current.stripe_subscription_id && ENTITLED.has(current.status)) {
    throw new HttpError(409, "You already pay for a plan; cancel it first or contact support and we'll sort it out.");
  }
  const planName = PLAN_BY_ID[gc.plan].name;
  let expiresAt: Date;
  if (current && rowSource(current) !== "stripe" && grantActive(current, now.getTime())) {
    if (RANK[current.plan] > RANK[gc.plan]) throw new HttpError(409, `You're already on the ${PLAN_BY_ID[current.plan].name} plan, which includes everything in ${planName}.`);
    if (!current.expires_at) throw new HttpError(409, `You already have ${PLAN_BY_ID[current.plan].name} with no end date — this code wouldn't add anything.`);
    expiresAt = addMonths(new Date(Math.max(Date.parse(current.expires_at), now.getTime())), gc.months);
  } else {
    expiresAt = addMonths(now, gc.months);
  }

  if (!(await d.redeemGrantCode(code, userId, now.toISOString()))) {
    // the adapter said no: either this person already has it, or the last use went to someone else just now
    const latest = await d.getGrantCode(code);
    if (latest && latest.uses >= latest.max_uses) throw new HttpError(410, "This code has just been used up.");
    throw new HttpError(409, "You've already redeemed this code.");
  }

  const row: Subscription = {
    user_id: userId,
    plan: gc.plan,
    status: "active",
    interval: null,
    stripe_customer_id: current?.stripe_customer_id ?? null,
    stripe_subscription_id: null,
    price_id: null,
    current_period_end: null,
    cancel_at_period_end: false,
    updated_at: now.toISOString(),
    source: "code",
    note: `Code ${code}${gc.note ? ` — ${gc.note}` : ""}`,
    granted_by: gc.created_by ?? null,
    expires_at: expiresAt.toISOString(),
  };
  const saved = await d.upsertSubscription(row);
  await audit(userId, "code.redeem", userId, { code, plan: gc.plan, months: gc.months, expires_at: row.expires_at, previous: current ? { plan: current.plan, source: rowSource(current), expires_at: current.expires_at ?? null } : null });
  return saved;
}
