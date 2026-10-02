import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DbAdapter } from "./adapter";
import { supabaseSecret } from "./index";
import { SUPABASE_URL } from "@/lib/supabase-config";
import type { AdminUserRow, AuditEntry, Comment, GrantCode, Profile, Project, ProjectInvite, ProjectMember, Review, Role, Shape, Subscription, UserSettings } from "@/lib/types";

const BUCKET = "snapshots";
const THUMBS = "thumbnails";
const RANK: Record<Role, number> = { view: 0, edit: 1, admin: 2 };

let client: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (client) return client;
  const url = SUPABASE_URL;
  const key = supabaseSecret()!;
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export const supabaseDb: DbAdapter = {
  /* identity */
  async getProfile(id) {
    const { data } = await sb().from("profiles").select().eq("id", id).maybeSingle<Profile>();
    return data ?? null;
  },
  async getProfilesByIds(ids) {
    if (!ids.length) return [];
    return must(await sb().from("profiles").select().in("id", ids).returns<Profile[]>());
  },
  async upsertProfile(p) {
    return must(await sb().from("profiles").upsert(p).select().single<Profile>());
  },
  async getSettings(userId) {
    const { data, error } = await sb().from("user_settings").select("settings").eq("user_id", userId).maybeSingle<{ settings: UserSettings }>();
    if (error) return {};
    return data?.settings ?? {};
  },
  async putSettings(userId, settings) {
    const { error } = await sb().from("user_settings").upsert({ user_id: userId, settings, updated_at: new Date().toISOString() });
    if (error) throw new Error(/user_settings/.test(error.message) ? "Settings storage is not set up yet (run migration 005)." : error.message);
  },

  /* billing */
  async getSubscription(userId) {
    const { data, error } = await sb().from("subscriptions").select().eq("user_id", userId).maybeSingle<Subscription>();
    if (error) return null;
    return data ?? null;
  },
  async getSubscriptionByCustomer(customerId) {
    const { data, error } = await sb().from("subscriptions").select().eq("stripe_customer_id", customerId).maybeSingle<Subscription>();
    if (error) return null;
    return data ?? null;
  },
  async upsertSubscription(sub) {
    return must(await sb().from("subscriptions").upsert(sub).select().single<Subscription>());
  },
  async countFigmaRuns(userId, sinceIso) {
    const { count, error } = await sb().from("figma_runs").select("*", { count: "exact", head: true }).eq("user_id", userId).gte("at", sinceIso);
    if (error) return 0;
    return count ?? 0;
  },
  async recordFigmaRun(userId, reviewId, atIso) {
    const { error } = await sb().from("figma_runs").insert({ user_id: userId, review_id: reviewId, at: atIso });
    if (error && !/figma_runs/.test(error.message)) throw new Error(error.message);
  },

  /* admin — every read tolerates a missing migration-006 table (→ "no", "none") */
  async isAdmin(userId) {
    const { data, error } = await sb().from("admins").select("user_id").eq("user_id", userId).maybeSingle();
    return !error && !!data;
  },
  async listAdmins() {
    const { data, error } = await sb().from("admins").select("user_id, profiles(*)").returns<{ user_id: string; profiles: Profile }[]>();
    if (error) return [];
    return (data ?? []).map((r) => r.profiles).filter(Boolean);
  },
  async setAdmin(userId, admin, note) {
    if (admin) must(await sb().from("admins").upsert({ user_id: userId, note: note ?? null }));
    else must(await sb().from("admins").delete().eq("user_id", userId));
  },
  async isAdminCollaborator(userId) {
    const { data, error } = await sb().from("admin_collaborators").select("user_id").eq("user_id", userId).maybeSingle();
    return !error && !!data;
  },
  async listUsers({ query = "", limit = 50, offset = 0 }) {
    const q = query.trim();
    let req = sb().from("profiles").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
    if (q) req = req.or(`name.ilike.%${q.replace(/[%,()]/g, "")}%,email.ilike.%${q.replace(/[%,()]/g, "")}%`);
    const { data, count, error } = await req.returns<Profile[]>();
    if (error) throw new Error(error.message);
    const profiles = data ?? [];
    const ids = profiles.map((p) => p.id);
    if (!ids.length) return { rows: [], total: count ?? 0 };
    const [subs, admins, collabs, owned, members] = await Promise.all([
      sb().from("subscriptions").select().in("user_id", ids).returns<Subscription[]>(),
      sb().from("admins").select("user_id").in("user_id", ids).returns<{ user_id: string }[]>(),
      sb().from("admin_collaborators").select("user_id").in("user_id", ids).returns<{ user_id: string }[]>(),
      sb().from("projects").select("created_by").in("created_by", ids).returns<{ created_by: string }[]>(),
      sb().from("project_members").select("user_id").in("user_id", ids).returns<{ user_id: string }[]>(),
    ]);
    const subBy = new Map((subs.data ?? []).map((x) => [x.user_id, x]));
    const adminSet = new Set((admins.data ?? []).map((x) => x.user_id));
    const collabSet = new Set((collabs.data ?? []).map((x) => x.user_id));
    const ownedBy = new Map<string, number>();
    for (const o of owned.data ?? []) ownedBy.set(o.created_by, (ownedBy.get(o.created_by) ?? 0) + 1);
    const memBy = new Map<string, number>();
    for (const m of members.data ?? []) memBy.set(m.user_id, (memBy.get(m.user_id) ?? 0) + 1);
    const rows: AdminUserRow[] = profiles.map((profile) => ({
      profile,
      subscription: subBy.get(profile.id) ?? null,
      is_admin: adminSet.has(profile.id),
      collaborator: collabSet.has(profile.id),
      projects_owned: ownedBy.get(profile.id) ?? 0,
      memberships: memBy.get(profile.id) ?? 0,
    }));
    return { rows, total: count ?? rows.length };
  },
  async deleteSubscription(userId) {
    must(await sb().from("subscriptions").delete().eq("user_id", userId));
  },
  async getGrantCode(code) {
    const { data, error } = await sb().from("grant_codes").select().eq("code", code.toUpperCase()).maybeSingle<GrantCode>();
    if (error) return null;
    return data ?? null;
  },
  async listGrantCodes() {
    const { data, error } = await sb().from("grant_codes").select().order("created_at", { ascending: false }).returns<GrantCode[]>();
    if (error) return [];
    return data ?? [];
  },
  async upsertGrantCode(c) {
    return must(await sb().from("grant_codes").upsert({ ...c, code: c.code.toUpperCase() }).select().single<GrantCode>());
  },
  /**
   * Counts a redemption atomically: migration 007's `redeem_grant_code` does the
   * insert and the conditional increment in one transaction. Before that
   * migration has run, the fallback is an optimistic compare-and-set on
   * `uses` (the update only lands if nobody else bumped it meanwhile, and only
   * while `uses < max_uses`), which also never over-counts.
   */
  async redeemGrantCode(code, userId, atIso) {
    const key = code.toUpperCase();
    const rpc = await sb().rpc("redeem_grant_code", { p_code: key, p_user: userId });
    if (!rpc.error) return Boolean(rpc.data);
    if (!/redeem_grant_code|function|schema cache/i.test(rpc.error.message)) throw new Error(rpc.error.message);

    const { error } = await sb().from("grant_redemptions").insert({ code: key, user_id: userId, at: atIso });
    if (error) {
      if (/duplicate|unique/i.test(error.message)) return false;
      throw new Error(error.message);
    }
    const undo = async () => {
      await sb().from("grant_redemptions").delete().eq("code", key).eq("user_id", userId);
      return false;
    };
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: gc } = await sb().from("grant_codes").select("uses, max_uses, active, expires_at").eq("code", key).maybeSingle<{ uses: number; max_uses: number; active: boolean; expires_at: string | null }>();
      if (!gc || !gc.active || gc.uses >= gc.max_uses || (gc.expires_at && Date.parse(gc.expires_at) < Date.now())) return undo();
      const { data: updated, error: upErr } = await sb().from("grant_codes").update({ uses: gc.uses + 1 }).eq("code", key).eq("uses", gc.uses).lt("uses", gc.max_uses).select("code");
      if (upErr) throw new Error(upErr.message);
      if (updated && updated.length) return true;
      // somebody else bumped `uses` first: read again and retry
    }
    return undo();
  },
  async appendAudit(e) {
    const { error } = await sb().from("audit_log").insert({ actor_id: e.actor_id, action: e.action, target_user_id: e.target_user_id, details: e.details, at: e.at });
    if (error && !/audit_log/.test(error.message)) throw new Error(error.message);
  },
  async listAudit({ limit = 100, targetUserId }) {
    let req = sb().from("audit_log").select().order("at", { ascending: false }).limit(limit);
    if (targetUserId) req = req.eq("target_user_id", targetUserId);
    const { data, error } = await req.returns<AuditEntry[]>();
    if (error) return [];
    return data ?? [];
  },
  async deleteAccount(userId) {
    // projects the account owns go first (their reviews, comments and shapes cascade in Postgres)
    const { data: owned } = await sb().from("projects").select("id").eq("created_by", userId).returns<{ id: string }[]>();
    for (const p of owned ?? []) must(await sb().from("projects").delete().eq("id", p.id));
    must(await sb().from("profiles").delete().eq("id", userId));
    // the auth user, so the e-mail can sign up fresh later; ignore when it is already gone
    const { error } = await sb().auth.admin.deleteUser(userId);
    if (error && !/not found/i.test(error.message)) throw new Error(error.message);
  },

  /* projects & membership */
  async createProject(p, owner) {
    const project = must(await sb().from("projects").insert(p).select().single<Project>());
    must(await sb().from("project_members").upsert({ project_id: p.id, user_id: owner, role: "admin" }));
    return project;
  },
  async getProject(id) {
    const { data } = await sb().from("projects").select().eq("id", id).maybeSingle<Project>();
    return data ?? null;
  },
  async updateProject(id, patch) {
    const { data } = await sb()
      .from("projects")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .maybeSingle<Project>();
    return data ?? null;
  },
  async deleteProject(id) {
    must(await sb().from("projects").delete().eq("id", id));
  },
  async listProjectsFor(userId) {
    const memberships = must(
      await sb().from("project_members").select("project_id, role, projects(*)").eq("user_id", userId).returns<{ project_id: string; role: Role; projects: Project }[]>(),
    );
    const ids = memberships.map((m) => m.project_id);
    if (!ids.length) return [];
    const reviews = must(
      await sb()
        .from("reviews")
        .select("project_id, thumbnail_url, created_at")
        .in("project_id", ids)
        .order("created_at", { ascending: false })
        .returns<{ project_id: string; thumbnail_url: string | null }[]>(),
    );
    const counts = new Map<string, number>();
    const previews = new Map<string, string[]>();
    for (const r of reviews) {
      counts.set(r.project_id, (counts.get(r.project_id) || 0) + 1);
      if (r.thumbnail_url) {
        const list = previews.get(r.project_id) || [];
        if (list.length < 3) list.push(r.thumbnail_url);
        previews.set(r.project_id, list);
      }
    }
    return memberships
      .filter((m) => m.projects)
      .map((m) => ({ ...m.projects, role: m.role, review_count: counts.get(m.project_id) || 0, preview_urls: previews.get(m.project_id) || [] }))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  },
  async listReviews(projectId) {
    return must(await sb().from("reviews").select().eq("project_id", projectId).order("created_at", { ascending: false }).returns<Review[]>());
  },
  async memberRole(projectId, userId) {
    const { data } = await sb().from("project_members").select("role").eq("project_id", projectId).eq("user_id", userId).maybeSingle<{ role: Role }>();
    return data?.role ?? null;
  },
  async listMembers(projectId) {
    const rows = must(
      await sb()
        .from("project_members")
        .select("project_id, user_id, role, created_at, profiles(id, email, name, avatar_url, color)")
        .eq("project_id", projectId)
        .returns<(ProjectMember & { profiles: ProjectMember["profile"] })[]>(),
    );
    return rows.map(({ profiles, ...m }) => ({ ...m, profile: profiles })).sort((a, b) => a.created_at.localeCompare(b.created_at));
  },
  async setMember(projectId, userId, role) {
    must(await sb().from("project_members").upsert({ project_id: projectId, user_id: userId, role }));
  },
  async removeMember(projectId, userId) {
    must(await sb().from("project_members").delete().eq("project_id", projectId).eq("user_id", userId));
  },
  async listInvites(projectId) {
    return must(
      await sb().from("project_invites").select().eq("project_id", projectId).is("accepted_at", null).order("created_at").returns<ProjectInvite[]>(),
    );
  },
  async upsertInvite(i) {
    // one pending invite per (project, e-mail): replace an existing one
    must(await sb().from("project_invites").delete().eq("project_id", i.project_id).ilike("email", i.email));
    return must(await sb().from("project_invites").insert(i).select().single<ProjectInvite>());
  },
  async deleteInvite(id) {
    must(await sb().from("project_invites").delete().eq("id", id));
  },
  async claimInvites(userId, email) {
    const pending = must(await sb().from("project_invites").select().ilike("email", email).is("accepted_at", null).returns<ProjectInvite[]>());
    for (const inv of pending) {
      const current = await this.memberRole(inv.project_id, userId);
      // an invite never demotes an existing member
      if (!current || RANK[inv.role] > RANK[current]) await this.setMember(inv.project_id, userId, inv.role);
      must(await sb().from("project_invites").update({ accepted_at: new Date().toISOString() }).eq("id", inv.id));
    }
  },

  async createReview(r) {
    return must(await sb().from("reviews").insert(r).select().single<Review>());
  },
  async getReview(id) {
    const { data } = await sb().from("reviews").select().eq("id", id).maybeSingle<Review>();
    return data ?? null;
  },
  async updateReview(id, patch) {
    const { data } = await sb()
      .from("reviews")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .maybeSingle<Review>();
    return data ?? null;
  },
  async deleteReview(id) {
    must(await sb().from("reviews").delete().eq("id", id));
  },

  async listComments(reviewId) {
    return must(
      await sb()
        .from("comments")
        .select()
        .eq("review_id", reviewId)
        .order("created_at", { ascending: true })
        .returns<Comment[]>(),
    );
  },
  async getComment(id) {
    const { data } = await sb().from("comments").select().eq("id", id).maybeSingle<Comment>();
    return data ?? null;
  },
  async createComment(c) {
    return must(await sb().from("comments").insert(c).select().single<Comment>());
  },
  async createComments(cs) {
    const out: Comment[] = [];
    for (let i = 0; i < cs.length; i += 100) out.push(...must(await sb().from("comments").insert(cs.slice(i, i + 100)).select().returns<Comment[]>()));
    return out;
  },
  async updateComment(id, patch) {
    const { data } = await sb().from("comments").update(patch).eq("id", id).select().maybeSingle<Comment>();
    return data ?? null;
  },
  async deleteComment(id) {
    must(await sb().from("comments").delete().eq("id", id));
  },
  async deleteThread(rootId) {
    must(await sb().from("comments").delete().eq("parent_id", rootId));
    must(await sb().from("comments").delete().eq("id", rootId));
  },

  async listShapes(reviewId) {
    return must(
      await sb().from("shapes").select().eq("review_id", reviewId).order("z", { ascending: true }).returns<Shape[]>(),
    );
  },
  async getShape(id) {
    const { data } = await sb().from("shapes").select().eq("id", id).maybeSingle<Shape>();
    return data ?? null;
  },
  async upsertShape(s) {
    return must(await sb().from("shapes").upsert(s).select().single<Shape>());
  },
  async updateShape(id, patch) {
    const { data } = await sb()
      .from("shapes")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .maybeSingle<Shape>();
    return data ?? null;
  },
  async deleteShape(id) {
    must(await sb().from("shapes").delete().eq("id", id));
  },
  async deleteShapes(reviewId, viewport) {
    let q = sb().from("shapes").delete().eq("review_id", reviewId);
    if (viewport !== null) q = q.eq("viewport_width", viewport);
    must(await q);
  },

  async putSnapshot(p, html) {
    const { error } = await sb()
      .storage.from(BUCKET)
      .upload(p, new Blob([html], { type: "text/html" }), { upsert: true, contentType: "text/html" });
    if (error) throw new Error(error.message);
  },
  async getSnapshot(p) {
    const { data, error } = await sb().storage.from(BUCKET).download(p);
    if (error || !data) return null;
    return await data.text();
  },

  /* read state — table from migration 004; missing table degrades to local-only */
  async getReads(userId, reviewId) {
    const { data, error } = await sb().from("review_reads").select("reads").eq("user_id", userId).eq("review_id", reviewId).maybeSingle<{ reads: Record<string, string> }>();
    if (error) return {};
    return data?.reads ?? {};
  },
  async putReads(userId, reviewId, reads) {
    const { error } = await sb().from("review_reads").upsert({ user_id: userId, review_id: reviewId, reads, updated_at: new Date().toISOString() });
    if (error && !/review_reads/.test(error.message)) throw new Error(error.message);
  },

  async putThumbnail(reviewId, bytes, contentType) {
    const path = `${reviewId}.jpg`;
    const { error } = await sb().storage.from(THUMBS).upload(path, new Blob([bytes as BlobPart], { type: contentType }), { upsert: true, contentType, cacheControl: "300" });
    if (error) throw new Error(error.message);
    const { data } = sb().storage.from(THUMBS).getPublicUrl(path);
    return `${data.publicUrl}?v=${Date.now()}`;
  },
  async getThumbnail(reviewId) {
    const { data, error } = await sb().storage.from(THUMBS).download(`${reviewId}.jpg`);
    if (error || !data) return null;
    return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type || "image/jpeg" };
  },

  async putPublicFile(p, bytes, contentType) {
    const { error } = await sb().storage.from(THUMBS).upload(p, new Blob([bytes as BlobPart], { type: contentType }), { upsert: true, contentType, cacheControl: "31536000" });
    if (error) throw new Error(error.message);
    return sb().storage.from(THUMBS).getPublicUrl(p).data.publicUrl;
  },
  async createPublicUpload(p, contentType) {
    const { data, error } = await sb().storage.from(THUMBS).createSignedUploadUrl(p);
    if (error || !data) throw new Error(error?.message || "Couldn't prepare the upload.");
    return {
      uploadUrl: data.signedUrl,
      headers: { "content-type": contentType, "cache-control": "max-age=31536000" },
      url: sb().storage.from(THUMBS).getPublicUrl(p).data.publicUrl,
    };
  },
  async putPrivateFile(p, bytes, contentType) {
    const { error } = await sb().storage.from(BUCKET).upload(p, new Blob([bytes as BlobPart], { type: contentType }), { upsert: true, contentType });
    if (error) throw new Error(error.message);
  },
  async privateFileUrl(p, ttl) {
    const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(p, ttl);
    if (error || !data) throw new Error(error?.message || "Could not sign the file URL.");
    return data.signedUrl;
  },
  async getFile() {
    return null;
  },
};
