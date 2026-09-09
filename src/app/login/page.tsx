import type { Metadata } from "next";
import { testAuthEnabled } from "@/lib/auth/server";
import { Login } from "@/components/auth/Login";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in — Redline" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/") ? sp.next : "/";
  const error = typeof sp.error === "string" ? sp.error : null;
  return <Login next={next} error={error} testMode={testAuthEnabled()} />;
}
