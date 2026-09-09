import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, requireUser, syncProfile } from "@/lib/auth/server";
import type { Project } from "@/lib/types";
import { newSlug } from "@/lib/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Projects the caller is a member of. */
export const GET = guarded(async () => {
  const user = await requireUser();
  const d = await db();
  return Response.json({ projects: await d.listProjectsFor(user.id) });
});

/** Create a project; the creator becomes its admin. */
export const POST = guarded(async (req: NextRequest) => {
  const user = await requireUser();
  await syncProfile(user);
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const name = (body.name || "").trim().slice(0, 80);
  if (!name) return Response.json({ error: "Give the project a name." }, { status: 400 });
  const now = new Date().toISOString();
  const project: Project = { id: newSlug(), name, created_by: user.id, created_at: now, updated_at: now };
  const d = await db();
  await d.createProject(project, user.id);
  return Response.json({ project: { ...project, role: "admin", review_count: 0 } });
});
