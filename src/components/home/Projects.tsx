"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, FolderKanban, Plus, Users } from "lucide-react";
import { api, type ProjectSummary } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/types";
import { cn, timeAgo } from "@/lib/util";
import { Logo } from "@/components/Logo";
import { Button, Input } from "@/components/ui/primitives";
import { AccountMenu, useMe } from "./AccountMenu";

export function Projects() {
  const router = useRouter();
  const me = useMe();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listProjects()
      .then(({ projects }) => setProjects(projects))
      .catch((e) => setError((e as Error).message));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setCreating(true);
    setError(null);
    try {
      const { project } = await api.createProject(n);
      router.push(`/p/${project.id}`);
    } catch (err) {
      setError((err as Error).message);
      setCreating(false);
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

        <section className="mt-16">
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">
            {me ? `Hi ${me.name.split(" ")[0]} —` : "Your"} projects
          </h1>
          <p className="mt-2 max-w-[520px] text-[14px] leading-relaxed text-ink-2">
            A project holds the pages you review together. Invite people to a project and give them view, edit or admin access.
          </p>

          <form onSubmit={create} className="mt-6 flex max-w-[480px] items-center gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New project name — e.g. Gem House redesign"
              maxLength={80}
              className="h-10 text-[14px]"
              aria-label="New project name"
            />
            <Button type="submit" variant="primary" disabled={creating || !name.trim()} className="h-10 shrink-0">
              <Plus size={14} /> Create
            </Button>
          </form>
          {error && <p className="mt-3 text-[13px] text-red-ink">{error}</p>}
        </section>

        <section className="mt-10">
          {projects === null ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-[84px] animate-pulse rounded-xl bg-hover" />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-xl bg-panel p-8 text-center hairline">
              <FolderKanban size={22} className="mx-auto text-ink-3" />
              <p className="mt-3 text-[13.5px] text-ink-2">No projects yet. Create one above, or ask a teammate to invite you.</p>
            </div>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/p/${p.id}`}
                    className={cn("group flex h-full flex-col gap-2 rounded-xl bg-panel px-4 py-3.5 hairline transition-colors hover:bg-hover")}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-semibold text-ink">{p.name}</span>
                      <span className="ml-auto rounded-full bg-paper px-2 py-0.5 text-[10.5px] font-medium text-ink-3 hairline">{ROLE_LABEL[p.role]}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[12px] text-ink-3">
                      <span>
                        {p.review_count} review{p.review_count === 1 ? "" : "s"}
                      </span>
                      <span>· updated {timeAgo(p.updated_at)}</span>
                      <ArrowRight size={13} className="ml-auto opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="mt-auto flex items-center gap-2 pt-16 text-[12px] text-ink-3">
          <Users size={12} /> Everything in Redline is shared per project. Only members can open its reviews.
        </footer>
      </div>
    </main>
  );
}
