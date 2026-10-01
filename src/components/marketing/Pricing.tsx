"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Minus } from "lucide-react";
import { PLANS, formatPrice, yearlyTotal, type Interval, type Plan, type PlanLimits } from "@/lib/billing/plans";
import { cn } from "@/lib/util";
import { GoogleMark } from "./GoogleMark";
import { startSignIn, useSignedIn } from "./auth";

/** Where a plan's button goes. Free means "sign in"; paid plans start checkout on the billing page. */
function targetFor(plan: Plan, interval: Interval): string {
  return plan.id === "free" ? "/" : `/account/billing?plan=${plan.id}&interval=${interval}`;
}

const count = (n: number) => (n === Infinity ? "Unlimited" : String(n));

/** Rows of the comparison table, straight from each plan's limits. */
const ROWS: { label: string; note?: string; value: (l: PlanLimits) => string | boolean }[] = [
  { label: "Projects", value: (l) => count(l.projects) },
  { label: "Pages per project", note: "a frozen version counts as a page", value: (l) => count(l.pagesPerProject) },
  { label: "People per project", note: "the owner included", value: (l) => count(l.membersPerProject) },
  { label: "Figma comparisons", note: "per calendar month, across the account", value: (l) => (l.figmaComparesPerMonth === Infinity ? "Unlimited" : `${l.figmaComparesPerMonth} a month`) },
  { label: "Comments, drawing, inspect & measure", value: () => true },
  { label: "Screen recordings in comments", value: (l) => l.recordings },
  { label: "Frozen versions & saved states", value: (l) => l.frozenVersions },
  { label: "PNG export", value: (l) => l.pngExport },
  { label: "Jira CSV export", value: () => true },
];

/** Plan cards with the monthly / yearly toggle, and the limits table beneath. */
export function Pricing() {
  const router = useRouter();
  const [interval, setInterval] = useState<Interval>("month");
  const signedIn = useSignedIn();
  const yearly = interval === "year";

  /** Members go straight on; visitors through Google; while we don't know yet, the login page decides (it bounces members). */
  function go(plan: Plan) {
    const target = targetFor(plan, interval);
    if (signedIn) router.push(target);
    else if (signedIn === null) router.push(`/login?next=${encodeURIComponent(target)}`);
    else void startSignIn(target);
  }

  return (
    <div>
      {/* interval toggle */}
      <div className="flex items-center justify-center gap-3">
        <div role="group" aria-label="Billing interval" className="inline-flex rounded-lg bg-hover p-0.5">
          {(["month", "year"] as Interval[]).map((i) => (
            <button
              key={i}
              type="button"
              aria-pressed={interval === i}
              onClick={() => setInterval(i)}
              className={cn(
                "rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                interval === i ? "bg-panel text-ink shadow-sm" : "text-ink-2 hover:text-ink",
              )}
            >
              {i === "month" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </div>
        <span className={cn("rounded-md bg-red-soft px-2 py-1 text-[12px] font-medium text-red-ink transition-opacity", yearly ? "opacity-100" : "opacity-60")}>
          2 months free
        </span>
      </div>

      {/* cards */}
      <div className="mt-8 grid gap-3 md:grid-cols-3">
        {PLANS.map((p) => {
          const featured = p.id === "pro";
          const price = yearly ? p.yearly : p.monthly;
          const free = p.id === "free";
          return (
            <div key={p.id} className={cn("flex flex-col rounded-xl p-6", featured ? "bg-ink text-white" : "bg-panel hairline")}>
              <div className="flex items-baseline justify-between">
                <h2 className="text-[16px] font-semibold">{p.name}</h2>
                {featured && <span className="mk-eyebrow !text-white/60">Most popular</span>}
              </div>
              <p className={cn("mt-1 text-[13px] md:min-h-[38px]", featured ? "text-white/70" : "text-ink-2")}>{p.tagline}</p>

              <div className="mt-5 flex items-baseline gap-1.5">
                <span data-testid={`price-${p.id}`} className="text-[36px] font-semibold leading-none tracking-[-0.02em]">
                  {formatPrice(price)}
                </span>
                <span className={cn("text-[13px]", featured ? "text-white/60" : "text-ink-3")}>/ month</span>
              </div>
              <div className={cn("mt-1.5 h-4 text-[12px]", featured ? "text-white/60" : "text-ink-3")}>
                {free ? "no card needed" : yearly ? `${formatPrice(yearlyTotal(p))} billed yearly` : "billed monthly"}
              </div>

              <button
                type="button"
                onClick={() => go(p)}
                className={cn(
                  "press mt-5 flex h-10 items-center justify-center gap-2 rounded-lg text-[13.5px] font-medium transition-[background-color,opacity]",
                  featured ? "bg-white text-ink hover:bg-paper" : free ? "bg-panel text-ink hairline hover:bg-hover" : "bg-ink text-white hover:bg-black",
                  signedIn === null && "opacity-70",
                )}
              >
                {free && !signedIn && <GoogleMark size={14} />}
                {free ? (signedIn ? "Go to your projects" : "Start free") : `Choose ${p.name}`}
                {!free && <ArrowRight size={14} />}
              </button>

              <ul className={cn("mt-6 space-y-2 text-[13.5px]", featured ? "text-white/85" : "text-ink-2")}>
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check size={14} className={cn("mt-0.5 shrink-0", featured ? "text-white/60" : "text-red")} /> {f}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* comparison table */}
      <div className="mt-16">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">Compare the plans</h2>
          <span className="text-[12px] text-ink-3 sm:hidden">Scroll sideways for every plan →</span>
        </div>
        {/* on phones the table scrolls sideways; the row labels stay put */}
        <div data-scrolls className="mt-4 overflow-x-auto rounded-xl bg-panel hairline">
          <table className="w-full min-w-[520px] border-collapse text-[13.5px]">
            <thead>
              <tr className="border-b border-line text-left">
                <th scope="col" className="mk-sticky-col px-4 py-3 font-medium text-ink-3">
                  <span className="mk-eyebrow">Limits</span>
                </th>
                {PLANS.map((p) => (
                  <th key={p.id} scope="col" className="px-4 py-3 text-[14px] font-semibold text-ink">
                    {p.name}
                    <span className="ml-2 text-[12px] font-normal text-ink-3">{formatPrice(yearly ? p.yearly : p.monthly)}/mo</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.label} className="border-b border-line last:border-0">
                  <th scope="row" className="mk-sticky-col px-4 py-3 text-left font-normal text-ink">
                    {row.label}
                    {row.note && <span className="block text-[12px] text-ink-3">{row.note}</span>}
                  </th>
                  {PLANS.map((p) => {
                    const v = row.value(p.limits);
                    return (
                      <td key={p.id} className="px-4 py-3 text-ink-2">
                        {v === true ? (
                          <Check size={15} className="text-red" aria-label="Included" />
                        ) : v === false ? (
                          <Minus size={15} className="text-line-strong" aria-label="Not included" />
                        ) : (
                          <span className="num">{v}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
