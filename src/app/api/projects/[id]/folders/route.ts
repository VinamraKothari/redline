import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, projectAccess } from "@/lib/auth/server";
import { folderName } from "@/lib/folders";
import type { Folder } from "@/lib/types";
import { newSlug } from "@/lib/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create a folder at the end of the project's list (edit role). */
export const POST = guarded(async (req: NextRequest, ctx: RouteContext<"/api/projects/[id]/folders">) => {
  const { id } = await ctx.params;
  const { user } = await projectAccess(id, "edit");
  const body = (await req.json().catch(() => ({}))) as { name?: unknown };
  const name = folderName(body.name);
  if (!name) return Response.json({ error: "Give the folder a name." }, { status: 400 });
  const d = await db();
  const existing = await d.listFolders(id);
  const now = new Date().toISOString();
  const folder: Folder = {
    id: newSlug(),
    project_id: id,
    name,
    position: existing.length ? Math.max(...existing.map((f) => f.position)) + 1 : 0,
    created_by: user.id,
    created_at: now,
    updated_at: now,
  };
  await d.createFolder(folder);
  await d.updateProject(id, {});
  return Response.json({ folder });
});
