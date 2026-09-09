"use client";

import type { Anchor, Attachment, Comment, Profile, Project, ProjectInvite, ProjectMember, Role, Shape } from "./types";
import type { PublicReview } from "./review";

export type ProjectSummary = Project & { role: Role; review_count: number };

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init.headers as Record<string, string>) };
  const res = await fetch(url, { ...init, headers, credentials: "same-origin" });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401 && typeof window !== "undefined") {
    // session gone: back to sign-in, then straight back here
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  /* identity */
  me() {
    return call<{ user: Profile }>("/api/me", { cache: "no-store" });
  },

  /* projects */
  listProjects() {
    return call<{ projects: ProjectSummary[] }>("/api/projects", { cache: "no-store" });
  },
  createProject(name: string) {
    return call<{ project: ProjectSummary }>("/api/projects", { method: "POST", body: JSON.stringify({ name }) });
  },
  loadProject(id: string) {
    return call<{ project: Project & { role: Role }; reviews: PublicReview[]; members: ProjectMember[]; invites: ProjectInvite[] }>(`/api/projects/${id}`, {
      cache: "no-store",
    });
  },
  renameProject(id: string, name: string) {
    return call<{ project: Project }>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
  },
  deleteProject(id: string) {
    return call<{ ok: true }>(`/api/projects/${id}`, { method: "DELETE" });
  },
  invite(projectId: string, email: string, role: Role) {
    return call<{ member: ProjectMember | null; invite: ProjectInvite | null }>(`/api/projects/${projectId}/members`, {
      method: "POST",
      body: JSON.stringify({ email, role }),
    });
  },
  setRole(projectId: string, userId: string, role: Role) {
    return call<{ ok: true }>(`/api/projects/${projectId}/members`, { method: "PATCH", body: JSON.stringify({ user_id: userId, role }) });
  },
  removeMember(projectId: string, userId: string) {
    return call<{ ok: true }>(`/api/projects/${projectId}/members?user_id=${encodeURIComponent(userId)}`, { method: "DELETE" });
  },
  cancelInvite(projectId: string, inviteId: string) {
    return call<{ ok: true }>(`/api/projects/${projectId}/members?invite=${encodeURIComponent(inviteId)}`, { method: "DELETE" });
  },

  /* reviews */
  createReview(body: { project_id: string; url?: string; viewport?: number; mode?: "live" | "upload"; html?: string; title?: string }) {
    return call<{ review: PublicReview }>("/api/reviews", { method: "POST", body: JSON.stringify(body) });
  },
  loadReview(id: string) {
    return call<{ review: PublicReview; comments: Comment[]; shapes: Shape[] }>(`/api/reviews/${id}`, { cache: "no-store" });
  },
  patchReview(id: string, patch: Partial<PublicReview>) {
    return call<{ review: PublicReview }>(`/api/reviews/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  deleteReview(id: string) {
    return call<{ ok: true }>(`/api/reviews/${id}`, { method: "DELETE" });
  },

  listComments(id: string) {
    return call<{ comments: Comment[] }>(`/api/reviews/${id}/comments`, { cache: "no-store" });
  },
  createComment(
    reviewId: string,
    body: {
      parent_id?: string | null;
      title?: string | null;
      body: string;
      anchor?: Anchor | null;
      viewport_width: number;
      attachments?: Attachment[];
    },
  ) {
    return call<{ comment: Comment }>(`/api/reviews/${reviewId}/comments`, { method: "POST", body: JSON.stringify(body) });
  },
  editComment(id: string, body: string) {
    return call<{ comment: Comment }>(`/api/comments/${id}`, { method: "PATCH", body: JSON.stringify({ action: "edit", body }) });
  },
  retitleComment(id: string, title: string) {
    return call<{ comment: Comment }>(`/api/comments/${id}`, { method: "PATCH", body: JSON.stringify({ action: "title", title }) });
  },
  resolveComment(id: string, resolved: boolean) {
    return call<{ comment: Comment }>(`/api/comments/${id}`, { method: "PATCH", body: JSON.stringify({ action: "resolve", resolved }) });
  },
  react(id: string, emoji: string) {
    return call<{ comment: Comment }>(`/api/comments/${id}`, { method: "PATCH", body: JSON.stringify({ action: "react", emoji }) });
  },
  moveComment(id: string, anchor: Anchor) {
    return call<{ comment: Comment }>(`/api/comments/${id}`, { method: "PATCH", body: JSON.stringify({ action: "move", anchor }) });
  },
  deleteComment(id: string) {
    return call<{ ok: true }>(`/api/comments/${id}`, { method: "DELETE" });
  },

  listShapes(id: string) {
    return call<{ shapes: Shape[] }>(`/api/reviews/${id}/shapes`, { cache: "no-store" });
  },
  putShape(reviewId: string, shape: Shape) {
    return call<{ shape: Shape }>(`/api/reviews/${reviewId}/shapes`, { method: "PUT", body: JSON.stringify(shape) });
  },
  patchShape(id: string, patch: Partial<Shape>) {
    return call<{ shape: Shape }>(`/api/shapes/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  deleteShape(id: string) {
    return call<{ ok: true }>(`/api/shapes/${id}`, { method: "DELETE" });
  },
  clearShapes(reviewId: string, viewport: number | null) {
    const q = viewport ? `?viewport=${viewport}` : "?all=1";
    return call<{ ok: true }>(`/api/reviews/${reviewId}/shapes${q}`, { method: "DELETE" });
  },

  freeze(reviewId: string, html: string) {
    return call<{ review: PublicReview }>(`/api/reviews/${reviewId}/freeze`, { method: "POST", body: JSON.stringify({ html }) });
  },
};
