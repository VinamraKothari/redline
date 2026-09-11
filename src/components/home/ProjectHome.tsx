"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronLeft, FileCode2, Monitor, Pencil, Smartphone, Tablet, Users } from "lucide-react";
import { api } from "@/lib/api";
import type { PublicReview } from "@/lib/review";
import { ROLE_LABEL, VIEWPORTS, type Project, type ProjectInvite, type ProjectMember, type Role } from "@/lib/types";
import { cn, normalizeUrl } from "@/lib/util";
import { Logo } from "@/components/Logo";
import { Button, IconButton, Tip, TooltipProvider } from "@/components/ui/primitives";
import { AccountMenu, useMe } from "./AccountMenu";
import { MembersDialog } from "./MembersDialog";
import { PageTile } from "./PageTile";

interface Loaded {
  project: Project & { role: Role };
  reviews: PublicReview[];
  members: ProjectMember[];
  invites: ProjectInvite[];
}

export function ProjectHome({ id }: { id: string }) {
  const router = useRouter();
  const me = useMe();
  const [data, setData] = useState<Loaded | null>(null);
  const [url, setUrl] = useState("");
  const [viewport, setViewport] = useState(1440);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [members, setMembers] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    api
      .loadProject(id)
      .then((d) => {
        setData(d);
        setName(d.project.name);
      })
      .catch((e) => setError((e as Error).message));
  }, [id]);
  useEffect(reload, [reload]);

  const role = data?.project.role ?? "view";
  const canEdit = role !== "view";
  const admin = role === "admin";

  async function start(e?: React.FormEvent) {
    e?.preventDefault();
    const n = normalizeUrl(url);
    if (!n) {
      setError("Enter a web address, like stripe.com or https://example.com/pricing");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { review } = await api.createReview({ project_id: id, url: n, viewport });
      router.push(`/r/${review.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function upload(file: File) {
    if (!/\.html?$/i.test(file.name) && file.type !== "text/html") {
      setError("Drop an .html file.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const html = await file.text();
      const { review } = await api.createReview({ project_id: id, mode: "upload", html, title: file.name.replace(/\.html?$/i, ""), viewport });
      router.push(`/r/${review.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n || !data) return;
    try {
      await api.renameProject(id, n);
      setRenaming(false);
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removeProject() {
    if (!data) return;
    if (!confirm(`Delete the project "${data.project.name}" with all ${data.reviews.length} page(s)? This can't be undone.`)) return;
    try {
      await api.deleteProject(id);
      router.push("/");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <TooltipProvider>
      <main
        className="relative h-full overflow-y-auto overflow-x-hidden"
        onDragOver={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) upload(f);
        }}
      >
        <div className="pointer-events-none absolute inset-0 canvas-grid opacity-60" />
        <div className="relative mx-auto flex min-h-full max-w-[880px] flex-col px-6 pb-10 pt-8">
          <header className="flex items-center justify-between">
            <Logo />
            <AccountMenu />
          </header>

          <nav className="mt-10 flex items-center gap-1 text-[12.5px] text-ink-3">
            <Link href="/" className="inline-flex items-center gap-1 hover:text-ink">
              <ChevronLeft size={13} /> Projects
            </Link>
          </nav>

          <section className="mt-2">
            <div className="flex items-center gap-3">
              {renaming ? (
                <form onSubmit={rename} className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
                    aria-label="Project name"
                    className="h-10 rounded-md bg-panel px-3 text-[24px] font-semibold tracking-[-0.02em] text-ink hairline outline-none"
                  />
                  <Button type="submit" variant="primary" size="sm">
                    Save
                  </Button>
                </form>
              ) : (
                <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">{data?.project.name ?? "…"}</h1>
              )}
              {admin && !renaming && (
                <Tip label="Rename project" side="bottom">
                  <IconButton size="sm" onClick={() => setRenaming(true)} aria-label="Rename project">
                    <Pencil size={13} />
                  </IconButton>
                </Tip>
              )}
              <div className="flex-1" />
              {data && (
                <button
                  type="button"
                  onClick={() => setMembers(true)}
                  className="flex items-center gap-2 rounded-lg bg-panel px-2.5 py-1.5 text-[12.5px] text-ink hairline hover:bg-hover"
                >
                  <div className="flex -space-x-1.5">
                    {data.members.slice(0, 4).map((m) => (
                      <span key={m.user_id} className="rounded-full ring-2 ring-panel">
                        <AvatarSmall m={m} />
                      </span>
                    ))}
                  </div>
                  <Users size={13} className="text-ink-2" />
                  {data.members.length} member{data.members.length === 1 ? "" : "s"}
                  {data.invites.length > 0 && <span className="text-ink-3">· {data.invites.length} invited</span>}
                </button>
              )}
            </div>
            <p className="mt-1.5 min-h-[18px] text-[12.5px] text-ink-3">
              {data
                ? `You are ${role === "admin" ? "an admin" : role === "edit" ? "an editor" : "a viewer"} · ${ROLE_LABEL[role]} · every member sees all pages in this project`
                : ""}
            </p>

            {canEdit && (
              <form onSubmit={start} className="mt-7">
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-xl bg-panel p-1.5 shadow-pop transition-shadow",
                    "focus-within:shadow-[0_0_0_2px_var(--blue),var(--shadow-pop)]",
                    dragging && "shadow-[0_0_0_2px_var(--red),var(--shadow-pop)]",
                  )}
                >
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="Add a page — paste a URL, e.g. staging.yoursite.com/pricing"
                    spellCheck={false}
                    className="h-11 flex-1 bg-transparent px-3 text-[15px] text-ink placeholder:text-ink-3 outline-none"
                  />
                  <div className="hidden items-center gap-0.5 rounded-lg bg-hover p-0.5 sm:flex">
                    {[
                      { w: 1440, Icon: Monitor, t: "Desktop 1440" },
                      { w: 1024, Icon: Tablet, t: "Tablet 1024" },
                      { w: 390, Icon: Smartphone, t: "Phone 390" },
                    ].map(({ w, Icon, t }) => (
                      <button
                        key={w}
                        type="button"
                        title={t}
                        onClick={() => setViewport(w)}
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                          viewport === w ? "bg-panel text-ink shadow-sm" : "text-ink-3 hover:text-ink",
                        )}
                      >
                        <Icon size={15} />
                      </button>
                    ))}
                  </div>
                  <button
                    type="submit"
                    disabled={busy}
                    className="flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-[13px] font-medium text-white transition-colors hover:bg-black disabled:opacity-60"
                  >
                    {busy ? "Opening…" : "Review"}
                    {!busy && <ArrowRight size={14} />}
                  </button>
                </div>
                <div className="mt-3 flex items-center gap-4 text-[12.5px] text-ink-3">
                  <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 hover:text-ink">
                    <FileCode2 size={13} /> or drop an .html file anywhere
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".html,.htm,text/html"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
                  />
                  <span className="hidden sm:inline">
                    Viewport: <span className="mono text-ink-2">{VIEWPORTS.find((v) => v.width === viewport)?.label.replace(" · ", " ")}</span>
                  </span>
                </div>
              </form>
            )}
            {error && <p className="mt-3 text-[13px] text-red-ink">{error}</p>}
          </section>

          <section className="mt-10">
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Pages in this project{data ? ` · ${data.reviews.length}` : ""}</h2>
            {!data ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {[0, 1].map((i) => (
                  <div key={i} className="h-[58px] animate-pulse rounded-lg bg-hover" />
                ))}
              </div>
            ) : data.reviews.length === 0 ? (
              <p className="rounded-lg bg-panel px-4 py-6 text-center text-[13px] text-ink-3 hairline">
                {canEdit ? "No pages yet — paste a URL above to add the first one. A project can hold as many pages as you like." : "No pages in this project yet."}
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.reviews.map((r) => (
                  <PageTile key={r.id} r={r} canEdit={canEdit} canDelete={admin || r.created_by_id === me?.id} onChanged={reload} onError={setError} />
                ))}
              </ul>
            )}
          </section>

          {admin && (
            <section className="mt-16 border-t border-line pt-6">
              <button type="button" onClick={removeProject} className="text-[12px] text-ink-3 hover:text-red">
                Delete this project…
              </button>
            </section>
          )}
        </div>

        {data && me && (
          <MembersDialog
            open={members}
            onOpenChange={setMembers}
            projectId={id}
            myId={me.id}
            myRole={role}
            members={data.members}
            invites={data.invites}
            onChange={reload}
          />
        )}
      </main>
    </TooltipProvider>
  );
}

function AvatarSmall({ m }: { m: ProjectMember }) {
  const p = m.profile;
  if (p?.avatar_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={p.avatar_url} alt={p.name} referrerPolicy="no-referrer" className="h-5 w-5 rounded-full object-cover" />;
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white" style={{ background: p?.color || "#999" }}>
      {(p?.name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}
