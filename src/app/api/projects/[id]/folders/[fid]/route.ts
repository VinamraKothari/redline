import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, projectAccess } from "@/lib/auth/server";
import { folderInProject, folderName } from "@/lib/folders";
import type { Folder } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notFound = () => Response.json({ error: "That folder doesn't exist in this project." }, { status: 404 });

/** Rename or reorder a folder (edit role). */
export const PATCH = guarded(async (req: NextRequest, ctx: RouteContext<"/api/projects/[id]/folders/[fid]">) => {
  const { id, fid } = await ctx.params;
  await projectAccess(id, "edit");
  const d = await db();
  if (!(await folderInProject(d, id, fid))) return notFound();
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; position?: unknown };
  const patch: Partial<Folder> = {};
  if (body.name !== undefined) {
    const name = folderName(body.name);
    if (!name) return Response.json({ error: "Give the folder a name." }, { status: 400 });
    patch.name = name;
  }
  if (typeof body.position === "number" && Number.isFinite(body.position)) patch.position = Math.round(body.position);
  const folder = await d.updateFolder(fid, patch);
  await d.updateProject(id, {});
  return Response.json({ folder });
});

/** Delete a folder (edit role). Its pages move back to the project root; nothing else is removed. */
export const DELETE = guarded(async (_req: NextRequest, ctx: RouteContext<"/api/projects/[id]/folders/[fid]">) => {
  const { id, fid } = await ctx.params;
  await projectAccess(id, "edit");
  const d = await db();
  if (!(await folderInProject(d, id, fid))) return notFound();
  await d.deleteFolder(fid);
  await d.updateProject(id, {});
  return Response.json({ ok: true });
});
