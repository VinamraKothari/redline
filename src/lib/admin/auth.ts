import { db } from "@/lib/db";
import { HttpError, requireUser, type SessionUser } from "@/lib/auth/server";

/**
 * Who may open /admin and call /api/admin/*.
 *
 * Two sources, either is enough: a row in the `admins` table (migration 006,
 * managed from the admin area itself) or an e-mail in REDLINE_ADMIN_EMAILS.
 * The env list defaults to the owner so the owner is admin on a fresh
 * database — before migration 006 has run, and even if the table is emptied
 * by mistake. Nothing an admin does can lock the owner out.
 */
const OWNER_EMAIL = "vinamra.kothari@gmx.de";

export function adminEmails(): Set<string> {
  const raw = process.env.REDLINE_ADMIN_EMAILS ?? OWNER_EMAIL;
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function isAdminUser(userId: string, email?: string | null): Promise<boolean> {
  if (email && adminEmails().has(email.toLowerCase())) return true;
  return (await db()).isAdmin(userId);
}

/**
 * The signed-in admin, or 401 / 403. An env-listed admin without a row is
 * given one here: the `admin_collaborators` view (complimentary Team for
 * everyone who shares a project with an admin) only knows about rows, so the
 * owner's collaborators are covered from the first visit to /admin onwards.
 * Best effort — the table may not exist yet on an un-migrated database.
 */
export async function requireAdmin(): Promise<{ user: SessionUser }> {
  const user = await requireUser();
  const d = await db();
  const listed = adminEmails().has(user.email.toLowerCase());
  if (!listed && !(await d.isAdmin(user.id))) throw new HttpError(403, "This area is for Redline admins only.");
  if (listed && !(await d.isAdmin(user.id))) await d.setAdmin(user.id, true, "owner (REDLINE_ADMIN_EMAILS)").catch(() => {});
  return { user };
}
