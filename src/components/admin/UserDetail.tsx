"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Check, ShieldCheck, ShieldOff } from "lucide-react";
import { api } from "@/lib/api";
import type { AdminUserDetail } from "@/lib/admin/types";
import { PLAN_BY_ID, PLANS, type PlanId } from "@/lib/billing/plans";
import { ROLE_LABEL } from "@/lib/types";
import { cn } from "@/lib/util";
import { Avatar, Button, Dialog, DialogClose, DialogContent, Input } from "@/components/ui/primitives";
import { useMe } from "@/components/home/AccountMenu";
import { AuditRows } from "./AuditTable";
import { AdminBadge, Card, ErrorNote, Field, fmtDate, fmtDateTime, Note, Person, PlanName, plural, Select, Skeleton, SOURCE_HINT, SourceChip, StatusChip, Table, Td, Th, useAdminData } from "./ui";

/** /admin/users/[id] — one account: who they are, what plan they get and why, and the levers to change it. */
export function UserDetail({ id }: { id: string }) {
  const { data, setData, error, loading } = useAdminData(() => api.admin.user(id), id);
  const me = useMe();
  const [planOpen, setPlanOpen] = useState(false);
  // bumped on every opening: the dialog remounts with the account's current grant as its defaults
  const [planOpenings, setPlanOpenings] = useState(0);
  const [adminOpen, setAdminOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const u = data;

  async function toggleAdmin() {
    if (!u) return;
    setActionError(null);
    try {
      setData(await api.admin.setAdmin(u.profile.id, !u.is_admin));
      setAdminOpen(false);
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/admin/users" className="inline-flex items-center gap-1 text-[12.5px] text-ink-2 hover:text-ink">
        <ArrowLeft size={13} /> All users
      </Link>
      {error && <ErrorNote>{error}</ErrorNote>}
      {loading && !u ? (
        <div className="space-y-4">
          <Skeleton className="h-[88px] rounded-xl" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-[220px] rounded-xl" />
            <Skeleton className="h-[220px] rounded-xl" />
          </div>
        </div>
      ) : u ? (
        <>
          {/* profile */}
          <section className="flex flex-col gap-4 rounded-xl bg-panel p-5 hairline sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-4">
              <Avatar name={u.profile.name} color={u.profile.color} src={u.profile.avatar_url} size={52} />
              <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="break-words text-[20px] font-semibold leading-tight tracking-[-0.02em] text-ink">{u.profile.name}</h1>
                {u.is_admin && <AdminBadge />}
                {u.collaborator && !u.is_admin && <SourceChip source="collaborator" />}
              </div>
              <div className="mt-0.5 truncate text-[13px] text-ink-2">{u.profile.email}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-3">
                <span>Joined {fmtDate(u.profile.created_at)}</span>
                <span aria-hidden>·</span>
                <span>Last seen {fmtDate(u.profile.updated_at)}</span>
                <span aria-hidden>·</span>
                <span className="mono select-all break-all">{u.profile.id}</span>
              </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:self-center">
              <Button variant="secondary" size="sm" onClick={() => setAdminOpen(true)} disabled={u.env_admin || u.profile.id === me?.id}>
                {u.is_admin ? (
                  <>
                    <ShieldOff size={13} /> Remove admin
                  </>
                ) : (
                  <>
                    <ShieldCheck size={13} /> Make admin
                  </>
                )}
              </Button>
            </div>
          </section>
          {u.env_admin && <Note>This account is listed in <span className="mono">REDLINE_ADMIN_EMAILS</span>, so it is always an admin — that can only change in the environment variable.</Note>}
          {u.profile.id === me?.id && !u.env_admin && <Note>This is you. Another admin has to remove your admin access, so you can&apos;t lock yourself out by accident.</Note>}
          {actionError && <ErrorNote>{actionError}</ErrorNote>}

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <PlanCard
              u={u}
              onChange={() => {
                setPlanOpenings((n) => n + 1);
                setPlanOpen(true);
              }}
            />
            <SubscriptionRowCard u={u} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card title={`Projects owned · ${u.projects.length}`} padded={false}>
              {u.projects.length === 0 ? (
                <p className="px-5 pb-5 text-[12.5px] text-ink-3">Doesn&apos;t own any projects.</p>
              ) : (
                <Table className="rounded-t-none shadow-none" minWidth={360}>
                  <thead>
                    <tr>
                      <Th>Project</Th>
                      <Th align="right">Pages</Th>
                      <Th align="right">People</Th>
                      <Th>Created</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {u.projects.map((p) => (
                      <tr key={p.id}>
                        <Td className="max-w-[260px]">
                          <Link href={`/p/${p.id}`} className="inline-flex max-w-full items-center gap-1 truncate font-medium text-ink hover:underline">
                            <span className="truncate">{p.name}</span> <ArrowUpRight size={12} className="shrink-0 text-ink-3" />
                          </Link>
                        </Td>
                        <Td align="right">{p.pages}</Td>
                        <Td align="right">{p.members}</Td>
                        <Td className="whitespace-nowrap text-ink-2">{fmtDate(p.created_at)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
            <Card title={`Member of · ${u.memberships.length}`} padded={false}>
              {u.memberships.length === 0 ? (
                <p className="px-5 pb-5 text-[12.5px] text-ink-3">Not a member of anyone else&apos;s project.</p>
              ) : (
                <Table className="rounded-t-none shadow-none" minWidth={360}>
                  <thead>
                    <tr>
                      <Th>Project</Th>
                      <Th>Owner</Th>
                      <Th>Role</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {u.memberships.map((m) => (
                      <tr key={m.id}>
                        <Td className="max-w-[220px]">
                          <Link href={`/p/${m.id}`} className="inline-flex max-w-full items-center gap-1 truncate font-medium text-ink hover:underline">
                            <span className="truncate">{m.name}</span> <ArrowUpRight size={12} className="shrink-0 text-ink-3" />
                          </Link>
                        </Td>
                        <Td>
                          <Person profile={m.owner} href={m.owner ? `/admin/users/${m.owner.id}` : undefined} size={20} />
                        </Td>
                        <Td className="whitespace-nowrap text-ink-2">{ROLE_LABEL[m.role]}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </div>

          <Card
            title="Audit trail"
            aside={
              <Link href={`/admin/audit?target=${u.profile.id}`} className="text-[12px] font-medium text-ink-2 hover:text-ink">
                Open in audit log
              </Link>
            }
            padded={false}
          >
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
                <AuditRows entries={u.audit} loading={false} empty="Nothing has been done to this account yet." />
              </tbody>
            </Table>
          </Card>

          <PlanDialog key={planOpenings} open={planOpen} onOpenChange={setPlanOpen} u={u} onSaved={setData} />

          <Dialog open={adminOpen} onOpenChange={setAdminOpen}>
            <DialogContent title={u.is_admin ? "Remove admin access?" : "Make this person an admin?"} description={u.is_admin ? `${u.profile.name} will lose the admin area and go back to whatever plan their subscription gives them.` : `${u.profile.name} will be able to open the admin area, change anyone's plan and create codes — and everyone they share a project with gets Team for free.`}>
              <div className="mt-4 flex justify-end gap-2">
                <DialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </DialogClose>
                <Button variant={u.is_admin ? "danger" : "primary"} onClick={toggleAdmin}>
                  {u.is_admin ? "Remove admin" : "Make admin"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}

/** Is there a grant of ours (manual or code) on this account, and is it still running? */
function grantState(u: AdminUserDetail, now: number): { grant: NonNullable<AdminUserDetail["subscription"]> | null; running: boolean; expired: boolean } {
  const row = u.subscription;
  if (!row || u.stripe_managed || row.stripe_subscription_id || row.plan === "free") return { grant: null, running: false, expired: false };
  if (row.source !== "manual" && row.source !== "code") return { grant: null, running: false, expired: false };
  const expired = Boolean(row.expires_at && Date.parse(row.expires_at) < now);
  return { grant: row, running: !expired, expired };
}

/** The plan the account gets, in one sentence, with the lever to change it. */
function PlanCard({ u, onChange }: { u: AdminUserDetail; onChange: () => void }) {
  const row = u.subscription;
  return (
    <Card title="Effective plan" aside={<SourceChip source={u.source} />}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span data-testid="effective-plan" className="text-[26px] font-semibold tracking-[-0.02em] text-ink">
          {PLAN_BY_ID[u.plan].name}
        </span>
        {u.until && <span className="text-[12.5px] text-ink-2">{u.source === "stripe" ? (row?.cancel_at_period_end ? "ends" : "renews") : "until"} {fmtDate(u.until)}</span>}
        {!u.until && u.plan !== "free" && <span className="text-[12.5px] text-ink-2">no end date</span>}
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{SOURCE_HINT[u.source]}</p>
      {(u.source === "admin" || u.source === "collaborator") && row && row.plan !== "free" && (
        <p className="mt-1 text-[12px] text-ink-3">Underneath, the billing record says {PLAN_BY_ID[row.plan].name} ({row.status.replace(/_/g, " ")}); it only matters if this changes.</p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {u.stripe_managed ? (
          <>
            <Note className="w-full">Managed by Stripe — use the Stripe dashboard to change or cancel this subscription; the webhook brings the change back here.</Note>
            {u.stripe_url && (
              <a href={u.stripe_url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-panel px-3 text-[13px] font-medium text-ink hairline hover:bg-hover">
                Open customer in Stripe <ArrowUpRight size={13} />
              </a>
            )}
          </>
        ) : (
          <Button variant="primary" onClick={onChange}>
            Change plan
          </Button>
        )}
      </div>
    </Card>
  );
}

/** What the billing record holds for this account, in plain words. */
function SubscriptionRowCard({ u }: { u: AdminUserDetail }) {
  const [now] = useState(() => Date.now());
  const row = u.subscription;
  if (!row) {
    return (
      <Card title="Billing record">
        <p className="text-[12.5px] leading-relaxed text-ink-2">Nothing on file — this account never paid, was never granted a plan and hasn&apos;t redeemed a code.</p>
      </Card>
    );
  }
  const source = row.plan === "free" ? "none" : row.stripe_subscription_id ? "stripe" : (row.source ?? "stripe");
  const { expired } = grantState(u, now);
  return (
    <Card title="Billing record" aside={row.plan === "free" ? <span className="text-[11.5px] text-ink-3">no plan</span> : <StatusChip status={row.status} />}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12.5px]">
        <Fact label="Plan" value={row.plan === "free" ? <span className="text-ink-2">Free — no plan</span> : <PlanName plan={row.plan} />} />
        <Fact label="Source" value={source === "none" ? "—" : source === "stripe" ? "Stripe" : source === "manual" ? "Manual grant" : "Redeemed code"} />
        {source === "stripe" ? (
          <>
            <Fact label="Interval" value={row.interval === "year" ? "Yearly" : row.interval === "month" ? "Monthly" : "—"} />
            <Fact label="Period ends" value={row.cancel_at_period_end ? `${fmtDate(row.current_period_end)} (cancels)` : fmtDate(row.current_period_end)} />
            <Fact label="Customer" value={row.stripe_customer_id ? <span className="mono text-[11.5px]">{row.stripe_customer_id}</span> : "—"} />
            <Fact label="Subscription" value={row.stripe_subscription_id ? <span className="mono text-[11.5px]">{row.stripe_subscription_id}</span> : "—"} />
          </>
        ) : source === "none" ? (
          row.stripe_customer_id && <Fact label="Stripe customer" value={<span className="mono text-[11.5px]">{row.stripe_customer_id}</span>} className="col-span-2" />
        ) : (
          <>
            <Fact
              label={expired ? "Expired" : "Expires"}
              value={row.expires_at ? <span className={expired ? "font-medium text-red-ink" : undefined}>{fmtDate(row.expires_at)}{expired && " (expired)"}</span> : "No end date"}
            />
            <Fact label="Granted by" value={u.granted_by ? <Person profile={u.granted_by} href={`/admin/users/${u.granted_by.id}`} size={18} /> : "—"} />
            <Fact label="Note" value={row.note || "—"} className="col-span-2" />
            {row.stripe_customer_id && <Fact label="Stripe customer" value={<span className="mono text-[11.5px]">{row.stripe_customer_id}</span>} className="col-span-2" />}
          </>
        )}
        <Fact label="Updated" value={fmtDateTime(row.updated_at)} className="col-span-2" />
      </dl>
    </Card>
  );
}

function Fact({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11px] font-medium text-ink-3">{label}</dt>
      <dd className="mt-0.5 truncate text-ink">{value}</dd>
    </div>
  );
}

const DURATIONS: { value: string; label: string }[] = [
  { value: "1", label: "1 month" },
  { value: "3", label: "3 months" },
  { value: "6", label: "6 months" },
  { value: "12", label: "12 months" },
  { value: "forever", label: "No end date" },
];

const addMonthsLocal = (from: Date, months: number) => {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
};

/**
 * Pick a plan and how long it lasts, say why, confirm. When a grant is
 * running, the dialog says so and offers to extend it (the default) instead
 * of starting over; Free removes the grant and is only offered when there is
 * one of ours to remove.
 */
function PlanDialog({ open, onOpenChange, u, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; u: AdminUserDetail; onSaved: (d: AdminUserDetail) => void }) {
  // "now" as of opening the page: the preview dates are a courtesy, the server does the real arithmetic
  const [now] = useState(() => Date.now());
  const { grant, running, expired } = grantState(u, now);
  const canExtend = Boolean(running && grant?.expires_at);
  const [mode, setMode] = useState<"extend" | "replace">(canExtend ? "extend" : "replace");
  const [plan, setPlan] = useState<PlanId>(grant && grant.plan !== "free" ? grant.plan : "pro");
  const [duration, setDuration] = useState("3");
  const [note, setNote] = useState(running ? grant?.note ?? "" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const extend = mode === "extend" && plan !== "free";
      onSaved(await api.admin.setPlan(u.profile.id, { plan, months: plan === "free" || (duration === "forever" && !extend) ? null : Number(duration), note: note.trim(), mode: extend ? "extend" : "replace" }));
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const months = duration === "forever" ? null : Number(duration);
  const extending = mode === "extend" && plan !== "free" && canExtend;
  const base = extending ? new Date(Math.max(Date.parse(grant!.expires_at!), now)) : new Date(now);
  const until = months ? addMonthsLocal(base, months) : null;
  const lifted = extending && grant && grant.plan !== plan;
  const summary =
    plan === "free"
      ? `Removes the ${PLAN_BY_ID[grant?.plan ?? "pro"].name} grant; the account goes back to Free right away.`
      : extending
        ? `${lifted ? `Lifts the grant to ${PLAN_BY_ID[plan].name} and adds` : "Adds"} ${plural(months!, "month")}: ${PLAN_BY_ID[plan].name} until ${fmtDate(until!.toISOString())}.`
        : `${running ? "Replaces the current grant: " : ""}${PLAN_BY_ID[plan].name} ${months ? `for ${plural(months, "month")} from today, until ${fmtDate(until!.toISOString())}` : "with no end date"}. No payment involved.`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Change plan" description={`${u.profile.name} · ${u.profile.email}`} width={460}>
        <div className="space-y-4">
          {grant && (
            <Note>
              {expired ? "Had" : "Currently"} <span className="font-medium text-ink">{PLAN_BY_ID[grant.plan].name}</span> {grant.expires_at ? `until ${fmtDate(grant.expires_at)}${expired ? " (expired)" : ""}` : "with no end date"}
              {u.granted_by ? `, granted by ${u.granted_by.name}` : grant.source === "code" ? ", from a code" : ""}
              {grant.note ? ` — “${grant.note}”` : ""}
            </Note>
          )}
          <div role="radiogroup" aria-label="Plan" className={cn("grid gap-2", grant ? "grid-cols-3" : "grid-cols-2")}>
            {PLANS.filter((p) => p.id !== "free" || grant).map((p) => {
              const on = plan === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  data-plan={p.id}
                  onClick={() => setPlan(p.id)}
                  className={cn("press flex flex-col items-start rounded-lg px-3 py-2.5 text-left outline-none ring-blue focus-visible:ring-2", on ? "bg-ink text-white" : "bg-panel text-ink hairline hover:bg-hover")}
                >
                  <span className="flex w-full items-center justify-between text-[13px] font-semibold">
                    {p.name}
                    {on && <Check size={13} />}
                  </span>
                  <span className={cn("mt-0.5 text-[11px] leading-snug", on ? "text-white/70" : "text-ink-3")}>{p.id === "free" ? "Remove the grant" : p.id === "pro" ? "Unlimited pages, 5 people" : "Unlimited everything"}</span>
                </button>
              );
            })}
          </div>
          {plan !== "free" && (
            <div className={cn("grid gap-3", canExtend && "sm:grid-cols-2")}>
              {canExtend && (
                <Field label="How">
                  <Select value={mode} onChange={(e) => setMode(e.target.value as "extend" | "replace")} aria-label="How">
                    <option value="extend">Extend the current grant</option>
                    <option value="replace">Replace it, starting today</option>
                  </Select>
                </Field>
              )}
              <Field label={extending ? "Add" : "Duration"}>
                <Select value={duration} onChange={(e) => setDuration(e.target.value)} aria-label="Duration">
                  {DURATIONS.filter((d) => !extending || d.value !== "forever").map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
          <Field label="Note" hint="Why — it goes in the audit log and on the account.">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={plan === "free" ? "e.g. trial over" : "e.g. beta tester, conference giveaway"} maxLength={200} aria-label="Note" />
          </Field>
          <Note>{summary}</Note>
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button variant={plan === "free" ? "danger" : "primary"} onClick={save} disabled={busy}>
              {busy ? "Saving…" : plan === "free" ? "Remove grant" : extending ? `Extend ${PLAN_BY_ID[plan].name}` : `Grant ${PLAN_BY_ID[plan].name}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
