import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
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
  const review = await (await db()).getReview(id);
  if (!review) notFound();
  const viewOnly = sp.mode === "view";
  const focusComment = typeof sp.c === "string" ? sp.c : null;
  return <Workspace initial={publicReview(review)} viewOnly={viewOnly} focusComment={focusComment} />;
}
