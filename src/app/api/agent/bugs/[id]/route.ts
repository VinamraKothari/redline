import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, HttpError } from "@/lib/auth/server";
import { agentProject, agentThreads, NO_STORE, requestOrigin } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agent/bugs/:id — one thread (pass the thread's id or any reply's id),
 * or one copy edit by its id.
 * Bearer-token auth; read-only; only threads inside the agent's project.
 */
export const GET = guarded(async (req: NextRequest, ctx: RouteContext<"/api/agent/bugs/[id]">) => {
  const projectId = agentProject(req);
  const { id } = await ctx.params;
  const missing = new HttpError(404, "No such thread in this project.");

  const d = await db();
  const comment = await d.getComment(id);
  if (!comment) {
    // not a comment: maybe a copy edit
    const edit = await d.getTextEdit(id);
    if (!edit) throw missing;
    const review = await d.getReview(edit.review_id);
    if (!review || review.project_id !== projectId) throw missing;
    const thread = agentThreads(requestOrigin(req), [{ review, comments: [], textEdits: [edit] }], await d.listFolders(projectId))[0];
    return Response.json({ thread }, { headers: NO_STORE });
  }
  const review = await d.getReview(comment.review_id);
  if (!review || review.project_id !== projectId) throw missing;
  const rootId = comment.parent_id || comment.id;
  const [comments, folders] = await Promise.all([d.listComments(review.id), d.listFolders(projectId)]);
  const thread = agentThreads(requestOrigin(req), [{ review, comments }], folders).find((t) => t.id === rootId);
  if (!thread) throw missing;
  return Response.json({ thread }, { headers: NO_STORE });
});
