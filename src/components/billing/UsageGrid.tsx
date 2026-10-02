"use client";

import type { BillingStatus } from "@/lib/api";
import { PLAN_BY_ID } from "@/lib/billing/plans";
import { cn } from "@/lib/util";

/**
 * What the account has used against its plan's limits, plus the limits that
 * are a plain yes/no. Shared by the billing page and the account hub so the
 * two never disagree about the numbers.
 */
export function UsageGrid({ status, className }: { status: BillingStatus; className?: string }) {
  const plan = PLAN_BY_ID[status.plan];
  return (
    <dl className={cn("grid gap-3 sm:grid-cols-2", className)}>
      <Usage label="Projects you own" used={status.usage.projects} limit={plan.limits.projects} />
      <Usage label="Figma comparisons this month" hint="resets on the 1st (UTC)" used={status.usage.figmaRunsThisMonth} limit={plan.limits.figmaComparesPerMonth} />
      <Fact label="Pages per project" value={limitText(plan.limits.pagesPerProject)} />
      <Fact label="People per project" value={limitText(plan.limits.membersPerProject)} />
      <Fact label="Screen recordings" value={plan.limits.recordings ? "Included" : "Pro and up"} />
      <Fact label="Frozen versions & PNG export" value={plan.limits.frozenVersions ? "Included" : "Pro and up"} />
    </dl>
  );
}

const limitText = (n: number) => (n === Infinity ? "Unlimited" : String(n));

function Usage({ label, hint, used, limit }: { label: string; hint?: string; used: number; limit: number }) {
  const pct = limit === Infinity ? 0 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div>
      <dt className="text-[12px] text-ink-3">
        {label}
        {hint && limit !== Infinity && <span className="text-ink-3/80"> · {hint}</span>}
      </dt>
      <dd className="mt-0.5 text-[13.5px] font-medium text-ink">
        {used} of {limitText(limit)}
      </dd>
      {limit !== Infinity && (
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-hover">
          <div className={cn("h-full rounded-full", pct >= 100 ? "bg-red" : "bg-ink")} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-[13.5px] font-medium text-ink">{value}</dd>
    </div>
  );
}
