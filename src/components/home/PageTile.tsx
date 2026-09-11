"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, FolderInput, Globe, ImageDown, MoreHorizontal, Pencil, Snowflake, Trash2 } from "lucide-react";
import { Button, Dialog, DialogContent, IconButton, Input, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/primitives";
import { api, type ProjectSummary } from "@/lib/api";
import type { PublicReview } from "@/lib/review";
import { cn, hostOf, timeAgo } from "@/lib/util";

/**
 * A page of a project: preview image, title, meta, and — for people who may
 * change it — a menu with rename, move to another project and delete.
 */
export function PageTile({
  r,
  canEdit,
  canDelete,
  onChanged,
  onError,
}: {
  r: PublicReview;
  canEdit: boolean;
  canDelete: boolean;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [name, setName] = useState(r.title);
  const [refreshing, setRefreshing] = useState(false);

  async function refreshPreview() {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/reviews/${r.id}/thumbnail?force=1`, { method: "POST" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Couldn't refresh the preview.");
      onChanged();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    setRenaming(false);
    if (!n || n === r.title) return;
    try {
      await api.patchReview(r.id, { title: n });
      onChanged();
    } catch (err) {
      onError((err as Error).message);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${r.title}" and all its comments? This can't be undone.`)) return;
    try {
      await api.deleteReview(r.id);
      onChanged();
    } catch (err) {
      onError((err as Error).message);
    }
  }

  const host = r.url.startsWith("upload://") ? "Uploaded file" : hostOf(r.url);

  return (
    <li className="group relative flex flex-col overflow-hidden rounded-xl bg-panel hairline transition-shadow hover:shadow-pop">
      <Link href={`/r/${r.id}`} className="block">
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-hover">
          {r.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.thumbnail_url} alt="" className={cn("h-full w-full object-cover object-top", refreshing && "opacity-40")} />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-ink-3">
              <Globe size={18} />
              <span className="text-[11px]">{refreshing ? "Rendering preview…" : "Preview appears after the first visit"}</span>
            </div>
          )}
          {r.mode === "frozen" && (
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-blue-soft px-2 py-0.5 text-[10.5px] font-medium text-blue">
              <Snowflake size={10} /> Frozen
            </span>
          )}
        </div>
      </Link>
      <div className="flex items-start gap-2 px-3 py-2.5">
        {renaming ? (
          <form onSubmit={rename} className="min-w-0 flex-1">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={rename}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setName(r.title);
                  setRenaming(false);
                }
              }}
              maxLength={200}
              aria-label="Page name"
              className="h-7 text-[13px]"
            />
          </form>
        ) : (
          <Link href={`/r/${r.id}`} className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-ink">{r.title || host}</div>
            <div className="truncate text-[11.5px] text-ink-3">
              {host} · {r.created_by} · {timeAgo(r.created_at)}
            </div>
          </Link>
        )}
        {(canEdit || canDelete) && (
          <Menu>
            <MenuTrigger asChild>
              <IconButton size="sm" aria-label={`Options for ${r.title}`} className={cn("opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100")}>
                <MoreHorizontal size={14} />
              </IconButton>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem asChild>
                <Link href={`/r/${r.id}`}>
                  <ExternalLink size={13} /> Open
                </Link>
              </MenuItem>
              {canEdit && (
                <>
                  <MenuItem
                    onSelect={() => {
                      setName(r.title);
                      setRenaming(true);
                    }}
                  >
                    <Pencil size={13} /> Rename
                  </MenuItem>
                  <MenuItem onSelect={() => setMoving(true)}>
                    <FolderInput size={13} /> Move to project…
                  </MenuItem>
                  <MenuItem onSelect={refreshPreview} disabled={refreshing}>
                    <ImageDown size={13} /> Refresh preview
                  </MenuItem>
                </>
              )}
              {canDelete && (
                <>
                  <MenuSeparator />
                  <MenuItem danger onSelect={remove}>
                    <Trash2 size={13} /> Delete page
                  </MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>
        )}
      </div>
      {moving && <MoveDialog r={r} onClose={() => setMoving(false)} onMoved={onChanged} onError={onError} />}
    </li>
  );
}

function MoveDialog({ r, onClose, onMoved, onError }: { r: PublicReview; onClose: () => void; onMoved: () => void; onError: (m: string) => void }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .listProjects()
      .then(({ projects }) => setProjects(projects.filter((p) => p.role !== "view" && p.id !== r.project_id)))
      .catch((e) => onError((e as Error).message));
  }, [r.project_id, onError]);

  async function move() {
    if (!choice) return;
    setBusy(true);
    try {
      await api.patchReview(r.id, { project_id: choice });
      onClose();
      onMoved();
    } catch (e) {
      onError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Move "${r.title}"`} description="The page, its comments and drawings move together. Members of the other project will see it there." width={420}>
        {projects === null ? (
          <div className="h-10 animate-pulse rounded-lg bg-hover" />
        ) : projects.length === 0 ? (
          <p className="text-[13px] text-ink-2">You don&apos;t have edit access to any other project yet.</p>
        ) : (
          <ul className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto p-0.5">
            {projects.map((p) => (
              <li key={p.id}>
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hairline hover:bg-hover",
                    choice === p.id && "shadow-[0_0_0_2px_var(--blue)]",
                  )}
                >
                  <input type="radio" name="move-to" checked={choice === p.id} onChange={() => setChoice(p.id)} className="accent-[var(--blue)]" />
                  <span className="flex-1 truncate text-[13px] font-medium text-ink">{p.name}</span>
                  <span className="text-[11.5px] text-ink-3">
                    {p.review_count} page{p.review_count === 1 ? "" : "s"}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!choice || busy} onClick={move}>
            {busy ? "Moving…" : "Move"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
