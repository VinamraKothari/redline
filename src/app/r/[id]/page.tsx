import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth/server";
import { publicReview } from "@/lib/review";
import { Workspace } from "@/components/workspace/Workspace";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/r/[id]">): Promise<Metadata> {
  const { id } = await params;
  const review = await (await db()).getReview(id);
  return { title: review ? `${review.title} — Redline` : "Redline", robots: { index: false, follow: false } };
}

export default async function ReviewPage({ params, searchParams }: PageProps<"/r/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/r/${id}`)}`);
  const d = await db();
  const review = await d.getReview(id);
  if (!review || !review.project_id) notFound();
  const role = await d.memberRole(review.project_id, user.id);
  if (!role) notFound();
  const viewOnly = role === "view" || sp.mode === "view";
  const focusComment = typeof sp.c === "string" ? sp.c : null;
  return <Workspace initial={publicReview(review, role, user.id)} viewOnly={viewOnly} focusComment={focusComment} />;
}
