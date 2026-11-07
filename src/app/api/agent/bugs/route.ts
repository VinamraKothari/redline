import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, HttpError } from "@/lib/auth/server";
import { agentProject, agentThreads, NO_STORE, requestOrigin } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agent/bugs — every thread in the agent's project, with full context.
 *   ?status=open (default) | resolved | all
 *   ?review=<review id>   only one page
 * Bearer-token auth; read-only. See docs/agent-api.md.
 */
export const GET = guarded(async (req: NextRequest) => {
  const projectId = agentProject(req);
  const status = req.nextUrl.searchParams.get("status") || "open";
  if (!["open", "resolved", "all"].includes(status)) throw new HttpError(400, "status must be open, resolved or all.");
  const only = req.nextUrl.searchParams.get("review");

  const d = await db();
  const project = await d.getProject(projectId);
  if (!project) throw new HttpError(404, "The configured project doesn't exist.");
  const [reviews, folders] = await Promise.all([d.listReviews(projectId), d.listFolders(projectId)]);
  const picked = only ? reviews.filter((r) => r.id === only) : reviews;
  if (only && !picked.length) throw new HttpError(404, "No such page in this project.");
  const withComments = await Promise.all(picked.map(async (review) => ({ review, comments: await d.listComments(review.id) })));

  const threads = agentThreads(requestOrigin(req), withComments, folders).filter((t) => status === "all" || t.status === status);
  return Response.json(
    {
      project: { id: project.id, name: project.name },
      generated_at: new Date().toISOString(),
      status,
      count: threads.length,
      threads,
    },
    { headers: NO_STORE },
  );
});
