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
  listProjectsFor(userId: string): Promise<(Project & { role: Role; review_count: number })[]>;
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
  putSnapshot(path: string, html: string): Promise<void>;
  getSnapshot(path: string): Promise<string | null>;
}
