"use client";

import type { Anchor, Attachment, Comment, Profile, Project, ProjectInvite, ProjectMember, Role, Shape } from "./types";
import type { PublicReview } from "./review";

export type ProjectSummary = Project & { role: Role; review_count: number; preview_urls: string[] };

const RETRY_STATUS = new Set([408, 425, 429, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function friendly(status: number): string {
  if (status === 413) return "That's too large to send (limit ~4 MB). Try a smaller image.";
  if (status === 504 || status === 502 || status === 503) return "The server took too long to answer — please try again.";
  if (status === 429) return "Too many requests at once — please wait a moment.";
  if (status === 401) return "Your session has expired — sign in again.";
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return "That no longer exists.";
  return `Request failed (${status})`;
}

/**
 * fetch + JSON with retries: transient network errors and gateway/rate-limit
 * responses are retried with a short back-off (two extra attempts), so a
 * blip never surfaces as an error to someone in the middle of a review.
 */
async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init.headers as Record<string, string>) };
  let attempt = 0;
  for (;;) {
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers, credentials: "same-origin" });
    } catch (e) {
      if (attempt < 2 && typeof navigator !== "undefined" && navigator.onLine !== false) {
        attempt++;
        await sleep(400 * attempt * attempt);
        continue;
      }
      throw new Error("No connection — check your network and try again.");
    }
    if (RETRY_STATUS.has(res.status) && attempt < 2) {
      attempt++;
      await sleep(500 * attempt * attempt);
      continue;
    }
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (res.status === 401 && typeof window !== "undefined") {
      // session gone: back to sign-in, then straight back here
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
    if (!res.ok) throw new Error(data.error || friendly(res.status));
    return data;
  }
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

  async freeze(reviewId: string, html: string) {
    // big pages: gzip in the browser so the upload stays well under the platform's body limit
    const json = JSON.stringify({ html });
    if (typeof CompressionStream !== "undefined" && json.length > 200_000) {
      try {
        const body = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
        return await call<{ review: PublicReview }>(`/api/reviews/${reviewId}/freeze`, {
          method: "POST",
          headers: { "content-type": "application/octet-stream", "x-redline-gzip": "1" },
          body,
        });
      } catch {
        /* fall through to plain JSON */
      }
    }
    return call<{ review: PublicReview }>(`/api/reviews/${reviewId}/freeze`, { method: "POST", body: json });
  },
};
