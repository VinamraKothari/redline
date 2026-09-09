import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { db } from "@/lib/db";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase-config";
import { ROLE_RANK, type Profile, type Review, type Role } from "@/lib/types";
import { colorFor } from "@/lib/util";

/**
 * Server-side identity. The browser signs in with Google through Supabase
 * Auth; the session lives in cookies (@supabase/ssr) so every API route and
 * server page can verify who is calling.
 *
 * Test mode (REDLINE_TEST_AUTH=1, set only by scripts/e2e.sh) trusts a
 * `redline_test_user` cookie instead, so end-to-end tests can sign in
 * without Google.
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function testAuthEnabled(): boolean {
  return process.env.REDLINE_TEST_AUTH === "1" && !process.env.VERCEL;
}

async function readTestUser(): Promise<SessionUser | null> {
  if (!testAuthEnabled()) return null;
  const raw = (await cookies()).get("redline_test_user")?.value;
  if (!raw) return null;
  try {
    const u = JSON.parse(decodeURIComponent(raw)) as Partial<SessionUser>;
    if (!u.id || !u.email) return null;
    return { id: u.id, email: u.email, name: u.name || u.email.split("@")[0], avatar_url: u.avatar_url || null };
  } catch {
    return null;
  }
}

/** The signed-in user, or null. Never throws. */
export async function currentUser(): Promise<SessionUser | null> {
  const test = await readTestUser();
  if (test) return test;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null;
  const store = await cookies();
  const sb = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: () => {
        /* route handlers can't set cookies here; middleware refreshes sessions */
      },
    },
  });
  // getClaims() verifies the JWT locally against the project's public keys
  // (cached), so the proxy's many per-asset calls don't each hit Supabase.
  const { data } = await sb.auth.getClaims();
  const c = data?.claims as
    | { sub?: string; email?: string; user_metadata?: Record<string, string | undefined> }
    | undefined;
  if (!c?.sub || !c.email) return null;
  const meta = c.user_metadata || {};
  return {
    id: c.sub,
    email: c.email,
    name: meta.full_name || meta.name || c.email.split("@")[0],
    avatar_url: meta.avatar_url || meta.picture || null,
  };
}

/** The signed-in user, or a 401. */
export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) throw new HttpError(401, "Please sign in.");
  return u;
}

/** Upserts the profile row for a signed-in user and claims pending invites. */
export async function syncProfile(u: SessionUser): Promise<Profile> {
  const d = await db();
  const existing = await d.getProfile(u.id);
  const profile: Profile = {
    id: u.id,
    email: u.email,
    name: u.name,
    avatar_url: u.avatar_url,
    color: existing?.color || colorFor(u.email),
    created_at: existing?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await d.upsertProfile(profile);
  await d.claimInvites(u.id, u.email);
  return profile;
}

/** Role of `user` in `projectId`, or null when not a member. */
export async function projectRole(projectId: string, user: SessionUser): Promise<Role | null> {
  const d = await db();
  return d.memberRole(projectId, user.id);
}

export function atLeast(role: Role | null, min: Role): boolean {
  return role !== null && ROLE_RANK[role] >= ROLE_RANK[min];
}

/** Loads a review and the caller's role in its project; 404 when invisible. */
export async function reviewAccess(reviewId: string, min: Role = "view"): Promise<{ user: SessionUser; review: Review; role: Role }> {
  const user = await requireUser();
  const d = await db();
  const review = await d.getReview(reviewId);
  if (!review || !review.project_id) throw new HttpError(404, "This review doesn't exist or you don't have access to it.");
  const role = await d.memberRole(review.project_id, user.id);
  if (!role) throw new HttpError(404, "This review doesn't exist or you don't have access to it.");
  if (!atLeast(role, min)) throw new HttpError(403, min === "admin" ? "Only project admins can do that." : "You have view-only access to this project.");
  return { user, review, role };
}

export async function projectAccess(projectId: string, min: Role = "view"): Promise<{ user: SessionUser; role: Role }> {
  const user = await requireUser();
  const role = await projectRole(projectId, user);
  if (!role) throw new HttpError(404, "This project doesn't exist or you don't have access to it.");
  if (!atLeast(role, min)) throw new HttpError(403, min === "admin" ? "Only project admins can do that." : "You have view-only access to this project.");
  return { user, role };
}

/** Wraps a route handler so thrown HttpErrors become JSON responses. */
export function guarded<A extends unknown[]>(fn: (...a: A) => Promise<Response>): (...a: A) => Promise<Response> {
  return async (...a: A) => {
    try {
      return await fn(...a);
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      console.error("[redline] route failed", e);
      return Response.json({ error: (e as Error).message || "Something went wrong." }, { status: 500 });
    }
  };
}

