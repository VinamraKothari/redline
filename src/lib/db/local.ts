import { promises as fs } from "node:fs";
import path from "node:path";
import type { DbAdapter } from "./adapter";
import type { Comment, Profile, Project, ProjectInvite, ProjectMember, Review, Role, Shape } from "@/lib/types";

/**
 * Development fallback: a single JSON file under .data/.
 * Not for production (Vercel's filesystem is ephemeral) — it exists so the app
 * runs end-to-end before Supabase credentials are configured.
 */
interface Store {
  reviews: Record<string, Review>;
  comments: Record<string, Comment>;
  shapes: Record<string, Shape>;
  profiles: Record<string, Profile>;
  projects: Record<string, Project>;
  members: Record<string, ProjectMember>; // key: project_id/user_id
  invites: Record<string, ProjectInvite>;
}
const RANK: Record<Role, number> = { view: 0, edit: 1, admin: 2 };
const empty = (): Store => ({ reviews: {}, comments: {}, shapes: {}, profiles: {}, projects: {}, members: {}, invites: {} });

const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "redline.json");
const SNAP_DIR = path.join(DIR, "snapshots");
const THUMB_DIR = path.join(DIR, "thumbnails");

let cache: Store | null = null;
let writing: Promise<void> = Promise.resolve();

/**
 * Always re-read from disk: Next.js gives each route its own module instance,
 * so an in-memory cache would go stale between the page and the API routes.
 */
async function load(): Promise<Store> {
  await writing;
  try {
    const raw = await fs.readFile(FILE, "utf8");
    cache = { ...empty(), ...(JSON.parse(raw) as Partial<Store>) };
  } catch {
    cache = empty();
  }
  return cache;
}

async function persist() {
  const data = JSON.stringify(cache, null, 1);
  writing = writing.then(async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(FILE, data, "utf8");
  });
  await writing;
}

export const localDb: DbAdapter = {
  /* identity */
  async getProfile(id) {
    return (await load()).profiles[id] ?? null;
  },
  async getProfilesByIds(ids) {
    const s = await load();
    return ids.map((i) => s.profiles[i]).filter(Boolean);
  },
  async upsertProfile(p) {
    const s = await load();
    s.profiles[p.id] = p;
    await persist();
    return p;
  },

  /* projects & membership */
  async createProject(p, owner) {
    const s = await load();
    s.projects[p.id] = p;
    s.members[`${p.id}/${owner}`] = { project_id: p.id, user_id: owner, role: "admin", created_at: p.created_at };
    await persist();
    return p;
  },
  async getProject(id) {
    return (await load()).projects[id] ?? null;
  },
  async updateProject(id, patch) {
    const s = await load();
    if (!s.projects[id]) return null;
    s.projects[id] = { ...s.projects[id], ...patch, updated_at: new Date().toISOString() };
    await persist();
    return s.projects[id];
  },
  async deleteProject(id) {
    const s = await load();
    delete s.projects[id];
    for (const [k, m] of Object.entries(s.members)) if (m.project_id === id) delete s.members[k];
    for (const [k, i] of Object.entries(s.invites)) if (i.project_id === id) delete s.invites[k];
    for (const r of Object.values(s.reviews)) if (r.project_id === id) await this.deleteReview(r.id);
    await persist();
  },
  async listProjectsFor(userId) {
    const s = await load();
    return Object.values(s.members)
      .filter((m) => m.user_id === userId && s.projects[m.project_id])
      .map((m) => {
        const revs = Object.values(s.reviews)
          .filter((r) => r.project_id === m.project_id)
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
        return {
          ...s.projects[m.project_id],
          role: m.role,
          review_count: revs.length,
          preview_urls: revs.map((r) => r.thumbnail_url).filter((u): u is string => Boolean(u)).slice(0, 3),
        };
      })
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  },
  async listReviews(projectId) {
    const s = await load();
    return Object.values(s.reviews)
      .filter((r) => r.project_id === projectId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  },
  async memberRole(projectId, userId) {
    return (await load()).members[`${projectId}/${userId}`]?.role ?? null;
  },
  async listMembers(projectId) {
    const s = await load();
    return Object.values(s.members)
      .filter((m) => m.project_id === projectId)
      .map((m) => ({ ...m, profile: s.profiles[m.user_id] }))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  },
  async setMember(projectId, userId, role) {
    const s = await load();
    const k = `${projectId}/${userId}`;
    s.members[k] = { project_id: projectId, user_id: userId, role, created_at: s.members[k]?.created_at || new Date().toISOString() };
    await persist();
  },
  async removeMember(projectId, userId) {
    const s = await load();
    delete s.members[`${projectId}/${userId}`];
    await persist();
  },
  async listInvites(projectId) {
    const s = await load();
    return Object.values(s.invites)
      .filter((i) => i.project_id === projectId && !i.accepted_at)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  },
  async upsertInvite(i) {
    const s = await load();
    for (const [k, x] of Object.entries(s.invites)) {
      if (x.project_id === i.project_id && x.email.toLowerCase() === i.email.toLowerCase()) delete s.invites[k];
    }
    s.invites[i.id] = i;
    await persist();
    return i;
  },
  async deleteInvite(id) {
    const s = await load();
    delete s.invites[id];
    await persist();
  },
  async claimInvites(userId, email) {
    const s = await load();
    for (const inv of Object.values(s.invites)) {
      if (inv.accepted_at || inv.email.toLowerCase() !== email.toLowerCase()) continue;
      const k = `${inv.project_id}/${userId}`;
      const cur = s.members[k]?.role ?? null;
      if (!cur || RANK[inv.role] > RANK[cur]) {
        s.members[k] = { project_id: inv.project_id, user_id: userId, role: inv.role, created_at: s.members[k]?.created_at || new Date().toISOString() };
      }
      inv.accepted_at = new Date().toISOString();
    }
    await persist();
  },

  async createReview(r) {
    const s = await load();
    s.reviews[r.id] = r;
    await persist();
    return r;
  },
  async getReview(id) {
    const s = await load();
    return s.reviews[id] ?? null;
  },
  async updateReview(id, patch) {
    const s = await load();
    if (!s.reviews[id]) return null;
    s.reviews[id] = { ...s.reviews[id], ...patch, updated_at: new Date().toISOString() };
    await persist();
    return s.reviews[id];
  },
  async deleteReview(id) {
    const s = await load();
    delete s.reviews[id];
    for (const c of Object.values(s.comments)) if (c.review_id === id) delete s.comments[c.id];
    for (const sh of Object.values(s.shapes)) if (sh.review_id === id) delete s.shapes[sh.id];
    await persist();
  },

  async listComments(reviewId) {
    const s = await load();
    return Object.values(s.comments)
      .filter((c) => c.review_id === reviewId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  },
  async getComment(id) {
    const s = await load();
    return s.comments[id] ?? null;
  },
  async createComment(c) {
    const s = await load();
    s.comments[c.id] = c;
    await persist();
    return c;
  },
  async updateComment(id, patch) {
    const s = await load();
    if (!s.comments[id]) return null;
    s.comments[id] = { ...s.comments[id], ...patch };
    await persist();
    return s.comments[id];
  },
  async deleteComment(id) {
    const s = await load();
    delete s.comments[id];
    await persist();
  },
  async deleteThread(rootId) {
    const s = await load();
    delete s.comments[rootId];
    for (const c of Object.values(s.comments)) if (c.parent_id === rootId) delete s.comments[c.id];
    await persist();
  },

  async listShapes(reviewId) {
    const s = await load();
    return Object.values(s.shapes)
      .filter((x) => x.review_id === reviewId)
      .sort((a, b) => a.z - b.z);
  },
  async getShape(id) {
    return (await load()).shapes[id] ?? null;
  },
  async upsertShape(sh) {
    const s = await load();
    s.shapes[sh.id] = sh;
    await persist();
    return sh;
  },
  async updateShape(id, patch) {
    const s = await load();
    if (!s.shapes[id]) return null;
    s.shapes[id] = { ...s.shapes[id], ...patch, updated_at: new Date().toISOString() };
    await persist();
    return s.shapes[id];
  },
  async deleteShape(id) {
    const s = await load();
    delete s.shapes[id];
    await persist();
  },
  async deleteShapes(reviewId, viewport) {
    const s = await load();
    for (const sh of Object.values(s.shapes)) {
      if (sh.review_id === reviewId && (viewport === null || sh.viewport_width === viewport)) {
        delete s.shapes[sh.id];
      }
    }
    await persist();
  },

  async putSnapshot(p, html) {
    await fs.mkdir(SNAP_DIR, { recursive: true });
    await fs.writeFile(path.join(SNAP_DIR, p.replace(/[^a-z0-9_.-]/gi, "_")), html, "utf8");
  },
  async getSnapshot(p) {
    try {
      return await fs.readFile(path.join(SNAP_DIR, p.replace(/[^a-z0-9_.-]/gi, "_")), "utf8");
    } catch {
      return null;
    }
  },

  async putThumbnail(reviewId, bytes) {
    await fs.mkdir(THUMB_DIR, { recursive: true });
    await fs.writeFile(path.join(THUMB_DIR, reviewId.replace(/[^a-z0-9_-]/gi, "_") + ".jpg"), bytes);
    // served by /api/thumbnail/[id] (local development only)
    return `/api/thumbnail/${reviewId}?v=${Date.now()}`;
  },
  async getThumbnail(reviewId) {
    try {
      const bytes = await fs.readFile(path.join(THUMB_DIR, reviewId.replace(/[^a-z0-9_-]/gi, "_") + ".jpg"));
      return { bytes: new Uint8Array(bytes), contentType: "image/jpeg" };
    } catch {
      return null;
    }
  },
};
