"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Menu, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/util";
import { GoogleMark } from "./GoogleMark";
import { startSignIn, useSignedIn } from "./auth";

export const NAV_LINKS = [
  { href: "/#product", label: "Product" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/changelog", label: "Changelog" },
];

/** Where the sign-in buttons point before we know whether there is a session: the gate sends members straight on. */
const LOGIN = "/login?next=%2F";

/**
 * The site header: sticky, translucent paper with a hairline underneath.
 * Members get one link to their projects; visitors sign in with Google.
 * `onSignIn` is called without an argument so the landing page can keep the
 * `next` it was opened with and show sign-in errors in its own hero.
 */
export function Nav({ onSignIn = () => void startSignIn(), busy = false }: { onSignIn?: () => void; busy?: boolean }) {
  const pathname = usePathname();
  const signedIn = useSignedIn();
  const [open, setOpen] = useState(false);

  // "/" shows members their projects, so for them "Product" leads to the walk-through instead of the landing section
  const links = NAV_LINKS.map((l) => {
    const href = l.href === "/#product" && signedIn ? "/how-it-works" : l.href;
    return { ...l, href, active: l.href !== "/#product" && pathname === l.href };
  });

  return (
    <header className="mk-nav sticky top-0 z-40 border-b border-line">
      <div className="mx-auto flex h-14 max-w-[1120px] items-center justify-between px-5 sm:px-8">
        <Logo />

        <nav aria-label="Main" className="hidden items-center gap-0.5 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={l.active ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-[13.5px] font-medium transition-colors",
                l.active ? "bg-hover text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-1.5 md:flex">
          <Actions signedIn={signedIn} onSignIn={onSignIn} busy={busy} />
        </div>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="mk-mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          className="press flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-hover hover:text-ink md:hidden"
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {open && (
        <div id="mk-mobile-menu" className="fade-up border-t border-line px-5 pb-5 pt-3 md:hidden">
          <nav aria-label="Main" className="flex flex-col">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                aria-current={l.active ? "page" : undefined}
                className={cn("rounded-md px-2 py-2.5 text-[15px] font-medium", l.active ? "text-ink" : "text-ink-2")}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="mt-3 flex flex-col gap-2">
            <Actions signedIn={signedIn} onSignIn={onSignIn} busy={busy} stacked />
          </div>
        </div>
      )}
    </header>
  );
}

/**
 * The right-hand side of the header. Signed in: a link to the projects.
 * Unknown yet: plain links to the login page, which bounces members on.
 * Signed out: Google sign-in.
 */
function Actions({ signedIn, onSignIn, busy, stacked = false }: { signedIn: boolean | null; onSignIn: () => void; busy: boolean; stacked?: boolean }) {
  const primary = cn(
    "press flex items-center justify-center gap-1.5 rounded-lg bg-ink font-medium text-white transition-colors hover:bg-black disabled:opacity-60",
    stacked ? "h-11 text-[14px]" : "h-9 px-3.5 text-[13px]",
  );
  const secondary = cn(
    "press flex items-center justify-center gap-2 rounded-lg font-medium text-ink transition-colors disabled:opacity-60",
    stacked ? "h-11 bg-panel text-[14px] hairline" : "h-9 px-3 text-[13px] hover:bg-hover",
  );

  if (signedIn) {
    return (
      <Link href="/" className={primary}>
        Your projects <ArrowRight size={14} />
      </Link>
    );
  }
  if (signedIn === null) {
    // not known yet: the login page decides; dimmed so the swap to the real buttons doesn't flash
    return stacked ? (
      <>
        <Link href={LOGIN} className={cn(primary, "opacity-70")}>
          Start free <ArrowRight size={14} />
        </Link>
        <Link href={LOGIN} className={cn(secondary, "opacity-70")}>
          <GoogleMark size={15} /> Sign in
        </Link>
      </>
    ) : (
      <>
        <Link href={LOGIN} className={cn(secondary, "opacity-70")}>
          <GoogleMark size={14} /> Sign in
        </Link>
        <Link href={LOGIN} className={cn(primary, "opacity-70")}>
          Start free <ArrowRight size={14} />
        </Link>
      </>
    );
  }
  const signIn = (
    <button type="button" onClick={onSignIn} disabled={busy} className={secondary}>
      <GoogleMark size={stacked ? 15 : 14} /> Sign in
    </button>
  );
  const start = (
    <button type="button" onClick={onSignIn} disabled={busy} className={primary}>
      Start free <ArrowRight size={14} />
    </button>
  );
  return stacked ? (
    <>
      {start}
      {signIn}
    </>
  ) : (
    <>
      {signIn}
      {start}
    </>
  );
}
