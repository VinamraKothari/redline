"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CreditCard, Sparkles, Ticket } from "lucide-react";
import { accountApi } from "@/lib/account-api";
import { api, type BillingStatus } from "@/lib/api";
import { isPaidPlan, PLAN_BY_ID } from "@/lib/billing/plans";
import { cn } from "@/lib/util";
import { Button, Input } from "@/components/ui/primitives";
import { alsoPayingLine, formatDay, isComplimentary, planReason, planSource, planUntil } from "@/components/billing/plan-source";

/**
 * The plan in one line with the reason behind it, the way to change it, and
 * the box for a code. Complimentary accounts (admins, their collaborators)
 * are never offered anything to buy.
 */
export function PlanCard({ status, onStatus }: { status: BillingStatus | null; onStatus: (s: BillingStatus) => void }) {
  const [portalBusy, setPortalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (!status) return <div className="h-[132px] animate-pulse rounded-xl bg-hover" />;

  const source = planSource(status);
  const complimentary = isComplimentary(source);
  const plan = PLAN_BY_ID[status.plan];
  const pastDue = status.subscription?.status === "past_due";
  // a Stripe customer — current or past — has a portal with their card and invoices in it, whatever the plan's source
  const paying = Boolean(status.subscription?.paying);
  // the subscription a complimentary account is still paying for (a customer who became a collaborator)
  const alsoPaying = complimentary && paying && isPaidPlan(status.subscription?.plan) && ["active", "trialing", "past_due"].includes(status.subscription?.status ?? "");

  return (
    <div className="rounded-xl bg-panel p-5 hairline">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span data-testid="account-plan" className="text-[22px] font-semibold tracking-[-0.02em] text-ink">
              {plan.name}
            </span>
            {complimentary && <span className="rounded-full bg-paper px-1.5 py-0.5 text-[10.5px] font-medium text-ink-2 hairline">no payment needed</span>}
            {pastDue && <span className="rounded-full bg-red-soft px-1.5 py-0.5 text-[10.5px] font-medium text-red-ink hairline">payment failed</span>}
          </div>
          <p data-testid="plan-line" className={cn("mt-1 text-[13px]", pastDue ? "text-red-ink" : "text-ink-2")}>
            <span className="sr-only">{plan.name} · </span>
            {planReason(status)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {complimentary ? (
            <Link href="/account/billing" className="press inline-flex h-8 items-center gap-1.5 rounded-md bg-panel px-3 text-[13px] font-medium text-ink hairline hover:bg-hover">
              Plan details <ArrowRight size={13} />
            </Link>
          ) : (
            <Link href="/account/billing" className="press inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-[13px] font-medium text-white hover:bg-black">
              {status.plan === "free" ? "Upgrade" : "Change plan"} <ArrowRight size={13} />
            </Link>
          )}
          {paying && (
            <Button variant="secondary" onClick={openPortal} disabled={portalBusy}>
              <CreditCard size={13} /> {portalBusy ? "Opening…" : "Manage billing"}
            </Button>
          )}
        </div>
      </div>
      {alsoPaying ? (
        <p data-testid="also-paying" className="mt-3 rounded-lg bg-hover px-3 py-2 text-[12.5px] leading-relaxed text-ink">
          {alsoPayingLine(status.subscription!)}
        </p>
      ) : (
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
          {complimentary
            ? source === "admin"
              ? "Admins are on Team for free, with every limit lifted. There is nothing to pay and nothing to renew."
              : "People who share a project with a Redline admin are on Team for free, including their own projects. There is nothing to pay while you work together."
            : source === "stripe" && status.plan !== "free"
              ? "Cancel, change your card or download invoices under “Manage billing” — it opens your Stripe billing portal."
              : source === "manual" || source === "code"
                ? "No card on file. When the grant ends your account returns to Free; you can subscribe at any time before that."
                : paying
                  ? "Your past invoices stay available under “Manage billing”. Your plan covers every project you own; the people you invite use it for free."
                  : "Your plan covers every project you own. The people you invite use it for free."}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[12.5px] text-red-ink">
          {error}
        </p>
      )}

      <RedeemForm onStatus={onStatus} />
    </div>
  );
}

/**
 * A code grants a plan for a number of months without a card. The server
 * decides what a code is worth and says in plain words why one didn't work.
 */
function RedeemForm({ onStatus }: { onStatus: (s: BillingStatus) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function redeem(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!c) return;
    setBusy(true);
    setResult(null);
    try {
      const next = await accountApi.redeemCode(c);
      onStatus(next);
      const until = planUntil(next);
      setResult({ ok: true, text: `${PLAN_BY_ID[next.plan].name}${until ? ` until ${formatDay(until)}` : ""} — enjoy.` });
      setCode("");
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={redeem} className="mt-5 border-t border-line pt-4" aria-labelledby="redeem-heading">
      <div className="flex items-center gap-1.5">
        <Ticket size={13} className="text-ink-3" />
        <h3 id="redeem-heading" className="text-[12.5px] font-medium text-ink">
          Redeem a code
        </h3>
      </div>
      <p className="mt-0.5 text-[12px] text-ink-3">Got a code from us or a partner? It puts the plan on your account without a card.</p>
      <div className="mt-2.5 flex max-w-[420px] items-center gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="PRO-7K3M-QZ"
          aria-label="Code"
          spellCheck={false}
          autoCapitalize="characters"
          className="mono uppercase placeholder:normal-case"
        />
        <Button type="submit" variant="secondary" disabled={busy || !code.trim()} className="shrink-0">
          {busy ? "Checking…" : "Redeem"}
        </Button>
      </div>
      {result && (
        <p role={result.ok ? "status" : "alert"} data-testid="redeem-result" className={cn("mt-2 flex items-center gap-1.5 text-[12.5px]", result.ok ? "text-ink" : "text-red-ink")}>
          {result.ok && <Sparkles size={13} className="text-green" />}
          {result.text}
        </p>
      )}
    </form>
  );
}
