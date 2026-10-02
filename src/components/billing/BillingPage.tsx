"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, CreditCard, FileText, RotateCcw, Sparkles, XCircle } from "lucide-react";
import { api, type BillingStatus } from "@/lib/api";
import { isInterval, isPaidPlan, PLAN_BY_ID, type Interval, type PlanId } from "@/lib/billing/plans";
import { cn } from "@/lib/util";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/primitives";
import { AccountMenu } from "@/components/home/AccountMenu";
import { alsoPayingLine, formatDay, isComplimentary, planSource, planUntil } from "./plan-source";
import { PlanPicker } from "./PlanPicker";
import { UsageGrid } from "./UsageGrid";

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
  // a Stripe customer — current or past — has a portal with their invoices in it
  const paying = Boolean(sub?.paying);
  const source = status ? planSource(status) : "free";
  const complimentary = isComplimentary(source);
  // a live paid subscription (the row's plan, not the effective one — a collaborator's row may say Pro while the account is on Team)
  const subscribed = Boolean(sub && isPaidPlan(sub.plan) && ["active", "trialing", "past_due"].includes(sub.status));
  const alsoPaying = complimentary && subscribed;

  return (
    <main className="relative h-full overflow-y-auto overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0 canvas-grid opacity-60" />
      <div className="relative mx-auto flex min-h-full max-w-[880px] flex-col px-6 pb-10 pt-8">
        <header className="flex items-center justify-between">
          <Logo />
          <AccountMenu />
        </header>

        <section className="mt-12">
          <Link href="/account" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-ink-2 hover:text-ink">
            <ArrowLeft size={13} /> Account
          </Link>
          <h1 className="mt-3 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">Plan &amp; billing</h1>
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
        {status && !status.stripeEnabled && !complimentary && (
          <Notice tone="neutral" icon={<AlertTriangle size={14} />}>
            Payments aren&apos;t set up on this server yet. Every account is on the Free plan until they are.
          </Notice>
        )}
        {sub?.status === "past_due" && (
          <Notice tone="warn" icon={<AlertTriangle size={14} />}>
            Your last payment failed. Update your card under “Manage billing” to keep the {PLAN_BY_ID[sub.plan].name} plan.
          </Notice>
        )}

        <section className="mt-6 rounded-xl bg-panel p-5 hairline">
          {!status || !planInfo ? (
            <div className="h-[72px] animate-pulse rounded-lg bg-hover" />
          ) : (
            <div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Current plan</div>
                <div className="mt-1 flex items-center gap-2">
                  <span data-testid="current-plan" className="text-[22px] font-semibold tracking-[-0.02em] text-ink">
                    {planInfo.name}
                  </span>
                  {complimentary ? (
                    <span className="rounded-full bg-paper px-1.5 py-0.5 text-[10.5px] font-medium text-ink-2 hairline">no payment needed</span>
                  ) : (
                    sub &&
                    sub.status !== "none" && (
                      <span className={cn("rounded-full px-1.5 py-0.5 text-[10.5px] font-medium hairline", sub.status === "past_due" ? "bg-red-soft text-red-ink" : "bg-paper text-ink-2")}>
                        {sub.cancel_at_period_end ? "cancels at period end" : sub.status.replace("_", " ")}
                      </span>
                    )
                  )}
                </div>
                <p className="mt-1 text-[12.5px] text-ink-2">{renewalLine(status)}</p>
              </div>
            </div>
          )}

          {status && planInfo && <UsageGrid status={status} className="mt-5 border-t border-line pt-4" />}
        </section>

        {status && paying && (
          <section className="mt-4 rounded-xl bg-panel p-5 hairline" aria-labelledby="billing-details">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="billing-details" className="text-[14px] font-semibold text-ink">
                Billing details
              </h2>
              <Button variant="secondary" onClick={openPortal} disabled={portalBusy}>
                <CreditCard size={13} /> {portalBusy ? "Opening…" : "Manage billing"}
              </Button>
            </div>
            {alsoPaying && sub && (
              <p data-testid="also-paying" role="status" className="mt-3 rounded-lg bg-hover px-3 py-2.5 text-[13px] leading-relaxed text-ink">
                {alsoPayingLine(sub)}
              </p>
            )}
            {/* one signal per state: a collaborator's ending subscription is covered by the line above */}
            {sub?.cancel_at_period_end && sub.current_period_end && !alsoPaying && (
              <div role="status" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-hover px-3 py-2.5">
                <p className="text-[13px] text-ink">
                  Your plan ends on <span className="font-medium">{formatDay(sub.current_period_end)}</span> — you keep {PLAN_BY_ID[sub.plan].name} until then.
                </p>
                <Button variant="primary" size="sm" onClick={openPortal} disabled={portalBusy}>
                  <RotateCcw size={12} /> Reactivate
                </Button>
              </div>
            )}
            <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
              Your card, invoices and VAT number are kept by Stripe, not by Redline — “Manage billing” opens your secure billing portal, where you can:
            </p>
            <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-[12.5px] text-ink-2 sm:grid-cols-2">
              {[
                // nothing to cancel once the subscription has run out
                ...(subscribed && !(alsoPaying && sub?.cancel_at_period_end) ? [{ Icon: XCircle, text: "Cancel your plan (you keep it until the period ends)" }] : []),
                { Icon: CreditCard, text: "Change the card you pay with" },
                { Icon: FileText, text: "Download your invoices and receipts" },
                { Icon: FileText, text: "Add a VAT number and billing address for your invoices" },
              ].map(({ Icon, text }) => (
                <li key={text} className="flex items-start gap-2">
                  <Icon size={13} className="mt-[3px] shrink-0 text-ink-3" /> {text}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11.5px] text-ink-3">Stripe e-mails a receipt for every payment and a note if a card payment fails.</p>
          </section>
        )}

        <section className="mt-8">
          <h2 className="text-[16px] font-semibold text-ink">Plans</h2>
          {complimentary ? (
            <div className="mt-3 rounded-xl bg-panel p-5 hairline">
              <p className="text-[13.5px] leading-relaxed text-ink">
                {source === "admin"
                  ? "You're a Redline admin, so your account is on Team with every limit lifted — there is nothing to buy."
                  : "You share a project with a Redline admin, so your account is on Team at no charge for as long as you work together — including the projects you own yourself."}
              </p>
              <p className="mt-2 text-[12.5px] text-ink-2">
                {source === "admin" ? "Plans and prices for everyone else live on the " : "If that changes one day, you can pick a plan here; until then there is nothing to pay. The public plans are on the "}
                <Link href="/pricing" className="font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-red">
                  pricing page
                </Link>
                .
              </p>
            </div>
          ) : (
            <>
              <p className="mt-1 text-[13px] text-ink-2">Prices in euro, VAT where it applies. Change or cancel any time.</p>
              <div className="mt-4">
                <PlanPicker current={status?.plan ?? "free"} interval={interval} onInterval={setIntervalChoice} onChoose={choose} busy={busy} />
              </div>
            </>
          )}
          {error && <p className="mt-3 text-[13px] text-red-ink">{error}</p>}
        </section>

        <footer className="mt-auto pt-16 text-[12px] text-ink-3">Payments are handled by Stripe; Redline never sees your card number.</footer>
      </div>
    </main>
  );
}

function renewalLine(s: BillingStatus): string {
  const sub = s.subscription;
  const source = planSource(s);
  const until = planUntil(s);
  if (source === "admin") return "You're a Redline admin — Team is on the house.";
  if (source === "collaborator") return "Complimentary Team, because you share a project with a Redline admin.";
  if (s.plan === "free") return sub?.status === "canceled" ? "Your subscription has ended — you're on Free. Upgrade again any time." : "Free forever — upgrade when you need more.";
  if (source === "manual" || source === "code") {
    const how = source === "code" ? "Redeemed with a code" : "Granted manually";
    return until ? `${how} — runs until ${formatDay(until)}, no card needed.` : `${how} — no renewal date.`;
  }
  if (!sub?.current_period_end) return "Granted manually — no renewal date.";
  if (sub.cancel_at_period_end) return `Cancels on ${formatDay(sub.current_period_end)} — details and Reactivate below.`;
  return `Renews on ${formatDay(sub.current_period_end)}, billed ${sub.interval === "year" ? "yearly" : "monthly"}.`;
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
