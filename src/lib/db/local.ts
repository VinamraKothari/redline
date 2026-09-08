import { promises as fs } from "node:fs";
import path from "node:path";
import type { DbAdapter } from "./adapter";
import type { Comment, Review, Shape } from "@/lib/types";

/**
 * Development fallback: a single JSON file under .data/.
 * Not for production (Vercel's filesystem is ephemeral) — it exists so the app
 * runs end-to-end before Supabase credentials are configured.
 */
interface Store {
  reviews: Record<string, Review>;
  comments: Record<string, Comment>;
  shapes: Record<string, Shape>;
}

const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "redline.json");
const SNAP_DIR = path.join(DIR, "snapshots");

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
    cache = JSON.parse(raw) as Store;
  } catch {
    cache = { reviews: {}, comments: {}, shapes: {} };
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
};
