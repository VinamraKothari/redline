"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronLeft, FileCode2, Folder as FolderIcon, FolderPlus, Monitor, Pencil, Smartphone, Tablet, Users } from "lucide-react";
import { api } from "@/lib/api";
import { FOLDER_NAME_MAX } from "@/lib/folders";
import type { PublicReview } from "@/lib/review";
import { VIEWPORTS, type Folder, type OpenThreadCount, type Project, type ProjectInvite, type ProjectMember, type Role } from "@/lib/types";
import { cn, normalizeUrl } from "@/lib/util";
import { Logo } from "@/components/Logo";
import { Button, IconButton, Input, Tip, TooltipProvider } from "@/components/ui/primitives";
import { AccountMenu, useMe } from "./AccountMenu";
import { hasReviewDrag, useReviewDropTarget } from "./dnd";
import { FolderTile } from "./FolderTile";
import { MembersDialog } from "./MembersDialog";
import { PageTile } from "./PageTile";
import { sumOpenThreads } from "./ThreadBadges";

interface Loaded {
  project: Project & { role: Role };
  reviews: PublicReview[];
  folders: Folder[];
  counts: Record<string, OpenThreadCount>;
  members: ProjectMember[];
  invites: ProjectInvite[];
}

/**
 * The project page. At the root it lists the project's folders first, then
 * the pages that are in no folder; with `folderId` it shows that folder's
 * pages only (route /p/[id]/f/[fid]). Pages are created where you stand.
 */
export function ProjectHome({ id, folderId }: { id: string; folderId?: string }) {
  const router = useRouter();
  const me = useMe();
  const [data, setData] = useState<Loaded | null>(null);
  const [url, setUrl] = useState("");
  const [viewport, setViewport] = useState(1440);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileDrag, setFileDrag] = useState(false);
  const [pageDrag, setPageDrag] = useState(false);
  const [members, setMembers] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Every load and every local change bumps this; a load that started before
  // a later change is stale when it lands (it would snap a just-moved page back).
  const version = useRef(0);

  const reload = useCallback(() => {
    const mine = ++version.current;
    api
      .loadProject(id)
      .then((d) => {
        if (mine !== version.current) return;
        setData(d);
        setName(d.project.name);
      })
      .catch((e) => setError((e as Error).message));
  }, [id]);
  useEffect(reload, [reload]);

  const role = data?.project.role ?? "view";
  const canEdit = role !== "view";
  const admin = role === "admin";
  const folder = folderId ? data?.folders.find((f) => f.id === folderId) : undefined;

  // the folder was deleted while this page was open: its pages are at the root now
  useEffect(() => {
    if (data && folderId && !folder) router.replace(`/p/${id}`);
  }, [data, folderId, folder, id, router]);

  const { shown, folderSizes, folderCounts, rootSize } = useMemo(() => {
    const reviews = data?.reviews ?? [];
    const sizes: Record<string, number> = {};
    const perFolder: Record<string, PublicReview[]> = {};
    for (const r of reviews) {
      if (!r.folder_id) continue;
      sizes[r.folder_id] = (sizes[r.folder_id] ?? 0) + 1;
      (perFolder[r.folder_id] ??= []).push(r);
    }
    const counts: Record<string, OpenThreadCount> = {};
    for (const f of data?.folders ?? []) counts[f.id] = sumOpenThreads((perFolder[f.id] ?? []).map((r) => data?.counts[r.id]));
    const root = reviews.filter((r) => !r.folder_id);
    return { shown: folderId ? (perFolder[folderId] ?? []) : root, folderSizes: sizes, folderCounts: counts, rootSize: root.length };
  }, [data, folderId]);

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
      const { review } = await api.createReview({ project_id: id, folder_id: folderId, url: n, viewport });
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
      const { review } = await api.createReview({ project_id: id, folder_id: folderId, mode: "upload", html, title: file.name.replace(/\.html?$/i, ""), viewport });
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
      if (folder) await api.renameFolder(id, folder.id, n);
      else await api.renameProject(id, n);
      // the tab title was set by the server page; keep it in step
      document.title = folder ? `${n} · ${data.project.name} — Redline` : `${n} — Redline`;
      setRenaming(false);
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function createFolder(e: React.FormEvent) {
    e.preventDefault();
    const n = (newFolder ?? "").trim();
    if (!n) {
      setNewFolder(null);
      return;
    }
    try {
      const { folder: f } = await api.createFolder(id, n);
      setNewFolder(null);
      // show it at once; the reload confirms
      setData((d) => (d ? { ...d, folders: [...d.folders, f] } : d));
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  /** Put a page in a folder (null = root): optimistic, then the server's word; on failure the reload reverts it. */
  async function movePage(reviewId: string, target: string | null) {
    // the dragged tile may unmount right here (it leaves this view), so its dragend never bubbles up: end the drag state ourselves
    setPageDrag(false);
    const r = data?.reviews.find((x) => x.id === reviewId);
    if (!r || (r.folder_id ?? null) === target) return;
    setError(null);
    version.current++;
    setData((d) => (d ? { ...d, reviews: d.reviews.map((x) => (x.id === reviewId ? { ...x, folder_id: target } : x)) } : d));
    try {
      await api.moveToFolder(reviewId, target);
    } catch (err) {
      setError((err as Error).message);
    }
    reload();
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

  const title = folder ? folder.name : data?.project.name;
  const canRename = folder ? canEdit : admin;

  return (
    <TooltipProvider>
      <main
        className="relative h-full overflow-y-auto overflow-x-hidden"
        onDragStart={(e) => setPageDrag(hasReviewDrag(e.dataTransfer))}
        onDragEnd={() => setPageDrag(false)}
        onDragOver={(e) => {
          // a page tile on its way to a folder is not a file drop
          if (!canEdit || hasReviewDrag(e.dataTransfer)) return;
          e.preventDefault();
          setFileDrag(true);
        }}
        onDragLeave={() => setFileDrag(false)}
        onDrop={(e) => {
          if (!canEdit || hasReviewDrag(e.dataTransfer)) return;
          e.preventDefault();
          setFileDrag(false);
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

          <nav aria-label="Breadcrumb" className="mt-10 flex min-w-0 items-center gap-1 text-[12.5px] text-ink-3">
            <Link href="/" className="inline-flex shrink-0 items-center gap-1 hover:text-ink">
              <ChevronLeft size={13} /> Projects
            </Link>
            {folderId && (
              <>
                <span aria-hidden>/</span>
                <ProjectCrumb id={id} name={data?.project.name ?? "…"} canDrop={canEdit} dragging={pageDrag} onDropPage={(rid) => movePage(rid, null)} />
                <span aria-hidden>/</span>
                <span className="truncate text-ink" aria-current="page">
                  {folder?.name ?? "…"}
                </span>
              </>
            )}
          </nav>

          <section className="mt-2">
            <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
              {/* title and pencil stay together; a long name wraps beside the pencil, aligned to its first line */}
              <div className="flex min-w-0 flex-1 items-start gap-3">
                {renaming ? (
                  <form onSubmit={rename} className="flex min-w-0 items-center gap-2">
                    <input
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
                      maxLength={folder ? FOLDER_NAME_MAX : 80}
                      aria-label={folder ? "Folder name" : "Project name"}
                      className="h-10 min-w-0 rounded-md bg-panel px-3 text-[24px] font-semibold tracking-[-0.02em] text-ink hairline outline-none"
                    />
                    <Button type="submit" variant="primary" size="sm">
                      Save
                    </Button>
                  </form>
                ) : (
                  <h1 className="flex min-w-0 items-start gap-2.5 break-words text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">
                    {folder && <FolderIcon size={22} className="mt-1.5 shrink-0 text-ink-3" strokeWidth={1.75} />}
                    <span className="min-w-0">{title ?? "…"}</span>
                  </h1>
                )}
                {canRename && !renaming && (
                  <Tip label={folder ? "Rename folder" : "Rename project"} side="bottom">
                    <IconButton
                      size="sm"
                      className="mt-1"
                      onClick={() => {
                        setName(title ?? "");
                        setRenaming(true);
                      }}
                      aria-label={folder ? "Rename folder" : "Rename project"}
                    >
                      <Pencil size={13} />
                    </IconButton>
                  </Tip>
                )}
              </div>
              {/* on a phone the members pill goes under the title instead of squeezing it into a column of words */}
              <span aria-hidden className="basis-full sm:hidden" />
              {data && (
                <button
                  type="button"
                  onClick={() => setMembers(true)}
                  className="flex shrink-0 items-center gap-2 rounded-lg bg-panel px-2.5 py-1.5 text-[12.5px] text-ink hairline hover:bg-hover sm:mt-0.5"
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
              {!data
                ? ""
                : folder
                  ? `A folder in ${data.project.name} · ${shown.length} page${shown.length === 1 ? "" : "s"} · every member of the project sees it`
                  : `You are ${role === "admin" ? "an admin — you can manage members and pages" : role === "edit" ? "an editor — you can comment, draw and add pages" : "a viewer — you can read and present"} · every member sees all pages in this project`}
            </p>

            {canEdit && (
              <form onSubmit={start} className="mt-7">
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-xl bg-panel p-1.5 shadow-pop transition-shadow",
                    "focus-within:shadow-[0_0_0_2px_var(--blue),var(--shadow-pop)]",
                    fileDrag && "shadow-[0_0_0_2px_var(--red),var(--shadow-pop)]",
                  )}
                >
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={folder ? "Add a page to this folder — paste a URL, e.g. staging.yoursite.com/pricing" : "Add a page — paste a URL, e.g. staging.yoursite.com/pricing"}
                    spellCheck={false}
                    className="h-11 min-w-0 flex-1 bg-transparent px-3 text-[15px] text-ink placeholder:text-ink-3 outline-none"
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
                    className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-ink px-4 text-[13px] font-medium text-white transition-colors hover:bg-black disabled:opacity-60"
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
            <div className="mb-3 flex min-h-[28px] items-center justify-between gap-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                {/* on a phone only the counts fit beside the New-folder button */}
                <span className="max-sm:hidden">{sectionHeading(data, folder ? shown.length : null)}</span>
                <span className="sm:hidden">{sectionHeading(data, folder ? shown.length : null, true)}</span>
              </h2>
              {canEdit &&
                !folderId &&
                data &&
                (newFolder === null ? (
                  <Button size="sm" onClick={() => setNewFolder("")}>
                    <FolderPlus size={13} /> New folder
                  </Button>
                ) : (
                  <form onSubmit={createFolder} className="flex items-center gap-1.5">
                    <Input
                      autoFocus
                      value={newFolder}
                      onChange={(e) => setNewFolder(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && setNewFolder(null)}
                      onBlur={() => !newFolder.trim() && setNewFolder(null)}
                      placeholder="Folder name"
                      maxLength={FOLDER_NAME_MAX}
                      aria-label="New folder name"
                      className="h-7 w-[180px] text-[12.5px]"
                    />
                    <Button type="submit" variant="primary" size="sm" disabled={!newFolder.trim()}>
                      Create
                    </Button>
                  </form>
                ))}
            </div>
            {!data ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {[0, 1].map((i) => (
                  <div key={i} className="h-[58px] animate-pulse rounded-lg bg-hover" />
                ))}
              </div>
            ) : folderId && shown.length === 0 ? (
              <p className="rounded-lg bg-panel px-4 py-6 text-center text-[13px] text-ink-3 hairline">
                {canEdit ? "This folder is empty — add a page above or drag pages here from the project." : "This folder is empty."}
              </p>
            ) : !folderId && data.folders.length === 0 && shown.length === 0 ? (
              <p className="rounded-lg bg-panel px-4 py-6 text-center text-[13px] text-ink-3 hairline">
                {canEdit ? "No pages yet — paste a URL above to add the first one. A project can hold as many pages as you like." : "No pages in this project yet."}
              </p>
            ) : (
              <ul data-testid="tile-grid" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {!folderId &&
                  data.folders.map((f) => (
                    <FolderTile
                      key={f.id}
                      folder={f}
                      pages={data.reviews.filter((r) => r.folder_id === f.id)}
                      counts={folderCounts[f.id]}
                      canEdit={canEdit}
                      onChanged={reload}
                      onError={setError}
                      onDropPage={movePage}
                    />
                  ))}
                {shown.map((r) => (
                  <PageTile
                    key={r.id}
                    r={r}
                    counts={data.counts[r.id]}
                    folders={data.folders}
                    folderSizes={folderSizes}
                    rootSize={rootSize}
                    canEdit={canEdit}
                    canDelete={admin || r.created_by_id === me?.id}
                    onChanged={reload}
                    onError={setError}
                  />
                ))}
              </ul>
            )}
          </section>

          {admin && !folderId && (
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

/** "Pages in this project · 6 pages · 3 folders" — the grid mixes both kinds at the root, so both are counted; `short` drops the prefix. */
function sectionHeading(data: Loaded | null, inFolder: number | null, short = false): string {
  const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const prefix = (text: string) => (short ? "" : `${text} · `);
  if (inFolder !== null) return `${prefix("Pages in this folder")}${short ? n(inFolder, "page") : inFolder}`;
  if (!data) return short ? "Pages" : "Pages in this project";
  if (!data.folders.length) return `${prefix("Pages in this project")}${short ? n(data.reviews.length, "page") : data.reviews.length}`;
  return `${prefix("Pages in this project")}${n(data.reviews.length, "page")} · ${n(data.folders.length, "folder")}`;
}

/**
 * The project's name in the breadcrumb of a folder page. While a page tile is
 * being dragged it doubles as the way back to the root: drop it here.
 */
function ProjectCrumb({ id, name, canDrop, dragging, onDropPage }: { id: string; name: string; canDrop: boolean; dragging: boolean; onDropPage: (reviewId: string) => void }) {
  const { over, props } = useReviewDropTarget(onDropPage, canDrop);
  return (
    <Link
      href={`/p/${id}`}
      {...props}
      data-testid="project-crumb"
      data-drop-over={over || undefined}
      title={dragging ? "Drop here to move the page back to the project" : undefined}
      className={cn(
        "min-w-0 truncate rounded-md px-1.5 py-0.5 transition-[box-shadow,background-color,color] hover:text-ink",
        dragging && "bg-blue-soft text-blue",
        over && "shadow-[0_0_0_2px_var(--blue)]",
      )}
    >
      {name}
    </Link>
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
