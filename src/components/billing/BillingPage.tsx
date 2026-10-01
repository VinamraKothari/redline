"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CreditCard, Sparkles } from "lucide-react";
import { api, type BillingStatus } from "@/lib/api";
import { isInterval, isPaidPlan, PLAN_BY_ID, type Interval, type PlanId } from "@/lib/billing/plans";
import { cn } from "@/lib/util";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/primitives";
import { AccountMenu } from "@/components/home/AccountMenu";
import { PlanPicker } from "./PlanPicker";

/**
 * /account/billing — the plan the account is on, what it has used, and the
 * way to change it. Reads the query string:
 *   ?checkout=success|cancel   back from Stripe (or the test-mode fake)
 *   ?plan=pro&interval=year    from the pricing page: start checkout at once
 */
export function BillingPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [interval, setIntervalChoice] = useState<Interval>("year");
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checkout = params.get("checkout");

  // Back from a successful checkout the webhook may still be on its way:
  // poll every two seconds until the plan changes, six times at most. The
  // counter lives in a ref so a status refresh doesn't restart the budget.
  const polls = useRef(0);
  const [gaveUp, setGaveUp] = useState(false);
  const plan = status?.plan;
  useEffect(() => {
    if (checkout !== "success" || plan !== "free") return;
    const t = setInterval(() => {
      if (++polls.current > 6) {
        clearInterval(t);
        setGaveUp(true);
        return;
      }
      api.billing.status().then(setStatus).catch(() => {});
    }, 2000);
    return () => clearInterval(t);
  }, [checkout, plan]);

  const choose = useCallback(
    async (plan: Exclude<PlanId, "free">, iv: Interval) => {
      setBusy(plan);
      setError(null);
      try {
        const { url } = await api.billing.checkout(plan, iv);
        window.location.assign(url);
      } catch (e) {
        setError((e as Error).message);
        setBusy(null);
      }
    },
    [],
  );

  // First load; the pricing page sends signed-in visitors here with the plan
  // they picked (?plan=pro&interval=year), and checkout starts right away.
  const autoStarted = useRef(false);
  useEffect(() => {
    api.billing
      .status()
      .then((s) => {
        setStatus(s);
        const plan = params.get("plan");
        if (autoStarted.current || !isPaidPlan(plan)) return;
        autoStarted.current = true;
        const iv = isInterval(params.get("interval")) ? (params.get("interval") as Interval) : "month";
        setIntervalChoice(iv);
        if (plan !== s.plan && s.stripeEnabled) void choose(plan, iv);
        else router.replace("/account/billing");
      })
      .catch((e) => setError((e as Error).message));
  }, [params, choose, router]);

  async function openPortal() {
    setPortalBusy(true);
    setError(null);
    try {
      const { url } = await api.billing.portal();
      window.location.assign(url);
    } catch (e) {
      setError((e as Error).message);
      setPortalBusy(false);
    }
  }

  const planInfo = status ? PLAN_BY_ID[status.plan] : null;
  const sub = status?.subscription ?? null;
  const paying = Boolean(sub?.paying);

  return (
    <main className="relative h-full overflow-y-auto overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0 canvas-grid opacity-60" />
      <div className="relative mx-auto flex min-h-full max-w-[880px] flex-col px-6 pb-10 pt-8">
        <header className="flex items-center justify-between">
          <Logo />
          <AccountMenu />
        </header>

        <section className="mt-12">
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">Plan &amp; billing</h1>
          <p className="mt-2 max-w-[520px] text-[14px] leading-relaxed text-ink-2">
            Your plan covers every project you own — the people you invite use it for free.
          </p>
        </section>

        {checkout === "success" && (
          <Notice tone="good" icon={<Sparkles size={14} />}>
            {status && status.plan !== "free"
              ? `Thank you — you're on the ${PLAN_BY_ID[status.plan].name} plan.`
              : gaveUp
                ? "This is taking longer than usual — refresh in a minute; if it still says Free, contact support with your Stripe receipt."
                : "Thank you — activating your plan…"}
          </Notice>
        )}
        {checkout === "cancel" && <Notice tone="neutral">Checkout was cancelled. Nothing was charged.</Notice>}
        {status && !status.stripeEnabled && (
          <Notice tone="neutral" icon={<AlertTriangle size={14} />}>
            Payments aren&apos;t set up on this server yet. Every account is on the Free plan until they are.
          </Notice>
        )}
        {sub?.status === "past_due" && (
          <Notice tone="warn" icon={<AlertTriangle size={14} />}>
            Your last payment failed. Update your card under “Manage billing” to keep the {planInfo?.name} plan.
          </Notice>
        )}

        <section className="mt-6 rounded-xl bg-panel p-5 hairline">
          {!status || !planInfo ? (
            <div className="h-[72px] animate-pulse rounded-lg bg-hover" />
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Current plan</div>
                <div className="mt-1 flex items-center gap-2">
                  <span data-testid="current-plan" className="text-[22px] font-semibold tracking-[-0.02em] text-ink">
                    {planInfo.name}
                  </span>
                  {sub && sub.status !== "none" && (
                    <span className={cn("rounded-full px-1.5 py-0.5 text-[10.5px] font-medium hairline", sub.status === "past_due" ? "bg-red-soft text-red-ink" : "bg-paper text-ink-2")}>
                      {sub.cancel_at_period_end ? "cancels at period end" : sub.status.replace("_", " ")}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[12.5px] text-ink-2">{renewalLine(status)}</p>
              </div>
              {paying && (
                <Button variant="secondary" onClick={openPortal} disabled={portalBusy}>
                  <CreditCard size={13} /> {portalBusy ? "Opening…" : "Manage billing"}
                </Button>
              )}
            </div>
          )}

          {status && planInfo && (
            <dl className="mt-5 grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
              <Usage label="Projects you own" used={status.usage.projects} limit={planInfo.limits.projects} />
              <Usage label="Figma comparisons this month" hint="resets on the 1st (UTC)" used={status.usage.figmaRunsThisMonth} limit={planInfo.limits.figmaComparesPerMonth} />
              <Fact label="Pages per project" value={limitText(planInfo.limits.pagesPerProject)} />
              <Fact label="People per project" value={limitText(planInfo.limits.membersPerProject)} />
              <Fact label="Screen recordings" value={planInfo.limits.recordings ? "Included" : "Pro and up"} />
              <Fact label="Frozen versions & PNG export" value={planInfo.limits.frozenVersions ? "Included" : "Pro and up"} />
            </dl>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-[16px] font-semibold text-ink">Plans</h2>
          <p className="mt-1 text-[13px] text-ink-2">Prices in euro, VAT where it applies. Change or cancel any time.</p>
          <div className="mt-4">
            <PlanPicker current={status?.plan ?? "free"} interval={interval} onInterval={setIntervalChoice} onChoose={choose} busy={busy} />
          </div>
          {error && <p className="mt-3 text-[13px] text-red-ink">{error}</p>}
        </section>

        <footer className="mt-auto pt-16 text-[12px] text-ink-3">Payments are handled by Stripe; Redline never sees your card number.</footer>
      </div>
    </main>
  );
}

function renewalLine(s: BillingStatus): string {
  const sub = s.subscription;
  if (s.plan === "free" || !sub || !sub.current_period_end) return s.plan === "free" ? "Free forever — upgrade when you need more." : "Granted manually — no renewal date.";
  const when = new Date(sub.current_period_end).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  if (sub.cancel_at_period_end) return `Ends on ${when}. You keep ${PLAN_BY_ID[s.plan].name} until then.`;
  return `Renews on ${when}, billed ${sub.interval === "year" ? "yearly" : "monthly"}.`;
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

function Notice({ tone, icon, children }: { tone: "good" | "neutral" | "warn"; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        "mt-6 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] hairline",
        tone === "good" && "bg-panel text-ink",
        tone === "neutral" && "bg-hover text-ink-2",
        tone === "warn" && "bg-red-soft text-red-ink",
      )}
    >
      {icon}
      <span>{children}</span>
    </div>
  );
}
