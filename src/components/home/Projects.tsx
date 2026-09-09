"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderKanban, LogOut, MoreHorizontal, Pencil, Plus, Trash2, Users } from "lucide-react";
import { api, type ProjectSummary } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/types";
import { cn, timeAgo } from "@/lib/util";
import { Logo } from "@/components/Logo";
import { Button, IconButton, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/primitives";
import { AccountMenu, useMe } from "./AccountMenu";

export function Projects() {
  const router = useRouter();
  const me = useMe();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api
      .listProjects()
      .then(({ projects }) => setProjects(projects))
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(reload, [reload]);

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
            A project holds all the pages you review together — add as many as you like. Invite people once and they see every page in it.
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
            <ul className="grid gap-3 sm:grid-cols-2">
              {projects.map((p) => (
                <ProjectCard key={p.id} p={p} myId={me?.id || ""} onChanged={reload} onError={setError} />
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

function ProjectCard({ p, myId, onChanged, onError }: { p: ProjectSummary; myId: string; onChanged: () => void; onError: (m: string) => void }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(p.name);
  const admin = p.role === "admin";

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    setRenaming(false);
    if (!n || n === p.name) return;
    try {
      await api.renameProject(p.id, n);
      onChanged();
    } catch (err) {
      onError((err as Error).message);
    }
  }
  async function remove() {
    if (!confirm(`Delete the project "${p.name}" with all ${p.review_count} page(s)? This can't be undone.`)) return;
    try {
      await api.deleteProject(p.id);
      onChanged();
    } catch (err) {
      onError((err as Error).message);
    }
  }
  async function leave() {
    if (!confirm(`Leave "${p.name}"? You'll need a new invitation to get back in.`)) return;
    try {
      await api.removeMember(p.id, myId);
      onChanged();
    } catch (err) {
      onError((err as Error).message);
    }
  }

  return (
    <li className="group relative flex flex-col overflow-hidden rounded-xl bg-panel hairline transition-shadow hover:shadow-pop">
      <Link href={`/p/${p.id}`} className="block">
        <div className="flex aspect-[16/7] w-full gap-1 overflow-hidden bg-hover p-1">
          {p.preview_urls.length ? (
            p.preview_urls.slice(0, 3).map((u, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={u} alt="" loading="lazy" className={cn("h-full min-w-0 flex-1 rounded-md object-cover object-top", i > 0 && "hidden sm:block")} />
            ))
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-ink-3">
              <FolderKanban size={18} />
              <span className="text-[11px]">{p.review_count ? "Previews appear once pages are opened" : "No pages yet"}</span>
            </div>
          )}
        </div>
      </Link>
      <div className="flex items-start gap-2 px-3.5 py-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form onSubmit={rename}>
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={rename}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setName(p.name);
                    setRenaming(false);
                  }
                }}
                maxLength={80}
                aria-label="Project name"
                className="h-7 text-[13.5px] font-semibold"
              />
            </form>
          ) : (
            <Link href={`/p/${p.id}`} className="block truncate text-[14px] font-semibold text-ink">
              {p.name}
            </Link>
          )}
          <div className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-3">
            <span>
              {p.review_count} page{p.review_count === 1 ? "" : "s"}
            </span>
            <span>· updated {timeAgo(p.updated_at)}</span>
            <span className="rounded-full bg-paper px-1.5 py-0.5 text-[10.5px] font-medium hairline">{ROLE_LABEL[p.role]}</span>
          </div>
        </div>
        <Menu>
          <MenuTrigger asChild>
            <IconButton size="sm" aria-label={`Options for ${p.name}`} className="opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100">
              <MoreHorizontal size={14} />
            </IconButton>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem onSelect={() => router.push(`/p/${p.id}`)}>
              <FolderKanban size={13} /> Open
            </MenuItem>
            {admin && (
              <MenuItem
                onSelect={() => {
                  setName(p.name);
                  setRenaming(true);
                }}
              >
                <Pencil size={13} /> Rename
              </MenuItem>
            )}
            <MenuSeparator />
            {admin ? (
              <MenuItem danger onSelect={remove}>
                <Trash2 size={13} /> Delete project
              </MenuItem>
            ) : (
              <MenuItem danger onSelect={leave}>
                <LogOut size={13} /> Leave project
              </MenuItem>
            )}
          </MenuContent>
        </Menu>
      </div>
    </li>
  );
}
