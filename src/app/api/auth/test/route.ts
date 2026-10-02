import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { syncProfile, testAuthEnabled } from "@/lib/auth/server";
import { fakeGrantOnSignIn } from "@/lib/billing/fake";

export const runtime = "nodejs";

/**
 * Test-only sign-in (REDLINE_TEST_AUTH=1, never on Vercel): sets the cookie
 * the server trusts instead of a Supabase session, so e2e tests can act as
 * any user without Google. With the billing fake on, first sign-in also puts
 * the account on a plan (see lib/billing/fake.ts) so the suite isn't gated.
 *
 * A test user whose name contains "Admin" (e.g. "Ada Admin") is made a Redline
 * admin on sign-in — the e2e suite's way into /admin without touching
 * REDLINE_ADMIN_EMAILS. Test mode only, like everything else here.
 */
export async function POST(req: NextRequest) {
  if (!testAuthEnabled()) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { id?: string; email?: string; name?: string };
  if (!body.id || !body.email) return Response.json({ error: "id and email required" }, { status: 400 });
  await fakeGrantOnSignIn(body.id);
  if (/admin/i.test(body.name || "")) {
    // the admins row references the profile, so make sure the profile exists first
    await syncProfile({ id: body.id, email: body.email, name: body.name || body.email, avatar_url: null });
    await (await db()).setAdmin(body.id, true, "test sign-in");
  }
  const value = encodeURIComponent(JSON.stringify({ id: body.id, email: body.email, name: body.name || body.email.split("@")[0] }));
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json", "set-cookie": `redline_test_user=${value}; Path=/; HttpOnly; SameSite=Lax` },
  });
}

export async function DELETE() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json", "set-cookie": "redline_test_user=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" },
  });
}
