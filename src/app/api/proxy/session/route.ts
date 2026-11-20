import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, HttpError, requireUser } from "@/lib/auth/server";
import { siteKeyOf } from "@/lib/proxy/cookies";
import { loadJar } from "@/lib/proxy/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the proxy keeps for the signed-in account on the reviewed site, and a
 * way to forget it. `signedIn`: a live cookie that a login set (see
 * SiteCookie.auth). `kept`: the jar holds anything at all — a session cookie
 * set on a plain GET counts here, so "Forget login" is always reachable.
 * Never returns cookie names or values.
 */
function hostOf(req: NextRequest): string {
  const raw = req.nextUrl.searchParams.get("url") || "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
    return u.hostname;
  } catch {
    throw new HttpError(400, "That doesn't look like a URL.");
  }
}

export const GET = guarded(async (req: NextRequest) => {
  const user = await requireUser();
  const { site, jar, updatedAt } = await loadJar(user.id, hostOf(req));
  return Response.json({ site, signedIn: jar.signedIn, kept: jar.size > 0, updated_at: updatedAt });
});

export const DELETE = guarded(async (req: NextRequest) => {
  const user = await requireUser();
  const site = siteKeyOf(hostOf(req));
  await (await db()).deleteSiteCookies(user.id, site);
  return Response.json({ site, signedIn: false, kept: false, updated_at: null });
});
