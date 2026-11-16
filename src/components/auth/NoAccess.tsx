"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";
import { signOut } from "@/lib/auth/client";

/**
 * Shown to a signed-in person who opens a project or review link they are
 * not a member of. The link is real, so a plain "doesn't exist" would send
 * them chasing a typo; what they need to know is which account they are in
 * and that the sharer has to invite exactly that address.
 */
export function NoAccess({ kind, email }: { kind: "project" | "review"; email: string }) {
  const pathname = usePathname();
  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <Logo />
      <h1 className="text-[20px] font-semibold text-ink">You don&apos;t have access to this {kind}</h1>
      <p className="max-w-[400px] text-[13px] leading-relaxed text-ink-2">
        You&apos;re signed in as <span className="font-medium text-ink">{email}</span>. Ask whoever shared this link to open the {kind === "review" ? "project" : kind}, click{" "}
        <span className="font-medium text-ink">Members</span> and invite that exact address — access works the moment you reload. Invited with a different Google account?
        Switch to it below.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={() => window.location.reload()} className="rounded-md bg-ink px-3 py-1.5 text-[13px] font-medium text-white hover:bg-black">
          Reload
        </button>
        <button
          type="button"
          onClick={() => signOut(`/login?next=${encodeURIComponent(pathname || "/")}`)}
          className="rounded-md bg-panel px-3 py-1.5 text-[13px] font-medium text-ink hairline hover:bg-hover"
        >
          Switch account
        </button>
        <Link href="/" className="px-2 py-1.5 text-[13px] text-ink-3 hover:text-ink">
          Your projects
        </Link>
      </div>
    </main>
  );
}
