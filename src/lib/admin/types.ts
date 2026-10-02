import type { PlanId } from "@/lib/billing/plans";
import type { PlanSource } from "@/lib/billing/entitlements";
import type { AuditEntry, Profile, Role, Subscription } from "@/lib/types";
import type { Promo } from "./stripe-promos";

/* ─── Shapes the admin API answers with (shared with lib/api.ts) ───────────── */

export type ProfileLite = Pick<Profile, "id" | "name" | "email" | "avatar_url" | "color">;

/** One row of /admin/users. */
export interface AdminUserListRow {
  profile: Profile;
  is_admin: boolean;
  collaborator: boolean;
  projects_owned: number;
  memberships: number;
  plan: PlanId;
  source: PlanSource;
  until: string | null;
  /** the subscription row's status, when there is a row */
  status: string | null;
}

export interface AdminUserList {
  rows: AdminUserListRow[];
  total: number;
  offset: number;
  limit: number;
}

export interface AuditView extends AuditEntry {
  actor: ProfileLite | null;
  target: ProfileLite | null;
}

/** /admin/users/[id]. */
export interface AdminUserDetail {
  profile: Profile;
  is_admin: boolean;
  /** listed in REDLINE_ADMIN_EMAILS — can't be removed from the admin area */
  env_admin: boolean;
  collaborator: boolean;
  plan: PlanId;
  source: PlanSource;
  until: string | null;
  subscription: Subscription | null;
  /** Stripe is the system of record for this row — the plan form is replaced by a link */
  stripe_managed: boolean;
  stripe_url: string | null;
  granted_by: ProfileLite | null;
  projects: { id: string; name: string; pages: number; members: number; created_at: string }[];
  memberships: { id: string; name: string; role: Role; owner: ProfileLite | null }[];
  audit: AuditView[];
}

export interface AdminStats {
  users: number;
  admins: number;
  /** accounts with an active Stripe subscription */
  paying: number;
  /** manual grants and redeemed codes still running */
  grants: number;
  collaborators: number;
  projects: number;
  pages: number;
  figmaRunsThisMonth: number;
  /** monthly recurring revenue in cents: monthly prices plus yearly prices spread per month */
  mrr: number;
  byInterval: { month: number; year: number };
  byPlan: { pro: number; team: number };
}

export interface PromoList {
  available: boolean;
  note: string | null;
  promos: Promo[];
}
