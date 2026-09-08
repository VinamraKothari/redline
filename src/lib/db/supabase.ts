import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DbAdapter } from "./adapter";
import { supabaseSecret } from "./index";
import type { Comment, Review, Shape } from "@/lib/types";

const BUCKET = "snapshots";

let client: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = supabaseSecret()!;
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export const supabaseDb: DbAdapter = {
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
};
