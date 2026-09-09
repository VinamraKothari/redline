import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DbAdapter } from "./adapter";
import { supabaseSecret } from "./index";
import { SUPABASE_URL } from "@/lib/supabase-config";
import type { Comment, Profile, Project, ProjectInvite, ProjectMember, Review, Role, Shape } from "@/lib/types";

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
};
