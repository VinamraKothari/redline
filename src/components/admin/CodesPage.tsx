"use client";

import { useState } from "react";
import { Check, Copy, Plus } from "lucide-react";
import { api } from "@/lib/api";
import type { NewPromo, Promo } from "@/lib/admin/stripe-promos";
import { formatPrice, PLAN_BY_ID, type PlanId } from "@/lib/billing/plans";
import type { GrantCode } from "@/lib/types";
import { cn } from "@/lib/util";
import { Button, Dialog, DialogClose, DialogContent, IconButton, Input, Tip, TooltipProvider } from "@/components/ui/primitives";
import { EmptyRow, ErrorNote, Field, fmtDate, Note, PageHeader, PlanName, plural, Select, Skeleton, Switch, Table, Td, Th, useAdminData } from "./ui";

/**
 * /admin/codes — two kinds of code, kept apart on purpose:
 *  - redeemable codes give a plan away for a number of months, no card (ours);
 *  - Stripe coupons discount a paid subscription at checkout (Stripe's).
 */
export function CodesPage() {
  const codes = useAdminData(() => api.admin.codes());
  const promos = useAdminData(() => api.admin.promos());
  const [newCode, setNewCode] = useState(false);
  const [newPromo, setNewPromo] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  // "expired" is judged against the moment the page opened, which is as fresh as a list needs to be
  const [now] = useState(() => Date.now());

  async function toggleCode(c: GrantCode, active: boolean) {
    setRowError(null);
    try {
      const { code } = await api.admin.setCodeActive(c.code, active);
      codes.setData((d) => (d ? { codes: d.codes.map((x) => (x.code === code.code ? code : x)) } : d));
    } catch (e) {
      setRowError((e as Error).message);
    }
  }
  async function togglePromo(p: Promo, active: boolean) {
    setRowError(null);
    try {
      const { promo } = await api.admin.setPromoActive(p.id, active);
      promos.setData((d) => (d ? { ...d, promos: d.promos.map((x) => (x.id === promo.id ? promo : x)) } : d));
    } catch (e) {
      setRowError((e as Error).message);
    }
  }

  return (
    <TooltipProvider>
      <div className="space-y-10">
        <div className="space-y-5">
          <PageHeader
            title="Codes"
            description="A redeemable code puts an account on Pro or Team for a number of months without a card — hand one to a beta tester, a speaker, a friend. People enter it on their account page."
            actions={
              <Button variant="primary" onClick={() => setNewCode(true)}>
                <Plus size={14} /> New code
              </Button>
            }
          />
          {codes.error && <ErrorNote>{codes.error}</ErrorNote>}
          {rowError && <ErrorNote>{rowError}</ErrorNote>}
          <Table minWidth={760}>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Grants</Th>
                <Th align="right">Uses</Th>
                <Th>Valid until</Th>
                <Th>Note</Th>
                <Th>Created</Th>
                <Th>Active</Th>
              </tr>
            </thead>
            <tbody>
              {codes.loading && !codes.data ? (
                [0, 1].map((i) => (
                  <tr key={i}>
                    <Td colSpan={7}>
                      <Skeleton className="h-7" />
                    </Td>
                  </tr>
                ))
              ) : !codes.data?.codes.length ? (
                <EmptyRow colSpan={7}>No codes yet. Create one and send it on.</EmptyRow>
              ) : (
                codes.data.codes.map((c) => {
                  const spent = c.uses >= c.max_uses;
                  const expired = Boolean(c.expires_at && Date.parse(c.expires_at) < now);
                  const dim = !c.active || spent || expired;
                  return (
                    <tr key={c.code} data-testid="code-row" className={cn(dim && "text-ink-3")}>
                      <Td className="whitespace-nowrap">
                        <CodeCell code={c.code} dim={dim} />
                      </Td>
                      <Td className="whitespace-nowrap">
                        <PlanName plan={c.plan} className={dim ? "text-ink-3" : undefined} /> <span className="text-ink-2">· {plural(c.months, "month")}</span>
                      </Td>
                      <Td align="right" className={cn("whitespace-nowrap", spent && "text-red-ink")}>
                        {c.uses} / {c.max_uses}
                      </Td>
                      <Td className={cn("whitespace-nowrap", expired ? "text-red-ink" : "text-ink-2")}>{c.expires_at ? fmtDate(c.expires_at) : "—"}</Td>
                      <Td className="max-w-[240px] truncate text-ink-2">{c.note || "—"}</Td>
                      <Td className="whitespace-nowrap text-ink-2">{fmtDate(c.created_at)}</Td>
                      <Td>
                        <Switch checked={c.active} onChange={(v) => toggleCode(c, v)} label={`${c.code} active`} />
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </Table>
        </div>

        <div className="space-y-5">
          <PageHeader
            eyebrow="Stripe"
            title="Coupons"
            description="A coupon discounts a paid subscription — a percentage or an amount, once or for a stretch of months. The code is typed into Stripe Checkout; the customer still pays."
            actions={
              promos.data?.available ? (
                <Button variant="primary" onClick={() => setNewPromo(true)}>
                  <Plus size={14} /> New coupon
                </Button>
              ) : null
            }
          />
          {promos.error && <ErrorNote>{promos.error}</ErrorNote>}
          {promos.data && !promos.data.available ? (
            <Note>{promos.data.note}</Note>
          ) : (
            <Table minWidth={760}>
              <thead>
                <tr>
                  <Th>Code</Th>
                  <Th>Coupon</Th>
                  <Th>Discount</Th>
                  <Th>Lasts</Th>
                  <Th align="right">Redeemed</Th>
                  <Th>Valid until</Th>
                  <Th>Active</Th>
                </tr>
              </thead>
              <tbody>
                {promos.loading && !promos.data ? (
                  [0, 1].map((i) => (
                    <tr key={i}>
                      <Td colSpan={7}>
                        <Skeleton className="h-7" />
                      </Td>
                    </tr>
                  ))
                ) : !promos.data?.promos.length ? (
                  <EmptyRow colSpan={7}>No coupons in this Stripe account yet.</EmptyRow>
                ) : (
                  promos.data.promos.map((p) => (
                    <tr key={p.id} className={cn(!p.active && "text-ink-3")}>
                      <Td className="whitespace-nowrap">
                        <CodeCell code={p.code} dim={!p.active} />
                      </Td>
                      <Td className="max-w-[200px] truncate text-ink-2">{p.coupon.name || p.coupon.id}</Td>
                      <Td className="whitespace-nowrap font-medium">{p.coupon.percent_off ? `${p.coupon.percent_off}% off` : p.coupon.amount_off ? `${formatPrice(p.coupon.amount_off, (p.coupon.currency || "eur").toUpperCase())} off` : "—"}</Td>
                      <Td className="whitespace-nowrap text-ink-2">{p.coupon.duration === "forever" ? "Forever" : p.coupon.duration === "repeating" ? plural(p.coupon.duration_in_months ?? 0, "month") : "First payment"}</Td>
                      <Td align="right">{p.max_redemptions ? `${p.times_redeemed} / ${p.max_redemptions}` : p.times_redeemed}</Td>
                      <Td className="whitespace-nowrap text-ink-2">{p.expires_at ? fmtDate(p.expires_at) : "—"}</Td>
                      <Td>
                        <Switch checked={p.active} onChange={(v) => togglePromo(p, v)} label={`${p.code} active`} />
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          )}
        </div>

        <NewCodeDialog open={newCode} onOpenChange={setNewCode} onCreated={(c) => codes.setData((d) => ({ codes: [c, ...(d?.codes ?? [])] }))} />
        <NewPromoDialog open={newPromo} onOpenChange={setNewPromo} onCreated={(p) => promos.setData((d) => (d ? { ...d, promos: [p, ...d.promos] } : d))} />
      </div>
    </TooltipProvider>
  );
}

/** The code in mono with a copy button; the whole string selects on click so it can be read out or dragged. */
function CodeCell({ code, dim }: { code: string; dim?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — the text is still selectable */
    }
  }
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("mono select-all text-[12px] font-medium", dim ? "text-ink-3" : "text-ink")}>{code}</span>
      <Tip label={copied ? "Copied" : "Copy"} side="top">
        <IconButton size="sm" onClick={copy} aria-label={`Copy ${code}`} className="h-6 w-6 text-ink-3">
          {copied ? <Check size={12} className="text-green" /> : <Copy size={12} />}
        </IconButton>
      </Tip>
    </span>
  );
}

function NewCodeDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (c: GrantCode) => void }) {
  const [code, setCode] = useState("");
  const [plan, setPlan] = useState<Exclude<PlanId, "free">>("pro");
  const [months, setMonths] = useState("3");
  const [maxUses, setMaxUses] = useState("1");
  const [expires, setExpires] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.admin.createCode({ code: code.trim() || undefined, plan, months: Number(months), max_uses: Number(maxUses), expires_at: expires ? new Date(expires + "T23:59:59").toISOString() : null, note: note.trim() });
      onCreated(created.code);
      onOpenChange(false);
      setCode("");
      setNote("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="New code" description="Anyone signed in can redeem it on their account page." width={460}>
        <form onSubmit={create} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Plan">
              <Select value={plan} onChange={(e) => setPlan(e.target.value as Exclude<PlanId, "free">)} aria-label="Plan">
                <option value="pro">{PLAN_BY_ID.pro.name}</option>
                <option value="team">{PLAN_BY_ID.team.name}</option>
              </Select>
            </Field>
            <Field label="Months">
              <Input type="number" min={1} max={120} value={months} onChange={(e) => setMonths(e.target.value)} required aria-label="Months" />
            </Field>
            <Field label="Max uses" hint="How many different people may redeem it.">
              <Input type="number" min={1} max={100000} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} required aria-label="Max uses" />
            </Field>
            <Field label="Valid until" hint="Optional. Redemptions stop after this day.">
              <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} aria-label="Valid until" />
            </Field>
          </div>
          <Field label="Code" hint={code ? `Will be saved as ${code}. At least six letters or digits; dashes are fine.` : "Leave blank for one like PRO-7K3M-QZ, or type your own (six or more letters or digits)."}>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))} placeholder="Generated when blank" maxLength={32} className="mono" aria-label="Code" />
          </Field>
          <Field label="Note" hint="Who it's for — shown here and on the accounts that redeem it.">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Config 2026 giveaway" maxLength={200} aria-label="Note" />
          </Field>
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Creating…" : "Create code"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewPromoDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (p: Promo) => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState("20");
  const [duration, setDuration] = useState<NewPromo["duration"]>("once");
  const [durationMonths, setDurationMonths] = useState("3");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { promo } = await api.admin.createPromo({
        name: name.trim(),
        code: code.trim(),
        percent_off: kind === "percent" ? Number(value) : null,
        amount_off: kind === "amount" ? Math.round(Number(value) * 100) : null,
        duration,
        duration_in_months: duration === "repeating" ? Number(durationMonths) : null,
        max_redemptions: maxRedemptions ? Number(maxRedemptions) : null,
        expires_at: expires ? new Date(expires + "T23:59:59").toISOString() : null,
      });
      onCreated(promo);
      onOpenChange(false);
      setName("");
      setCode("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="New Stripe coupon" description="Creates the coupon and the code customers type at checkout." width={480}>
        <form onSubmit={create} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" hint="Appears on the customer's invoice.">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Launch offer" maxLength={40} required aria-label="Coupon name" />
            </Field>
            <Field label="Code">
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))} placeholder="LAUNCH20" maxLength={32} required className="mono" aria-label="Promotion code" />
            </Field>
            <Field label="Discount">
              <div className="flex gap-1.5">
                <Input type="number" min={kind === "percent" ? 1 : 0.01} max={kind === "percent" ? 100 : undefined} step={kind === "percent" ? 1 : 0.01} value={value} onChange={(e) => setValue(e.target.value)} required aria-label="Discount value" />
                <Select value={kind} onChange={(e) => setKind(e.target.value as "percent" | "amount")} className="w-[72px] shrink-0" aria-label="Discount kind">
                  <option value="percent">%</option>
                  <option value="amount">€</option>
                </Select>
              </div>
            </Field>
            <Field label="Lasts">
              <div className="flex gap-1.5">
                <Select value={duration} onChange={(e) => setDuration(e.target.value as NewPromo["duration"])} aria-label="Duration">
                  <option value="once">First payment</option>
                  <option value="repeating">Some months</option>
                  <option value="forever">Forever</option>
                </Select>
                {duration === "repeating" && <Input type="number" min={1} max={36} value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)} className="w-[72px] shrink-0" required aria-label="Months" />}
              </div>
            </Field>
            <Field label="Max redemptions" hint="Optional.">
              <Input type="number" min={1} value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} placeholder="Unlimited" aria-label="Max redemptions" />
            </Field>
            <Field label="Valid until" hint="Optional.">
              <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} aria-label="Valid until" />
            </Field>
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Creating…" : "Create coupon"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
