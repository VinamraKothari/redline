import type { NextRequest } from "next/server";
import { testAuthEnabled } from "@/lib/auth/server";
import { fakeGrantOnSignIn } from "@/lib/billing/fake";

export const runtime = "nodejs";

/**
 * Test-only sign-in (REDLINE_TEST_AUTH=1, never on Vercel): sets the cookie
 * the server trusts instead of a Supabase session, so e2e tests can act as
 * any user without Google. With the billing fake on, first sign-in also puts
 * the account on a plan (see lib/billing/fake.ts) so the suite isn't gated.
 */
export async function POST(req: NextRequest) {
  if (!testAuthEnabled()) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { id?: string; email?: string; name?: string };
  if (!body.id || !body.email) return Response.json({ error: "id and email required" }, { status: 400 });
  await fakeGrantOnSignIn(body.id);
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
