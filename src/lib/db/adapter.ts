import type { Comment, Review, Shape } from "@/lib/types";

/**
 * Storage adapter. Two implementations:
 *  - Supabase (production) — selected when SUPABASE env vars are set
 *  - Local JSON file (development fallback) — zero setup
 */
export interface DbAdapter {
  createReview(r: Review): Promise<Review>;
  getReview(id: string): Promise<Review | null>;
  updateReview(id: string, patch: Partial<Review>): Promise<Review | null>;
  deleteReview(id: string): Promise<void>;

  listComments(reviewId: string): Promise<Comment[]>;
  getComment(id: string): Promise<Comment | null>;
  createComment(c: Comment): Promise<Comment>;
  updateComment(id: string, patch: Partial<Comment>): Promise<Comment | null>;
  deleteComment(id: string): Promise<void>;
  /** deletes a thread root and all replies */
  deleteThread(rootId: string): Promise<void>;

  listShapes(reviewId: string): Promise<Shape[]>;
  upsertShape(s: Shape): Promise<Shape>;
  updateShape(id: string, patch: Partial<Shape>): Promise<Shape | null>;
  deleteShape(id: string): Promise<void>;
  deleteShapes(reviewId: string, viewport: number | null): Promise<void>;

  /** snapshot html storage */
  putSnapshot(path: string, html: string): Promise<void>;
  getSnapshot(path: string): Promise<string | null>;
}
