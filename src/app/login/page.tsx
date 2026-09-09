import type { Metadata } from "next";
import { testAuthEnabled } from "@/lib/auth/server";
import { Landing } from "@/components/home/Landing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in — Redline" };

/** Where protected pages send signed-out visitors; the landing page with `next` preserved. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/") ? sp.next : "/";
  const error = typeof sp.error === "string" ? sp.error : null;
  return <Landing next={next} error={error} testMode={testAuthEnabled()} />;
}
