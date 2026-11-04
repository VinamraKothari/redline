"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, Folder as FolderIcon, FolderInput, Globe, ImageDown, MoreHorizontal, Pencil, Snowflake, Trash2 } from "lucide-react";
import { Button, Dialog, DialogContent, IconButton, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/primitives";
import { api, type ProjectSummary } from "@/lib/api";
import type { PublicReview } from "@/lib/review";
import type { Folder, OpenThreadCount } from "@/lib/types";
import { cn, hostOf, timeAgo } from "@/lib/util";
import { REVIEW_DRAG_TYPE } from "./dnd";
import { ThreadBadges } from "./ThreadBadges";

/**
 * A page of a project: preview image with the unresolved-comment badges,
 * title, meta, and — for people who may change it — a menu with rename, move
 * to a folder or another project, and delete. Editors can also drag the tile
 * onto a folder.
 */
export function PageTile({
  r,
  counts,
  folders,
  folderSizes,
  rootSize,
  canEdit,
  canDelete,
  onChanged,
  onError,
}: {
  r: PublicReview;
  /** unresolved threads of this page; absent = none */
  counts?: OpenThreadCount;
  /** the project's folders, for "Move to folder…" */
  folders: Folder[];
  /** pages per folder id, shown next to each choice */
  folderSizes: Record<string, number>;
  /** pages at the project root */
  rootSize: number;
  canEdit: boolean;
  canDelete: boolean;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  // The menu keeps its focus trap until its exit animation ends and then hands
  // focus back to the ⋯ trigger — too late for the input's autoFocus. When
  // "Rename" was picked, the input gets the focus at that moment instead.
  const keepFocusForRename = useRef(false);
  const renameInput = useRef<HTMLInputElement>(null);
  // …and when the rename ends from the keyboard (Enter, Esc) focus goes back to that trigger once the input is gone
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (renaming || !returnFocus.current) return;
    returnFocus.current = false;
    menuTrigger.current?.focus();
  }, [renaming]);
  const [moving, setMoving] = useState<"folder" | "project" | null>(null);
  const [dragging, setDragging] = useState(false);
  const [name, setName] = useState(r.title);
  const [refreshing, setRefreshing] = useState(false);
  // nothing to choose from when the project has no folders and the page is already at the root
  const canMoveToFolder = folders.length > 0 || Boolean(r.folder_id);

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
    <li
      data-testid="page-tile"
      draggable={canEdit || undefined}
      onDragStart={(e) => {
        if (!canEdit) return;
        e.dataTransfer.setData(REVIEW_DRAG_TYPE, r.id);
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl bg-panel hairline transition-[box-shadow,opacity] hover:shadow-pop",
        canEdit && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-50",
      )}
    >
      <Link href={`/r/${r.id}`} className="block" draggable={false}>
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-hover">
          {r.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.thumbnail_url} alt="" draggable={false} className={cn("h-full w-full object-cover object-top", refreshing && "opacity-40")} />
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
          <ThreadBadges counts={counts} className="absolute right-2 top-2" />
        </div>
      </Link>
      <div className="flex items-start gap-2 px-3 py-2.5">
        {renaming ? (
          <form
            onSubmit={(e) => {
              returnFocus.current = true;
              rename(e);
            }}
            className="min-w-0 flex-1"
          >
            <Input
              ref={renameInput}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={rename}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setName(r.title);
                  returnFocus.current = true;
                  setRenaming(false);
                }
              }}
              maxLength={200}
              aria-label="Page name"
              className="h-7 text-[13px]"
            />
          </form>
        ) : (
          <Link href={`/r/${r.id}`} className="min-w-0 flex-1" draggable={false}>
            <div className="truncate text-[13px] font-medium text-ink">{r.title || host}</div>
            <div className="truncate text-[11.5px] text-ink-3">
              {host} · {r.created_by} · {timeAgo(r.created_at)}
            </div>
          </Link>
        )}
        {(canEdit || canDelete) && (
          <Menu>
            <MenuTrigger asChild>
              <IconButton ref={menuTrigger} size="sm" aria-label={`Options for ${r.title}`} className={cn("opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100")}>
                <MoreHorizontal size={14} />
              </IconButton>
            </MenuTrigger>
            <MenuContent
              align="end"
              onCloseAutoFocus={(e) => {
                if (!keepFocusForRename.current) return;
                keepFocusForRename.current = false;
                e.preventDefault();
                renameInput.current?.focus();
                renameInput.current?.select();
              }}
            >
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
                      keepFocusForRename.current = true;
                      setRenaming(true);
                    }}
                  >
                    <Pencil size={13} /> Rename
                  </MenuItem>
                  {canMoveToFolder && (
                    <MenuItem onSelect={() => setMoving("folder")}>
                      <FolderIcon size={13} /> Move to folder…
                    </MenuItem>
                  )}
                  <MenuItem onSelect={() => setMoving("project")}>
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
      {moving === "project" && <MoveDialog r={r} onClose={() => setMoving(null)} onMoved={onChanged} onError={onError} />}
      {moving === "folder" && <MoveToFolderDialog r={r} folders={folders} folderSizes={folderSizes} rootSize={rootSize} onClose={() => setMoving(null)} onMoved={onChanged} onError={onError} />}
    </li>
  );
}

/** The shape of one row in a "move" dialog: a radio, a name and how many pages are already there. */
function Choice({ name, checked, disabled, count, note, onPick }: { name: string; checked: boolean; disabled?: boolean; count: number; note?: string; onPick: () => void }) {
  return (
    <label
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2",
        disabled ? "cursor-default opacity-60" : "cursor-pointer hover:bg-hover",
        // the ring stands in for the hairline (both are box-shadows), so the chosen row has one clear outline
        checked ? "shadow-[0_0_0_2px_var(--blue)]" : "hairline",
      )}
    >
      <input type="radio" name="move-to" checked={checked} disabled={disabled} onChange={onPick} className="accent-[var(--blue)]" />
      <span className="flex-1 truncate text-[13px] font-medium text-ink">{name}</span>
      {note && <span className="rounded-full bg-paper px-1.5 py-0.5 text-[10.5px] font-medium text-ink-3 hairline">{note}</span>}
      <span className="text-[11.5px] text-ink-3">
        {count} page{count === 1 ? "" : "s"}
      </span>
    </label>
  );
}

/** Pick a folder of this project (or the root) for the page. The current place is marked and can't be chosen. */
function MoveToFolderDialog({
  r,
  folders,
  folderSizes,
  rootSize,
  onClose,
  onMoved,
  onError,
}: {
  r: PublicReview;
  folders: Folder[];
  folderSizes: Record<string, number>;
  rootSize: number;
  onClose: () => void;
  onMoved: () => void;
  onError: (m: string) => void;
}) {
  const current = r.folder_id ?? null;
  // "" stands for the root so the state can tell "root chosen" from "nothing chosen yet"
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function move() {
    if (choice === null) return;
    setBusy(true);
    try {
      await api.moveToFolder(r.id, choice || null);
      onClose();
      onMoved();
    } catch (e) {
      onError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Move "${r.title}"`} description="Everyone in the project still sees the page — it just changes place." width={420}>
        <ul className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto p-0.5">
          <li>
            <Choice name="Project root (no folder)" checked={choice === ""} disabled={current === null} note={current === null ? "current" : undefined} count={rootSize} onPick={() => setChoice("")} />
          </li>
          {folders.map((f) => (
            <li key={f.id}>
              <Choice name={f.name} checked={choice === f.id} disabled={current === f.id} note={current === f.id ? "current" : undefined} count={folderSizes[f.id] ?? 0} onPick={() => setChoice(f.id)} />
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={choice === null || busy} onClick={move}>
            {busy ? "Moving…" : "Move"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
                <Choice name={p.name} checked={choice === p.id} count={p.review_count} onPick={() => setChoice(p.id)} />
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
