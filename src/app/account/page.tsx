import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { AccountPage } from "@/components/account/AccountPage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your account — Redline" };

/** Signed-in accounts only; visitors go to sign in and come straight back. */
export default async function Page() {
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/account")}`);
  return <AccountPage />;
}
