import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, HttpError } from "@/lib/auth/server";
import { requireAdmin } from "@/lib/admin/auth";
import { createCode, parseMonths } from "@/lib/admin/grants";
import { isPaidPlan } from "@/lib/billing/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** All redeemable codes, newest first. */
export const GET = guarded(async () => {
  await requireAdmin();
  return Response.json({ codes: await (await db()).listGrantCodes() });
});

/** POST { code?, plan, months, max_uses, expires_at?, note } → the new code (generated when `code` is blank). */
export const POST = guarded(async (req: NextRequest) => {
  const { user } = await requireAdmin();
  const body = (await req.json().catch(() => ({}))) as { code?: unknown; plan?: unknown; months?: unknown; max_uses?: unknown; expires_at?: unknown; note?: unknown };
  if (!isPaidPlan(body.plan)) throw new HttpError(400, "A code grants Pro or Team.");
  const months = parseMonths(body.months);
  if (!months) throw new HttpError(400, "How many months should the code grant?");
  const maxUses = body.max_uses === undefined || body.max_uses === "" ? 1 : Number(body.max_uses);
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100000) throw new HttpError(400, "Max uses must be a whole number of at least 1.");
  let expiresAt: string | null = null;
  if (body.expires_at) {
    const t = Date.parse(String(body.expires_at));
    if (!t) throw new HttpError(400, "That expiry date isn't valid.");
    if (t < Date.now()) throw new HttpError(400, "The expiry date must be in the future.");
    expiresAt = new Date(t).toISOString();
  }
  const code = await createCode({ code: typeof body.code === "string" ? body.code : undefined, plan: body.plan, months, max_uses: maxUses, expires_at: expiresAt, note: String(body.note ?? "").trim().slice(0, 200), actorId: user.id });
  return Response.json({ code });
});
