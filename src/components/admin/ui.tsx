"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Inbox } from "lucide-react";
import type { PlanSource } from "@/lib/billing/entitlements";
import { PLAN_BY_ID, type PlanId } from "@/lib/billing/plans";
import { cn } from "@/lib/util";
import { Avatar } from "@/components/ui/primitives";
import type { ProfileLite } from "@/lib/admin/types";

/* ─── Formatting ─────────────────────────────────────────────────────────── */

/** "3 Oct 2026" */
export const fmtDate = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

/** "3 Oct 2026, 14:05" */
export const fmtDateTime = (iso: string | null | undefined): string =>
  iso ? `${fmtDate(iso)}, ${new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "—";

export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/* ─── Page scaffolding ───────────────────────────────────────────────────── */

export function PageHeader({ title, description, actions, eyebrow }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">{eyebrow}</div>}
        <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h1>
        {description && <p className="mt-1.5 max-w-[560px] text-[13px] leading-relaxed text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">{actions}</div>}
    </header>
  );
}

export function Card({ title, aside, children, className, padded = true }: { title?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cn("min-w-0 rounded-xl bg-panel hairline", className)}>
      {(title || aside) && (
        <div className={cn("flex items-center justify-between gap-3 px-5 pt-4", padded ? "pb-3" : "pb-3")}>
          {title && <h2 className="text-[13px] font-semibold text-ink">{title}</h2>}
          {aside && <div className="flex items-center gap-2 text-[12px] text-ink-3">{aside}</div>}
        </div>
      )}
      <div className={cn(padded && (title || aside) ? "px-5 pb-5" : padded ? "p-5" : "")}>{children}</div>
    </section>
  );
}

/**
 * A plain table with hairlines. Narrower than its columns, it scrolls
 * sideways inside the card — the page itself never does — and a soft fade on
 * the right edge says there is more until the end is reached.
 */
export function Table({ children, minWidth = 640, className }: { children: React.ReactNode; minWidth?: number; className?: string }) {
  const scroller = React.useRef<HTMLDivElement>(null);
  const [more, setMore] = React.useState(false);
  React.useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    const first = requestAnimationFrame(update);
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(first);
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);
  return (
    <div className={cn("relative min-w-0 rounded-xl bg-panel hairline", className)}>
      <div ref={scroller} className="overflow-x-auto rounded-[inherit]">
        <table className="w-full border-collapse text-[12.5px] text-ink" style={{ minWidth }}>
          {children}
        </table>
      </div>
      <div aria-hidden className={cn("pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-[inherit] bg-gradient-to-l from-panel to-transparent transition-opacity", more ? "opacity-100" : "opacity-0")} />
    </div>
  );
}

export function Th({ children, className, align = "left" }: { children?: React.ReactNode; className?: string; align?: "left" | "right" }) {
  return (
    <th scope="col" className={cn("whitespace-nowrap border-b border-line px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3", align === "right" ? "text-right" : "text-left", className)}>
      {children}
    </th>
  );
}

export function Td({ children, className, align = "left", colSpan }: { children?: React.ReactNode; className?: string; align?: "left" | "right"; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn("border-b border-line px-4 py-2.5 align-middle [tr:last-child>&]:border-b-0", align === "right" ? "text-right num" : "text-left", className)}>
      {children}
    </td>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-[12.5px] text-ink-3">
        {/* sticky and no wider than the viewport, so the message stays in view when the table scrolls sideways */}
        <div className="sticky left-0 text-center" style={{ width: "min(100%, calc(100vw - 4rem))" }}>
          <Inbox size={18} className="mx-auto mb-2 text-ink-3/70" />
          {children}
        </div>
      </td>
    </tr>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-hover", className)} />;
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-soft px-3 py-2 text-[12.5px] text-red-ink hairline">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function Note({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-lg bg-hover px-3 py-2 text-[12.5px] leading-relaxed text-ink-2 hairline", className)}>{children}</div>;
}

/* ─── Chips ──────────────────────────────────────────────────────────────── */

export const SOURCE_LABEL: Record<PlanSource, string> = {
  admin: "Admin",
  collaborator: "Complimentary",
  stripe: "Stripe",
  manual: "Manual",
  code: "Code",
  free: "Free",
};

export const SOURCE_HINT: Record<PlanSource, string> = {
  admin: "Admins are always on Team.",
  collaborator: "Shares a project with an admin, so Team is on the house.",
  stripe: "Pays through Stripe.",
  manual: "Granted by an admin.",
  code: "Redeemed a code.",
  free: "No paid plan.",
};

const SOURCE_STYLE: Record<PlanSource, string> = {
  admin: "bg-ink text-white",
  collaborator: "bg-violet-soft text-violet",
  stripe: "bg-[rgba(31,157,85,0.12)] text-[#17743f]",
  manual: "bg-[rgba(217,139,11,0.14)] text-[#8a5806]",
  code: "bg-blue-soft text-[#1f55c9]",
  free: "bg-hover text-ink-2",
};

export function SourceChip({ source, className }: { source: PlanSource; className?: string }) {
  return (
    <span title={SOURCE_HINT[source]} className={cn("inline-flex h-[18px] items-center rounded-full px-1.5 text-[10.5px] font-semibold uppercase tracking-wide", SOURCE_STYLE[source], className)}>
      {SOURCE_LABEL[source]}
    </span>
  );
}

export function PlanName({ plan, className }: { plan: PlanId; className?: string }) {
  return <span className={cn("font-medium", plan === "free" ? "text-ink-2" : "text-ink", className)}>{PLAN_BY_ID[plan].name}</span>;
}

export function StatusChip({ status }: { status: string | null | undefined }) {
  if (!status || status === "none") return <span className="text-ink-3">—</span>;
  const bad = status === "past_due" || status === "unpaid" || status === "canceled" || status === "incomplete_expired";
  return <span className={cn("inline-flex h-[18px] items-center rounded-full px-1.5 text-[10.5px] font-medium hairline", bad ? "bg-red-soft text-red-ink" : "bg-paper text-ink-2")}>{status.replace(/_/g, " ")}</span>;
}

export function AdminBadge({ className }: { className?: string }) {
  return <span className={cn("inline-flex h-[18px] items-center rounded-full bg-ink px-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-white", className)}>Admin</span>;
}

/* ─── People ─────────────────────────────────────────────────────────────── */

/** Name and e-mail with the avatar; links to the account when `href` is set. */
export function Person({ profile, href, size = 24, muted }: { profile: ProfileLite | null; href?: string; size?: number; muted?: boolean }) {
  if (!profile) return <span className="text-ink-3">{muted ? "—" : "System"}</span>;
  const inner = (
    <>
      <Avatar name={profile.name} color={profile.color} src={profile.avatar_url} size={size} />
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-medium text-ink">{profile.name}</span>
        <span className="block truncate text-[11.5px] text-ink-3">{profile.email}</span>
      </span>
    </>
  );
  const cls = "inline-flex max-w-full items-center gap-2 text-left";
  return href ? (
    <Link href={href} className={cn(cls, "rounded-md outline-none hover:underline decoration-line-strong underline-offset-2 focus-visible:ring-2 ring-blue")}>
      {inner}
    </Link>
  ) : (
    <span className={cls}>{inner}</span>
  );
}

/* ─── Form bits ──────────────────────────────────────────────────────────── */

export function Field({ label, hint, children, className }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-[11.5px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-relaxed text-ink-3">{hint}</span>}
    </label>
  );
}

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...props }, ref) {
  return <select ref={ref} className={cn("h-8 w-full rounded-md bg-panel px-2 text-[12.5px] text-ink hairline outline-none focus:shadow-[0_0_0_2px_var(--blue)] disabled:opacity-60", className)} {...props} />;
});

/** An on/off switch in the app's ink; `label` is for assistive tech. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("press relative inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full transition-colors disabled:opacity-40", checked ? "bg-ink" : "bg-line-strong")}
    >
      <span className={cn("absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-[16px]" : "translate-x-[2px]")} />
    </button>
  );
}

/** A labelled number in the overview grid. */
export function StatTile({ label, value, hint, accent }: { label: string; value: React.ReactNode; hint?: React.ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-panel px-4 py-3.5 hairline">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{label}</div>
      <div className={cn("mt-1 text-[24px] font-semibold leading-none tracking-[-0.02em] num", accent ? "text-red" : "text-ink")}>{value}</div>
      {hint && <div className="mt-1.5 text-[11.5px] text-ink-3">{hint}</div>}
    </div>
  );
}

/* ─── Data loading ───────────────────────────────────────────────────────── */

/**
 * Loads on mount and whenever `key` changes (or `reload()` is called). The
 * fetcher may be an inline closure: the latest one is kept in a ref and read
 * when the request starts. Earlier data stays visible while a new key loads.
 */
export function useAdminData<T>(fetcher: () => Promise<T>, key = "") {
  const [tick, setTick] = React.useState(0);
  const fullKey = `${key}#${tick}`;
  const [result, setResult] = React.useState<{ key: string; data: T | null; error: string | null }>({ key: "", data: null, error: null });
  const ref = React.useRef(fetcher);
  React.useEffect(() => {
    ref.current = fetcher;
  });
  React.useEffect(() => {
    let live = true;
    ref.current().then(
      (data) => live && setResult({ key: fullKey, data, error: null }),
      (e: Error) => live && setResult((r) => ({ key: fullKey, data: r.data, error: e.message })),
    );
    return () => {
      live = false;
    };
  }, [fullKey]);
  const setData = React.useCallback((next: T | null | ((cur: T | null) => T | null)) => {
    setResult((r) => ({ ...r, data: typeof next === "function" ? (next as (cur: T | null) => T | null)(r.data) : next }));
  }, []);
  const reload = React.useCallback(() => setTick((t) => t + 1), []);
  return { data: result.data, setData, error: result.error, loading: result.key !== fullKey, reload };
}
