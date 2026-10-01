"use client";

import { Check } from "lucide-react";
import { chargeFor, formatPrice, PLANS, type Interval, type Plan, type PlanId } from "@/lib/billing/plans";
import { cn } from "@/lib/util";
import { Button, Segmented } from "@/components/ui/primitives";

/**
 * The three plans side by side with a monthly/yearly toggle. Used by the
 * billing page and by the upgrade dialog, so both always agree on what a
 * plan costs and includes (plans.ts is the only source).
 */
export function PlanPicker({
  current,
  interval,
  onInterval,
  onChoose,
  busy,
  highlight,
  compact = false,
}: {
  current: PlanId;
  interval: Interval;
  onInterval: (i: Interval) => void;
  /** called with a paid plan; the parent starts checkout */
  onChoose: (plan: Exclude<PlanId, "free">, interval: Interval) => void;
  /** the plan whose checkout is being prepared */
  busy?: PlanId | null;
  /** the plan a paywall suggested — gets the emphasis */
  highlight?: PlanId | null;
  compact?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <Segmented<Interval>
          value={interval}
          onChange={onInterval}
          options={[
            { value: "month", label: "Monthly" },
            { value: "year", label: "Yearly" },
          ]}
        />
        <span className={cn("text-[12px] text-ink-3 transition-opacity", interval === "year" ? "opacity-100" : "opacity-0")}>Two months free when billed yearly</span>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-3">
        {PLANS.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            interval={interval}
            current={current}
            busy={busy === plan.id}
            highlight={highlight === plan.id}
            // on a phone the cards stack: the plan a paywall suggested goes first so it's in view
            first={highlight === plan.id}
            onChoose={onChoose}
            compact={compact}
          />
        ))}
      </ul>
    </div>
  );
}

const RANK: Record<PlanId, number> = { free: 0, pro: 1, team: 2 };

function PlanCard({
  plan,
  interval,
  current,
  busy,
  highlight,
  first,
  onChoose,
  compact,
}: {
  plan: Plan;
  interval: Interval;
  current: PlanId;
  busy: boolean;
  highlight: boolean;
  first: boolean;
  onChoose: (plan: Exclude<PlanId, "free">, interval: Interval) => void;
  compact: boolean;
}) {
  const isCurrent = plan.id === current;
  const lower = RANK[plan.id] < RANK[current];
  const perMonth = interval === "year" ? plan.yearly : plan.monthly;
  return (
    <li
      data-plan={plan.id}
      className={cn(
        "flex flex-col rounded-xl bg-panel p-4 hairline",
        first && "order-first sm:order-none",
        // .hairline owns box-shadow, so the emphasis ring is an outline
        highlight && !isCurrent && "outline outline-2 -outline-offset-1 outline-ink",
        isCurrent && "bg-hover",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-semibold text-ink">{plan.name}</span>
        {isCurrent && <span className="rounded-full bg-paper px-1.5 py-0.5 text-[10.5px] font-medium text-ink-2 hairline">Current</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-[24px] font-semibold tracking-[-0.02em] text-ink">{plan.monthly ? formatPrice(perMonth) : "€0"}</span>
        <span className="text-[12px] text-ink-3">/ month</span>
      </div>
      <div className="mt-0.5 h-4 text-[11.5px] text-ink-3">
        {plan.monthly ? (interval === "year" ? `billed ${formatPrice(chargeFor(plan, "year"))} a year` : "billed monthly") : "no card needed"}
      </div>
      {!compact && <p className="mt-2 text-[12.5px] leading-snug text-ink-2">{plan.tagline}</p>}
      <ul className="mt-3 space-y-1.5 text-[12.5px] text-ink-2">
        {plan.features.slice(0, compact ? 3 : undefined).map((f) => (
          <li key={f} className="flex items-start gap-1.5">
            <Check size={13} className="mt-0.5 shrink-0 text-green" /> {f}
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-4">
        {isCurrent ? (
          <Button disabled className="w-full" variant="secondary">
            Current plan
          </Button>
        ) : lower ? (
          // never sell a downgrade here — that is what the portal's cancel / switch flow is for
          <p className="text-[11.5px] leading-snug text-ink-3">
            {plan.id === "free" ? "Cancel under “Manage billing” to return to Free at the end of the period." : `Everything in ${plan.name} is included in your plan.`}
          </p>
        ) : (
          <Button variant={highlight || RANK[plan.id] > RANK[current] ? "primary" : "secondary"} className="w-full" disabled={busy} onClick={() => onChoose(plan.id as Exclude<PlanId, "free">, interval)}>
            {busy ? "One moment…" : `Upgrade to ${plan.name}`}
          </Button>
        )}
      </div>
    </li>
  );
}
