import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, HttpError } from "@/lib/auth/server";
import { requireAdmin } from "@/lib/admin/auth";
import { Logo } from "@/components/Logo";
import { AdminShell } from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin — Redline", robots: { index: false, follow: false } };

/**
 * Every page under /admin is checked here: visitors go to sign in and come
 * back, signed-in non-admins get a short no, admins get the shell. The API
 * routes check again on their own, so this is UX, not the security boundary.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/admin")}`);
  // only a refusal means "not for you"; a database outage should surface as an error, not as a lockout
  const admin = await requireAdmin().then(
    () => true,
    (e) => {
      if (e instanceof HttpError && (e.status === 401 || e.status === 403)) return false;
      throw e;
    },
  );
  if (!admin) return <NotForYou email={user.email} />;
  return <AdminShell>{children}</AdminShell>;
}

function NotForYou({ email }: { email: string }) {
  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <Logo />
      <h1 className="text-[20px] font-semibold text-ink">Not for you</h1>
      <p className="max-w-[380px] text-[13px] leading-relaxed text-ink-2">
        The admin area is for the people who run Redline. You&apos;re signed in as <span className="font-medium text-ink">{email}</span>, which isn&apos;t one of them.
      </p>
      <Link href="/" className="rounded-md bg-ink px-3 py-1.5 text-[13px] font-medium text-white">
        Back to your projects
      </Link>
    </main>
  );
}
