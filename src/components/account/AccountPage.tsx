"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, RotateCcw } from "lucide-react";
import { api, type BillingStatus, type ProjectSummary } from "@/lib/api";
import { Logo } from "@/components/Logo";
import { AccountMenu, useMe } from "@/components/home/AccountMenu";
import { Button } from "@/components/ui/primitives";
import { UsageGrid } from "@/components/billing/UsageGrid";
import { DeleteAccountDialog } from "./DeleteAccountDialog";
import { PlanCard } from "./PlanCard";
import { ProfileCard } from "./ProfileCard";
import { ProjectsList } from "./ProjectsList";

/**
 * /account — one place for everything about you rather than your reviews:
 * profile, plan, usage, the projects you belong to, and the way out. Each
 * section explains itself on the left and acts on the right; on a phone the
 * explanation sits above the card.
 */
export function AccountPage() {
  const me = useMe();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  // an error card replaces the section until a retry succeeds; the card's own click clears it
  const loadProjects = useCallback(() => {
    api
      .listProjects()
      .then(({ projects }) => {
        setProjects(projects);
        setProjectsError(null);
      })
      .catch((e) => setProjectsError((e as Error).message));
  }, []);
  const loadStatus = useCallback(() => {
    api.billing
      .status()
      .then((s) => {
        setStatus(s);
        setStatusError(null);
      })
      .catch((e) => setStatusError((e as Error).message));
  }, []);

  useEffect(() => {
    loadStatus();
    loadProjects();
  }, [loadStatus, loadProjects]);

  // the delete dialog warns about a subscription whenever Stripe has one, whatever the plan's source
  const paying = Boolean(status?.subscription?.paying);

  return (
    <main className="relative h-full overflow-y-auto overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0 canvas-grid opacity-60" />
      <div className="relative mx-auto flex min-h-full max-w-[880px] flex-col px-6 pb-10 pt-8">
        <header className="flex items-center justify-between">
          <Logo />
          <AccountMenu />
        </header>

        <section className="mt-12">
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">Your account</h1>
          <p className="mt-2 max-w-[520px] text-[14px] leading-relaxed text-ink-2">
            Your name and colour, your plan, and the projects you&apos;re part of. Preferences for reviewing live under Settings in the account menu.
          </p>
        </section>

        <div className="mt-8 divide-y divide-line">
          <Section id="profile" title="Profile" lead="Your picture and e-mail come from Google. The name and colour are how you appear on every review.">
            {me ? <ProfileCard me={me} /> : <div className="h-[180px] animate-pulse rounded-xl bg-hover" />}
          </Section>

          <Section
            id="plan"
            title="Plan"
            lead="What your account is on and why. Your plan covers every project you own; the people you invite use it for free."
            aside={
              <Link href="/account/billing" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-ink-2 hover:text-ink">
                Plan &amp; billing <ArrowRight size={12} />
              </Link>
            }
          >
            {statusError ? <Retry error={statusError} onRetry={loadStatus} /> : <PlanCard status={status} onStatus={setStatus} />}
          </Section>

          <Section id="usage" title="Usage" lead="Where you stand against the limits of your plan this month.">
            {statusError ? <Retry error={statusError} onRetry={loadStatus} /> : status ? <UsageGrid status={status} className="rounded-xl bg-panel p-5 hairline" /> : <div className="h-[120px] animate-pulse rounded-xl bg-hover" />}
          </Section>

          <Section id="projects" title="Your projects" lead="The projects you own and the ones you were invited to. Leave a project here; delete the ones you own from their own page.">
            {projectsError ? <Retry error={projectsError} onRetry={loadProjects} /> : <ProjectsList projects={projects} myId={me?.id ?? ""} onChanged={loadProjects} />}
          </Section>

          <Section id="danger" title="Danger zone" lead="Leaving for good. Export anything you want to keep first — Jira CSV and PNG exports are in each review's share dialog.">
            {me ? <DeleteAccountDialog projects={projects} myId={me.id} paying={paying} /> : <div className="h-[88px] animate-pulse rounded-xl bg-hover" />}
          </Section>
        </div>

        <footer className="mt-auto pt-12 text-[12px] text-ink-3">Signed in with Google. Redline stores your name, e-mail and picture to show who said what, plus your plan and preferences.</footer>
      </div>
    </main>
  );
}

/** A section whose data didn't arrive: say so where it would have been, and offer another go. */
function Retry({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-panel p-4 hairline">
      <p className="text-[13px] text-ink-2">
        <AlertTriangle size={13} className="mr-1.5 inline text-red" />
        Couldn&apos;t load this: {error}
      </p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        <RotateCcw size={12} /> Try again
      </Button>
    </div>
  );
}

function Section({ id, title, lead, aside, children }: { id: string; title: string; lead: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="grid gap-4 py-8 first:pt-0 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-8">
      <div className="sm:pt-1">
        <h2 id={`${id}-title`} className="text-[14px] font-semibold text-ink">
          {title}
        </h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{lead}</p>
        {aside && <div className="mt-2">{aside}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
