"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronLeft, FolderKanban, Plus } from "lucide-react";
import { api, type ProjectSummary } from "@/lib/api";
import { hostOf, normalizeUrl } from "@/lib/util";
import { Logo } from "@/components/Logo";
import { Button, Input } from "@/components/ui/primitives";
import { AccountMenu } from "./AccountMenu";
import { cn } from "@/lib/util";

const NEW = "__new__";

/** After signing in from the landing page: pick (or create) the project for the review, then go. */
export function Start({ url, viewport }: { url: string; viewport: number }) {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [choice, setChoice] = useState<string>(NEW);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = normalizeUrl(url);

  useEffect(() => {
    api
      .listProjects()
      .then(({ projects }) => {
        const editable = projects.filter((p) => p.role !== "view");
        setProjects(editable);
        if (editable[0]) setChoice(editable[0].id);
        else setName(target ? `${hostOf(target)} reviews` : "My reviews");
      })
      .catch((e) => setError((e as Error).message));
  }, [target]);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      let projectId = choice;
      if (choice === NEW) {
        const n = name.trim();
        if (!n) {
          setError("Give the project a name.");
          setBusy(false);
          return;
        }
        projectId = (await api.createProject(n)).project.id;
      }
      const { review } = await api.createReview({ project_id: projectId, url: target, viewport });
      router.push(`/r/${review.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="relative h-full overflow-y-auto overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0 canvas-grid opacity-60" />
      <div className="relative mx-auto flex min-h-full max-w-[880px] flex-col px-6 pb-10 pt-8">
        <header className="flex items-center justify-between">
          <Logo />
          <AccountMenu />
        </header>
        <nav className="mt-10 text-[12.5px] text-ink-3">
          <Link href="/" className="inline-flex items-center gap-1 hover:text-ink">
            <ChevronLeft size={13} /> Projects
          </Link>
        </nav>

        <section className="mt-2 max-w-[560px]">
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">Start the review</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
            {target ? (
              <>
                You&apos;re about to review <span className="mono text-ink">{target}</span> at {viewport}px. Pages live in a project — pick one to add this page to, or start a new one. Everyone in the
                project sees all of its pages.
              </>
            ) : (
              "That didn't look like a web address. Head back and paste one."
            )}
          </p>

          {target && (
            <form onSubmit={go} className="mt-6 flex flex-col gap-2">
              {projects === null ? (
                <div className="h-11 animate-pulse rounded-lg bg-hover" />
              ) : (
                <>
                  {projects.map((p) => (
                    <label
                      key={p.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-lg bg-panel px-3 py-2.5 hairline transition-colors hover:bg-hover",
                        choice === p.id && "shadow-[0_0_0_2px_var(--blue)]",
                      )}
                    >
                      <input type="radio" name="project" value={p.id} checked={choice === p.id} onChange={() => setChoice(p.id)} className="accent-[var(--blue)]" />
                      <FolderKanban size={15} className="text-ink-2" />
                      <span className="flex-1 truncate text-[13.5px] font-medium text-ink">{p.name}</span>
                      <span className="text-[11.5px] text-ink-3">
                        {p.review_count} page{p.review_count === 1 ? "" : "s"}
                      </span>
                    </label>
                  ))}
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg bg-panel px-3 py-2.5 hairline transition-colors hover:bg-hover",
                      choice === NEW && "shadow-[0_0_0_2px_var(--blue)]",
                    )}
                  >
                    <input type="radio" name="project" value={NEW} checked={choice === NEW} onChange={() => setChoice(NEW)} className="accent-[var(--blue)]" />
                    <Plus size={15} className="text-ink-2" />
                    <span className="text-[13.5px] font-medium text-ink">New project</span>
                    <Input
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setChoice(NEW);
                      }}
                      onFocus={() => setChoice(NEW)}
                      placeholder="Project name"
                      maxLength={80}
                      aria-label="New project name"
                      className="ml-auto h-8 max-w-[240px]"
                    />
                  </label>
                </>
              )}
              <div className="mt-3 flex items-center gap-3">
                <Button type="submit" variant="primary" disabled={busy || projects === null} className="h-10 px-4">
                  {busy ? "Opening…" : "Review"} {!busy && <ArrowRight size={14} />}
                </Button>
                {error && <span className="text-[13px] text-red-ink">{error}</span>}
              </div>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
