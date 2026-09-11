import type { Comment, Profile, Project, ProjectInvite, ProjectMember, Review, Role, Shape } from "@/lib/types";

/**
 * Storage adapter. Two implementations:
 *  - Supabase (production) — selected when SUPABASE env vars are set
 *  - Local JSON file (development fallback) — zero setup
 */
export interface DbAdapter {
  /* identity */
  getProfile(id: string): Promise<Profile | null>;
  getProfilesByIds(ids: string[]): Promise<Profile[]>;
  upsertProfile(p: Profile): Promise<Profile>;

  /* projects & membership */
  createProject(p: Project, owner: string): Promise<Project>;
  getProject(id: string): Promise<Project | null>;
  updateProject(id: string, patch: Partial<Project>): Promise<Project | null>;
  deleteProject(id: string): Promise<void>;
  listProjectsFor(userId: string): Promise<(Project & { role: Role; review_count: number; preview_urls: string[] })[]>;
  listReviews(projectId: string): Promise<Review[]>;
  memberRole(projectId: string, userId: string): Promise<Role | null>;
  listMembers(projectId: string): Promise<ProjectMember[]>;
  setMember(projectId: string, userId: string, role: Role): Promise<void>;
  removeMember(projectId: string, userId: string): Promise<void>;
  listInvites(projectId: string): Promise<ProjectInvite[]>;
  upsertInvite(i: ProjectInvite): Promise<ProjectInvite>;
  deleteInvite(id: string): Promise<void>;
  /** turn pending invites for this e-mail into memberships */
  claimInvites(userId: string, email: string): Promise<void>;

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
  getShape(id: string): Promise<Shape | null>;
  upsertShape(s: Shape): Promise<Shape>;
  updateShape(id: string, patch: Partial<Shape>): Promise<Shape | null>;
  deleteShape(id: string): Promise<void>;
  deleteShapes(reviewId: string, viewport: number | null): Promise<void>;

  /** snapshot html storage */
  /** per-user read state of a review's threads (thread id -> ISO read time, "!" + time = marked unread) */
  getReads(userId: string, reviewId: string): Promise<Record<string, string>>;
  putReads(userId: string, reviewId: string, reads: Record<string, string>): Promise<void>;

  putSnapshot(path: string, html: string): Promise<void>;
  getSnapshot(path: string): Promise<string | null>;

  /** page preview images; returns the public URL to store on the review */
  putThumbnail(reviewId: string, bytes: Uint8Array, contentType: string): Promise<string>;
  getThumbnail(reviewId: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;

  /**
   * Generic files. Public files (comment attachments, Jira screenshots) get a
   * permanent URL anyone can open; private files (PNG exports) are read back
   * through a short-lived signed URL.
   */
  putPublicFile(path: string, bytes: Uint8Array, contentType: string): Promise<string>;
  putPrivateFile(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  privateFileUrl(path: string, ttlSeconds: number): Promise<string>;
  /** local adapter only: read a stored file back (served by /api/files) */
  getFile(kind: "public" | "private", path: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
}
