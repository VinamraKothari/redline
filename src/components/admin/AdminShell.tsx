"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, LayoutDashboard, ScrollText, ShieldCheck, Ticket, Users } from "lucide-react";
import { cn } from "@/lib/util";
import { Logo } from "@/components/Logo";
import { AccountMenu } from "@/components/home/AccountMenu";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/codes", label: "Codes", icon: Ticket },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
] as const;

/**
 * The admin area's frame: a quiet sidebar on wide screens that folds into a
 * top bar with a scrolling tab row on phones. Pages scroll inside <main>.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(href + "/"));
  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-line bg-paper md:h-full md:w-[224px] md:border-b-0 md:border-r">
        <div className="flex h-14 items-center justify-between px-4 md:px-5">
          <div className="flex items-center gap-2">
            <Logo />
            <span className="inline-flex h-[18px] items-center gap-1 rounded-full bg-ink px-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-white">
              <ShieldCheck size={10} /> Admin
            </span>
          </div>
          <div className="flex items-center gap-2 md:hidden">
            <Link href="/" aria-label="Back to Redline" className="press flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-ink-2 outline-none ring-blue hover:bg-hover hover:text-ink focus-visible:ring-2">
              <ArrowLeft size={12} className="text-ink-3" /> Back
            </Link>
            <AccountMenu size={24} />
          </div>
        </div>
        <nav aria-label="Admin" className="flex gap-1 overflow-x-auto px-3 pb-2 md:flex-col md:px-3 md:pb-0 md:pt-2">
          {NAV.map(({ href, label, icon: Icon, ...rest }) => {
            const on = active(href, "exact" in rest ? rest.exact : false);
            return (
              <Link
                key={href}
                href={href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "press flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium outline-none ring-blue focus-visible:ring-2",
                  on ? "bg-ink text-white" : "text-ink-2 hover:bg-hover hover:text-ink",
                )}
              >
                <Icon size={14} className={on ? "text-white/80" : "text-ink-3"} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto hidden items-center justify-between gap-2 px-3 pb-4 pt-6 md:flex">
          <Link href="/" className="press flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12.5px] text-ink-2 outline-none ring-blue hover:bg-hover hover:text-ink focus-visible:ring-2">
            <ArrowLeft size={13} className="text-ink-3" /> Back to Redline
          </Link>
          <AccountMenu size={24} />
        </div>
      </aside>
      <main className="relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="pointer-events-none absolute inset-0 canvas-grid opacity-40" />
        <div className="relative mx-auto w-full max-w-[1120px] px-4 pb-16 pt-6 sm:px-6 sm:pt-8">{children}</div>
      </main>
    </div>
  );
}
