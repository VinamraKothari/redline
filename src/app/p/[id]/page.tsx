import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth/server";
import { ProjectHome } from "@/components/home/ProjectHome";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/p/[id]">): Promise<Metadata> {
  const { id } = await params;
  const p = await (await db()).getProject(id);
  return { title: p ? `${p.name} — Redline` : "Redline", robots: { index: false, follow: false } };
}

export default async function ProjectPage({ params }: PageProps<"/p/[id]">) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/p/${id}`)}`);
  const d = await db();
  const project = await d.getProject(id);
  if (!project) notFound();
  const role = await d.memberRole(id, user.id);
  if (!role) notFound();
  return <ProjectHome id={id} />;
}
