"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { api } from "@/lib/api";
import type { AuditView } from "@/lib/admin/types";
import { formatPrice, PLAN_BY_ID, type PlanId } from "@/lib/billing/plans";
import { Button } from "@/components/ui/primitives";
import { EmptyRow, ErrorNote, fmtDate, fmtDateTime, PageHeader, Person, plural, Select, Skeleton, Table, Td, Th, useAdminData } from "./ui";

const ACTION_LABEL: Record<string, string> = {
  "plan.grant": "Granted plan",
  "plan.extend": "Extended grant",
  "plan.revoke": "Revoked grant",
  "code.create": "Created code",
  "code.enable": "Enabled code",
  "code.disable": "Disabled code",
  "code.redeem": "Redeemed code",
  "admin.grant": "Made admin",
  "admin.revoke": "Removed admin",
  "promo.create": "Created coupon",
  "promo.enable": "Enabled coupon",
  "promo.disable": "Disabled coupon",
};

const discount = (d: Record<string, unknown>) => (typeof d.percent_off === "number" ? `${d.percent_off}% off` : typeof d.amount_off === "number" ? `${formatPrice(d.amount_off)} off` : "");
const lasts = (d: Record<string, unknown>) => (d.duration === "forever" ? "forever" : d.duration === "repeating" ? `for ${plural(Number(d.duration_in_months ?? 0), "month")}` : "on the first payment");

const planName = (p: unknown) => (typeof p === "string" && p in PLAN_BY_ID ? PLAN_BY_ID[p as PlanId].name : String(p ?? ""));
const months = (m: unknown) => (typeof m === "number" ? `for ${plural(m, "month")}` : "with no end date");

/** One readable line per entry, built from what each action records; anything unknown falls back to key: value. */
export function describe(e: AuditView): string {
  const d = e.details as Record<string, unknown>;
  const note = typeof d.note === "string" && d.note ? ` — “${d.note}”` : "";
  const prev = d.previous as { plan?: string; source?: string; expires_at?: string | null } | null | undefined;
  switch (e.action) {
    case "plan.grant":
      return `${planName(d.plan)} ${months(d.months)}${d.expires_at ? ` (until ${fmtDate(String(d.expires_at))})` : ""}${prev && prev.plan && prev.plan !== "free" ? `, ${d.replaced ? "replacing" : "was"} ${planName(prev.plan)} via ${prev.source}` : ""}${note}`;
    case "plan.extend":
      return `${planName(d.plan)} by ${plural(Number(d.months ?? 0), "month")}, now until ${fmtDate(String(d.expires_at))}${prev?.expires_at ? ` (was ${fmtDate(prev.expires_at)})` : ""}${note}`;
    case "promo.create":
      return `${String(d.code)}: ${discount(d)} ${lasts(d)}${d.max_redemptions ? `, ${plural(Number(d.max_redemptions), "redemption")}` : ""}${d.expires_at ? `, valid until ${fmtDate(String(d.expires_at))}` : ""}${d.name ? ` — “${String(d.name)}”` : ""}`;
    case "plan.revoke":
      return `${prev && prev.plan ? `Removed ${planName(prev.plan)} (${prev.source})` : "Nothing to remove"}${note}`;
    case "code.create":
      return `${String(d.code)}: ${planName(d.plan)} ${months(d.months)}, ${plural(Number(d.max_uses ?? 1), "use")}${d.expires_at ? `, valid until ${fmtDate(String(d.expires_at))}` : ""}${note}`;
    case "code.redeem":
      return `${String(d.code)} → ${planName(d.plan)} until ${fmtDate(String(d.expires_at))}`;
    case "code.enable":
    case "code.disable":
    case "promo.enable":
    case "promo.disable":
      return String(d.code ?? d.id ?? "");
    case "admin.grant":
    case "admin.revoke":
      return String(d.email ?? "");
    default:
      return Object.entries(d)
        .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
        .join(", ");
  }
}

export function AuditRows({ entries, loading, empty }: { entries: AuditView[] | null; loading: boolean; empty: string }) {
  if (loading && !entries) {
    return (
      <>
        {[0, 1, 2].map((i) => (
          <tr key={i}>
            <Td colSpan={5}>
              <Skeleton className="h-6" />
            </Td>
          </tr>
        ))}
      </>
    );
  }
  if (!entries?.length) return <EmptyRow colSpan={5}>{empty}</EmptyRow>;
  return (
    <>
      {entries.map((e) => (
        <tr key={e.id ?? e.at + e.action}>
          <Td className="whitespace-nowrap text-ink-2">{fmtDateTime(e.at)}</Td>
          <Td>
            <Person profile={e.actor} href={e.actor ? `/admin/users/${e.actor.id}` : undefined} size={20} />
          </Td>
          <Td className="whitespace-nowrap font-medium">{ACTION_LABEL[e.action] ?? e.action}</Td>
          <Td>{e.target && e.target.id !== e.actor?.id ? <Person profile={e.target} href={`/admin/users/${e.target.id}`} size={20} /> : e.target ? <span className="text-ink-3">themselves</span> : <span className="text-ink-3">—</span>}</Td>
          <Td className="max-w-[360px] text-ink-2">
            <span className="line-clamp-2">{describe(e)}</span>
          </Td>
        </tr>
      ))}
    </>
  );
}

/** /admin/audit — everything admins (and code redeemers) did, newest first; `?target=` narrows to one account. */
export function AuditPage() {
  const router = useRouter();
  const params = useSearchParams();
  const target = params.get("target") || undefined;
  const [limit, setLimit] = useState(100);
  const { data, error, loading } = useAdminData(() => api.admin.audit({ target, limit }), `${target ?? ""}|${limit}`);
  const targetProfile = target ? data?.entries.find((e) => e.target?.id === target)?.target : null;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Every plan grant, code, coupon and admin change, with who did it and to whom. Redemptions by users are logged too."
        actions={
          <Select value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-label="How many entries" className="w-auto">
            {[50, 100, 250, 500].map((n) => (
              <option key={n} value={n}>
                Last {n}
              </option>
            ))}
          </Select>
        }
      />
      {target && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
          <span>Showing entries about</span>
          {targetProfile ? <Person profile={targetProfile} href={`/admin/users/${target}`} size={20} /> : <span className="mono text-[11.5px]">{target}</span>}
          <Button size="sm" variant="ghost" onClick={() => router.replace("/admin/audit")}>
            <X size={12} /> Show all
          </Button>
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      <Table minWidth={760}>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Who</Th>
            <Th>Action</Th>
            <Th>Target</Th>
            <Th>Details</Th>
          </tr>
        </thead>
        <tbody>
          <AuditRows entries={data?.entries ?? null} loading={loading} empty={target ? "Nothing has been done to this account yet." : "Nothing yet — grants, codes and admin changes will show up here."} />
        </tbody>
      </Table>
    </div>
  );
}
