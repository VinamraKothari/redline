import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { Start } from "@/components/home/Start";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Start a review — Redline" };

/** Landing-page hand-off: after sign-in, choose a project for the pasted URL. */
export default async function StartPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const url = typeof sp.url === "string" ? sp.url : "";
  const viewport = Number(sp.viewport) || 1440;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/start?url=${encodeURIComponent(url)}&viewport=${viewport}`)}`);
  if (!url) redirect("/");
  return <Start url={url} viewport={viewport} />;
}
