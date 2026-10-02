"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { formatPrice } from "@/lib/billing/plans";
import { AuditRows } from "./AuditTable";
import { Card, ErrorNote, PageHeader, plural, Skeleton, StatTile, Table, Th, useAdminData } from "./ui";

/** /admin — the numbers at a glance and what changed last. */
export function Overview() {
  const stats = useAdminData(() => api.admin.stats());
  const audit = useAdminData(() => api.admin.audit({ limit: 10 }));
  const s = stats.data;
  return (
    <div className="space-y-8">
      <PageHeader title="Overview" description="Who's using Redline, who pays for it, and what the admins changed recently." />

      {stats.error && <ErrorNote>{stats.error}</ErrorNote>}
      <section aria-label="Statistics" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {!s ? (
          Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[88px] rounded-xl" />)
        ) : (
          <>
            <StatTile label="Users" value={s.users} hint={`${plural(s.admins, "admin")}`} />
            <StatTile label="Paying" value={s.paying} hint={s.paying ? `${s.byPlan.pro} Pro · ${s.byPlan.team} Team` : "Stripe subscriptions"} />
            <StatTile label="MRR" value={formatPrice(s.mrr)} hint={`${s.byInterval.month} monthly · ${s.byInterval.year} yearly, spread per month`} />
            <StatTile label="Manual grants" value={s.grants} hint="grants and codes still running" />
            <StatTile label="Complimentary" value={s.collaborators} hint="people sharing a project with an admin" />
            <StatTile label="Projects" value={s.projects} hint="owned across all accounts" />
            <StatTile label="Pages" value={s.pages} hint="across every project" />
            <StatTile label="Figma runs" value={s.figmaRunsThisMonth} hint="this month, resets on the 1st (UTC)" />
          </>
        )}
      </section>

      <Card
        title="Recent activity"
        aside={
          <Link href="/admin/audit" className="inline-flex items-center gap-1 text-[12px] font-medium text-ink-2 hover:text-ink">
            Full audit log <ArrowRight size={12} />
          </Link>
        }
        padded={false}
      >
        {audit.error && (
          <div className="px-5 pb-4">
            <ErrorNote>{audit.error}</ErrorNote>
          </div>
        )}
        <Table className="rounded-t-none shadow-none" minWidth={720}>
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
            <AuditRows entries={audit.data?.entries ?? null} loading={audit.loading} empty="Nothing yet — grants, codes and admin changes will show up here." />
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
