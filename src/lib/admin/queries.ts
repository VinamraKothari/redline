import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth/server";
import { effectivePlan, ENTITLED, grantActive, rowSource, startOfMonthIso, stripeManaged } from "@/lib/billing/entitlements";
import { PLAN_BY_ID } from "@/lib/billing/plans";
import type { AuditEntry, Profile } from "@/lib/types";
import { adminEmails } from "./auth";
import { stripeCustomerUrl } from "./grants";
import type { AdminStats, AdminUserDetail, AdminUserList, AuditView, ProfileLite } from "./types";

/**
 * Read models for the admin area. Everything here goes through the storage
 * adapter's admin methods plus the ordinary project/review reads, so both
 * backends serve the same pages.
 */

const lite = (p: Profile | undefined | null): ProfileLite | null => (p ? { id: p.id, name: p.name, email: p.email, avatar_url: p.avatar_url, color: p.color } : null);

/** Audit entries with the actor's and target's profiles attached, in one profile lookup. */
export async function withProfiles(entries: AuditEntry[]): Promise<AuditView[]> {
  const ids = new Set<string>();
  for (const e of entries) {
    if (e.actor_id) ids.add(e.actor_id);
    if (e.target_user_id) ids.add(e.target_user_id);
  }
  const profiles = ids.size ? await (await db()).getProfilesByIds([...ids]) : [];
  const by = new Map(profiles.map((p) => [p.id, p]));
  return entries.map((e) => ({ ...e, actor: lite(e.actor_id ? by.get(e.actor_id) : null), target: lite(e.target_user_id ? by.get(e.target_user_id) : null) }));
}

export async function listUsers(opts: { query: string; offset: number; limit: number }): Promise<AdminUserList> {
  const { rows, total } = await (await db()).listUsers(opts);
  const out = await Promise.all(
    rows.map(async (r) => {
      const eff = await effectivePlan(r.profile.id, { email: r.profile.email, isAdmin: r.is_admin || adminEmails().has(r.profile.email.toLowerCase()), collaborator: r.collaborator, row: r.subscription });
      return {
        profile: r.profile,
        is_admin: eff.source === "admin",
        collaborator: r.collaborator,
        projects_owned: r.projects_owned,
        memberships: r.memberships,
        plan: eff.plan.id,
        source: eff.source,
        until: eff.until,
        status: r.subscription?.status ?? null,
      };
    }),
  );
  return { rows: out, total, offset: opts.offset, limit: opts.limit };
}

export async function userDetail(id: string): Promise<AdminUserDetail> {
  const d = await db();
  const profile = await d.getProfile(id);
  if (!profile) throw new HttpError(404, "No account with that id.");
  const envAdmin = adminEmails().has(profile.email.toLowerCase());
  const [row, isAdmin, collaborator, projects, audit] = await Promise.all([d.getSubscription(id), d.isAdmin(id), d.isAdminCollaborator(id), d.listProjectsFor(id), d.listAudit({ targetUserId: id, limit: 50 })]);
  const eff = await effectivePlan(id, { email: profile.email, isAdmin: isAdmin || envAdmin, collaborator, row });
  const owned = projects.filter((p) => p.created_by === id);
  const others = projects.filter((p) => p.created_by !== id);
  const [memberCounts, owners] = await Promise.all([
    Promise.all(owned.map((p) => d.listMembers(p.id).then((m) => m.length))),
    d.getProfilesByIds([...new Set(others.map((p) => p.created_by))]),
  ]);
  const ownerBy = new Map(owners.map((p) => [p.id, p]));
  const grantedBy = row?.granted_by ? await d.getProfile(row.granted_by) : null;
  return {
    profile,
    is_admin: isAdmin || envAdmin,
    env_admin: envAdmin,
    collaborator,
    plan: eff.plan.id,
    source: eff.source,
    until: eff.until,
    subscription: row,
    stripe_managed: stripeManaged(row),
    stripe_url: row?.stripe_customer_id ? stripeCustomerUrl(row.stripe_customer_id) : null,
    granted_by: lite(grantedBy),
    projects: owned.map((p, i) => ({ id: p.id, name: p.name, pages: p.review_count, members: memberCounts[i], created_at: p.created_at })),
    memberships: others.map((p) => ({ id: p.id, name: p.name, role: p.role, owner: lite(ownerBy.get(p.created_by)) })),
    audit: await withProfiles(audit),
  };
}

/** Runs `fn` over `items` a few at a time — the stats touch every account, and the backend shouldn't see them all at once. */
async function inBatches<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

/**
 * The overview numbers. Walks every account (the adapter has no aggregate
 * queries), which is fine for the hundreds of users this is built for; the
 * figures are plain counts, not a finance report.
 */
export async function stats(): Promise<AdminStats> {
  const d = await db();
  // Supabase answers at most 1000 rows per request, so the list is paged
  const PAGE = 1000;
  const first = await d.listUsers({ limit: PAGE, offset: 0 });
  const rows = [...first.rows];
  for (let offset = PAGE; offset < first.total; offset += PAGE) rows.push(...(await d.listUsers({ limit: PAGE, offset })).rows);
  const total = first.total;
  const since = startOfMonthIso();
  const now = Date.now();
  const envAdmins = adminEmails();
  const s: AdminStats = { users: total, admins: 0, paying: 0, grants: 0, collaborators: 0, projects: 0, pages: 0, figmaRunsThisMonth: 0, mrr: 0, byInterval: { month: 0, year: 0 }, byPlan: { pro: 0, team: 0 } };
  for (const r of rows) {
    if (r.is_admin || envAdmins.has(r.profile.email.toLowerCase())) s.admins++;
    if (r.collaborator) s.collaborators++;
    s.projects += r.projects_owned;
    const sub = r.subscription;
    if (!sub) continue;
    if (rowSource(sub) === "stripe") {
      if (sub.stripe_subscription_id && ENTITLED.has(sub.status) && sub.plan !== "free") {
        s.paying++;
        const plan = PLAN_BY_ID[sub.plan];
        if (sub.plan === "pro" || sub.plan === "team") s.byPlan[sub.plan]++;
        if (sub.interval === "year") {
          s.byInterval.year++;
          s.mrr += plan.yearly;
        } else {
          s.byInterval.month++;
          s.mrr += plan.monthly;
        }
      }
    } else if (grantActive(sub, now)) {
      s.grants++;
    }
  }
  const perUser = await inBatches(rows, 10, async (r) => {
    const [runs, projects] = await Promise.all([d.countFigmaRuns(r.profile.id, since), r.projects_owned ? d.listProjectsFor(r.profile.id) : Promise.resolve([])]);
    return { runs, pages: projects.filter((p) => p.created_by === r.profile.id).reduce((n, p) => n + p.review_count, 0) };
  });
  for (const u of perUser) {
    s.figmaRunsThisMonth += u.runs;
    s.pages += u.pages;
  }
  return s;
}
