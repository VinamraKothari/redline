import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { BillingPage } from "@/components/billing/BillingPage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Plan & billing — Redline" };

/** Signed-in accounts only; visitors go to sign in and come straight back. */
export default async function Page() {
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/account/billing")}`);
  return (
    // useSearchParams needs a boundary so the static shell can stream first
    <Suspense fallback={null}>
      <BillingPage />
    </Suspense>
  );
}
