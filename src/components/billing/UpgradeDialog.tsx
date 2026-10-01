"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type BillingStatus, type PaywallDetail } from "@/lib/api";
import { PLAN_BY_ID, type Interval, type PlanId } from "@/lib/billing/plans";
import { Dialog, DialogContent } from "@/components/ui/primitives";
import { PlanPicker } from "./PlanPicker";

/**
 * Mounted once in the root layout. Any screen that hits a plan limit gets a
 * 402 from the API, lib/api.ts dispatches `redline:paywall`, and this dialog
 * opens with the limit's message and the plans. Nothing else in the app has
 * to know about billing.
 */
export function UpgradeDialogHost() {
  const [detail, setDetail] = useState<PaywallDetail | null>(null);
  useEffect(() => {
    const onPaywall = (e: Event) => setDetail((e as CustomEvent<PaywallDetail>).detail);
    window.addEventListener("redline:paywall", onPaywall);
    return () => window.removeEventListener("redline:paywall", onPaywall);
  }, []);
  return (
    <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
      {detail && <UpgradeDialog detail={detail} />}
    </Dialog>
  );
}

function UpgradeDialog({ detail }: { detail: PaywallDetail }) {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [interval, setIntervalChoice] = useState<Interval>("year");
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.billing
      .status()
      .then(setStatus)
      .catch((e) => setError((e as Error).message));
  }, []);

  const choose = useCallback(async (plan: Exclude<PlanId, "free">, iv: Interval) => {
    setBusy(plan);
    setError(null);
    try {
      const { url } = await api.billing.checkout(plan, iv);
      window.location.assign(url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }, []);

  const suggested = PLAN_BY_ID[detail.plan];
  // The limit belongs to the project owner's plan: a member can't buy their way past it.
  if (!detail.owner) {
    const owner = detail.ownerName || "another member";
    return (
      <DialogContent title="This project's plan doesn't include that" description={`This project belongs to ${owner}. ${detail.message.replace(/ Upgrade to .*$/, "")}`} width={440}>
        <p className="text-[13px] text-ink-2">
          Ask {owner} to upgrade to {suggested.name} — limits follow the project owner&apos;s plan, so everyone in the project benefits.
        </p>
      </DialogContent>
    );
  }
  const notSetUp = status ? !status.stripeEnabled : false;
  return (
    <DialogContent title={`Upgrade to ${suggested.name}`} description={detail.message} width={720} className="max-h-[calc(100vh-32px)] overflow-y-auto">
      {notSetUp ? (
        <p className="rounded-lg bg-hover px-3 py-2 text-[12.5px] text-ink-2">Payments aren&apos;t set up on this server yet — ask the person running it to enable them.</p>
      ) : (
        <PlanPicker current={status?.plan ?? "free"} interval={interval} onInterval={setIntervalChoice} onChoose={choose} busy={busy} highlight={detail.plan} compact />
      )}
      {error && <p className="mt-3 text-[12.5px] text-red-ink">{error}</p>}
      {!notSetUp && <p className="mt-3 text-[11.5px] text-ink-3">Secure payment by Stripe. Cancel any time from your billing page.</p>}
    </DialogContent>
  );
}
