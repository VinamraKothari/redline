import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { currentUser, guarded, HttpError, requireUser, syncProfile } from "@/lib/auth/server";
import { isAdminUser } from "@/lib/admin/auth";
import { cancelSubscriptionNow } from "@/lib/billing/stripe";
import { AUTHOR_COLORS, type Profile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in profile (created/updated on the fly, pending invites claimed), with `is_admin` for the account menu. */
export const GET = guarded(async () => {
  const u = await currentUser();
  if (!u) return Response.json({ user: null }, { status: 401 });
  const [profile, is_admin] = await Promise.all([syncProfile(u), isAdminUser(u.id, u.email)]);
  return Response.json({ user: { ...profile, is_admin }, is_admin });
});

/**
 * Edit the profile: the display name (what comments and the account menu
 * show) and the accent colour of your pins. E-mail and picture stay what
 * Google says they are. A trimmed name of 1–80 characters; a colour from the
 * palette every avatar is drawn from, so pins stay legible on the canvas.
 */
export const PATCH = guarded(async (req: NextRequest) => {
  const u = await requireUser();
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; color?: unknown };
  const patch: Partial<Pick<Profile, "name" | "color">> = {};
  if (body.name !== undefined) {
    // invisible characters (controls, zero-width joiners, bidi marks) can't be part of a name people read
    const name = typeof body.name === "string" ? body.name.replace(/\p{C}/gu, "").trim().replace(/\s+/g, " ") : "";
    if (name.length < 1 || name.length > 80) throw new HttpError(400, "Enter a name between 1 and 80 characters.");
    patch.name = name;
  }
  if (body.color !== undefined) {
    if (typeof body.color !== "string" || !AUTHOR_COLORS.includes(body.color)) throw new HttpError(400, "Pick one of the colours shown.");
    patch.color = body.color;
  }
  if (!Object.keys(patch).length) throw new HttpError(400, "Nothing to change.");
  // syncProfile makes sure the row exists (first visit straight to /account) before the edit lands on it
  const current = await syncProfile(u);
  const profile = await (await db()).upsertProfile({ ...current, ...patch, updated_at: new Date().toISOString() });
  return Response.json({ user: profile });
});

/**
 * Delete the account. The subscription is cancelled at Stripe first (so a
 * failure there stops the deletion rather than leaving a paying ghost), then
 * the adapter removes the profile and everything it owns, and the session
 * cookies are cleared so the browser is signed out before it lands on `/`.
 */
export const DELETE = guarded(async () => {
  const u = await requireUser();
  const d = await db();
  const sub = await d.getSubscription(u.id);
  if (sub?.stripe_subscription_id && (sub.source ?? "stripe") === "stripe" && ["active", "trialing", "past_due"].includes(sub.status)) {
    await cancelSubscriptionNow(sub.stripe_subscription_id);
  }
  await d.deleteAccount(u.id);
  const store = await cookies();
  for (const c of store.getAll()) if (c.name === "redline_test_user" || /^sb-.*-auth-token/.test(c.name)) store.delete(c.name);
  return Response.json({ ok: true });
});
