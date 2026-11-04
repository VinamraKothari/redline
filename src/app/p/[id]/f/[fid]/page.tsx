import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth/server";
import { folderInProject } from "@/lib/folders";
import { ProjectHome } from "@/components/home/ProjectHome";

export const dynamic = "force-dynamic";

/** A folder inside a project: the same project page, narrowed to that folder's pages. */
export async function generateMetadata({ params }: PageProps<"/p/[id]/f/[fid]">): Promise<Metadata> {
  const { id, fid } = await params;
  const d = await db();
  const [p, f] = await Promise.all([d.getProject(id), folderInProject(d, id, fid)]);
  return { title: p && f ? `${f.name} · ${p.name} — Redline` : "Redline", robots: { index: false, follow: false } };
}

export default async function FolderPage({ params }: PageProps<"/p/[id]/f/[fid]">) {
  const { id, fid } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/p/${id}/f/${fid}`)}`);
  const d = await db();
  const project = await d.getProject(id);
  if (!project) notFound();
  const role = await d.memberRole(id, user.id);
  if (!role) notFound();
  if (!(await folderInProject(d, id, fid))) notFound();
  return <ProjectHome id={id} folderId={fid} />;
}
