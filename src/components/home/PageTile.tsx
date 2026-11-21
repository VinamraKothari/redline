"use client";

import { memo, useEffect, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppWindow, Check, ExternalLink, Folder as FolderIcon, FolderInput, Globe, ImageDown, MoreHorizontal, Pencil, Snowflake, Trash2 } from "lucide-react";
import { Button, ContextMenu, Dialog, DialogContent, IconButton, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/primitives";
import { api, type ProjectSummary } from "@/lib/api";
import type { PublicReview } from "@/lib/review";
import type { Folder, OpenThreadCount } from "@/lib/types";
import { cn, hostOf, timeAgo } from "@/lib/util";
import { DeletePagesDialog } from "./SelectionBar";
import { forEachPage, isMenuKey, modifiersOf, pagesLabel, pointUnder, type Modifiers, type Point } from "./selection";
import { ThreadBadges } from "./ThreadBadges";

/**
 * A page of a project: preview image with the unresolved-comment badges,
 * title, meta, and — for people who may change it — a menu with rename, move
 * to a folder or another project, and delete; the same menu opens on a
 * right-click. A click on the card selects it (the project page keeps the
 * selection), the title opens the page, and editors can drag the card — and
 * whatever else is selected — onto a folder. Memoised: a rubber band changes
 * the selection on every pointer move, and only the cards whose `selected`
 * flips should render again (the project page keeps its callbacks stable).
 */
export const PageTile = memo(function PageTile({
  r,
  counts,
  folders,
  folderSizes,
  rootSize,
  canEdit,
  canDelete,
  selected,
  dragging,
  onPick,
  onMenu,
  onDragStart,
  onDelete,
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
  selected: boolean;
  /** this card is on its way somewhere (alone or with the selection) */
  dragging: boolean;
  /** a click on the card body or the preview, with its modifier keys */
  onPick: (id: string, mods: Modifiers) => void;
  /** a right-click (or Shift+F10): true when the project page shows its menu for the whole selection instead of this card's */
  onMenu: (id: string, at: Point) => boolean;
  onDragStart: (e: DragEvent<HTMLElement>, id: string) => void;
  /** delete (already confirmed) — the project page's bulk delete, so one page and many behave alike */
  onDelete: (ids: string[]) => void;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const router = useRouter();
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
  const [deleting, setDeleting] = useState(false);
  // On a touch screen a double-tap is unreliable (iOS zooms instead), so a tap
  // on the preview opens the page as the link it used to be; the pointer type of
  // the press decides, since the click that follows doesn't carry it everywhere.
  const pressedWith = useRef<string>("mouse");
  const [menuAt, setMenuAt] = useState<Point | null>(null);
  const [name, setName] = useState(r.title);
  const [refreshing, setRefreshing] = useState(false);
  // nothing to choose from when the project has no folders and the page is already at the root
  const canMoveToFolder = folders.length > 0 || Boolean(r.folder_id);
  const href = `/r/${r.id}`;

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

  function openMenu(at: Point) {
    if (!onMenu(r.id, at)) setMenuAt(at);
  }

  const host = r.url.startsWith("upload://") ? "Uploaded file" : hostOf(r.url);
  const hasMenu = canEdit || canDelete;
  // shared by the ⋯ menu and the right-click menu, so both always offer the same
  const items = (
    <>
      <MenuItem asChild>
        <Link href={href}>
          <ExternalLink size={13} /> Open
        </Link>
      </MenuItem>
      <MenuItem asChild>
        <a href={href} target="_blank" rel="noopener">
          <AppWindow size={13} /> Open in new tab
        </a>
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
          <MenuItem danger onSelect={() => setDeleting(true)}>
            <Trash2 size={13} /> Delete page…
          </MenuItem>
        </>
      )}
    </>
  );
  const focusRenameOnClose = (e: Event) => {
    if (!keepFocusForRename.current) return;
    keepFocusForRename.current = false;
    e.preventDefault();
    renameInput.current?.focus();
    renameInput.current?.select();
  };

  return (
    // No list role both allows selection and keeps the card's link and ⋯ button
    // reachable (an option's children are presentational), so the plain list
    // item carries aria-selected; the check mark also says "Selected" in words.
    // eslint-disable-next-line jsx-a11y/role-supports-aria-props
    <li
      data-testid="page-tile"
      data-tile="page"
      data-review-id={r.id}
      aria-selected={selected}
      draggable={canEdit || undefined}
      onDragStart={(e) => {
        if (!canEdit) return;
        onDragStart(e, r.id);
      }}
      // React lets events from this card's dialogs and menus (portals) bubble here; only the card itself counts
      onClick={(e) => {
        if (!e.currentTarget.contains(e.target as Node)) return;
        if ((e.target as Element).closest("a, button, input, form")) return;
        onPick(r.id, modifiersOf(e));
      }}
      onContextMenu={(e) => {
        if (!e.currentTarget.contains(e.target as Node)) return;
        // the rename field keeps the browser's menu (paste, spelling)
        if ((e.target as Element).closest("input")) return;
        e.preventDefault();
        e.stopPropagation();
        // a menu-key press arrives as a contextmenu at 0,0: put the menu under the focused element instead
        openMenu(e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : pointUnder(e.target as Element));
      }}
      onKeyDown={(e) => {
        // Shift+F10 inside this card's own dialog is not a request for the card's menu
        if (!e.currentTarget.contains(e.target as Node)) return;
        if (!isMenuKey(e) || (e.target as Element).closest("input")) return;
        e.preventDefault();
        openMenu(pointUnder(e.target as Element));
      }}
      className={cn(
        "group relative flex select-none flex-col overflow-hidden rounded-xl bg-panel transition-[box-shadow,opacity]",
        // the selection ring replaces the hairline (both are box-shadows), like a folder's drop ring
        selected ? "shadow-[0_0_0_2px_var(--blue)] hover:shadow-[0_0_0_2px_var(--blue),var(--shadow-pop)]" : "hairline hover:shadow-pop",
        canEdit && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-50",
      )}
    >
      {/* not a link: a click selects the card, a double-click opens it (a tap, on a touch screen); the title below is the link */}
      <div
        className="relative aspect-[16/10] w-full overflow-hidden bg-hover"
        title="Click to select · double-click to open"
        onPointerDown={(e) => {
          pressedWith.current = e.pointerType;
        }}
        onClick={(e) => {
          if (pressedWith.current !== "touch") return;
          e.stopPropagation();
          router.push(href);
        }}
        onDoubleClick={(e) => {
          if (e.ctrlKey || e.metaKey || e.shiftKey) return;
          router.push(href);
        }}
        onAuxClick={(e) => {
          // the middle button still opens the page in a new tab, as it did when the preview was a link
          if (e.button === 1) window.open(href, "_blank", "noopener");
        }}
      >
        {r.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.thumbnail_url} alt="" draggable={false} className={cn("h-full w-full object-cover object-top", refreshing && "opacity-40")} />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-ink-3">
            <Globe size={18} />
            <span className="text-[11px]">{refreshing ? "Rendering preview…" : "Preview appears after the first visit"}</span>
          </div>
        )}
        {(selected || r.mode === "frozen") && (
          <div className="absolute left-2 top-2 flex items-center gap-1.5">
            {selected && (
              <span data-testid="tile-check" className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-blue text-white shadow-[0_0_0_2px_var(--panel)]">
                <Check size={12} strokeWidth={3} aria-hidden />
                <span className="sr-only">Selected</span>
              </span>
            )}
            {r.mode === "frozen" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-soft px-2 py-0.5 text-[10.5px] font-medium text-blue">
                <Snowflake size={10} /> Frozen
              </span>
            )}
          </div>
        )}
        <ThreadBadges counts={counts} className="absolute right-2 top-2" />
      </div>
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
          <Link href={href} className="min-w-0 flex-1" draggable={false}>
            <div className="truncate text-[13px] font-medium text-ink">{r.title || host}</div>
            <div className="truncate text-[11.5px] text-ink-3">
              {host} · {r.created_by} · {timeAgo(r.created_at)}
            </div>
          </Link>
        )}
        {hasMenu && (
          <Menu>
            <MenuTrigger asChild>
              <IconButton ref={menuTrigger} size="sm" aria-label={`Options for ${r.title}`} className={cn("opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100")}>
                <MoreHorizontal size={14} />
              </IconButton>
            </MenuTrigger>
            <MenuContent align="end" onCloseAutoFocus={focusRenameOnClose}>
              {items}
            </MenuContent>
          </Menu>
        )}
      </div>
      {/* viewers get the right-click menu too — with nothing but the ways to open the page */}
      <ContextMenu at={menuAt} onClose={() => setMenuAt(null)} label={`Actions for ${r.title}`} onCloseAutoFocus={focusRenameOnClose}>
        {items}
      </ContextMenu>
      {deleting && <DeletePagesDialog selected={1} deletable={[r]} onClose={() => setDeleting(false)} onDelete={onDelete} />}
      {moving === "project" && <MoveToProjectDialog reviews={[r]} onClose={() => setMoving(null)} onMoved={onChanged} onError={onError} />}
      {moving === "folder" && <MoveToFolderDialog reviews={[r]} folders={folders} folderSizes={folderSizes} rootSize={rootSize} onClose={() => setMoving(null)} onMoved={onChanged} onError={onError} />}
    </li>
  );
});

/** "Move "Pricing"" for one page, "Move 3 pages" for a selection. */
function moveTitle(reviews: PublicReview[]): string {
  return reviews.length === 1 ? `Move "${reviews[0].title}"` : `Move ${pagesLabel(reviews.length)}`;
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

/**
 * Pick a folder of this project (or the root) for one page or a selection.
 * The pages always come from one view, so they share a place: it is marked
 * current and can't be chosen.
 */
export function MoveToFolderDialog({
  reviews,
  folders,
  folderSizes,
  rootSize,
  onClose,
  onMoved,
  onError,
}: {
  reviews: PublicReview[];
  folders: Folder[];
  folderSizes: Record<string, number>;
  rootSize: number;
  onClose: () => void;
  onMoved: () => void;
  onError: (m: string) => void;
}) {
  const current = reviews[0]?.folder_id ?? null;
  // "" stands for the root so the state can tell "root chosen" from "nothing chosen yet"
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function move() {
    if (choice === null) return;
    setBusy(true);
    const failed = await forEachPage(
      reviews.map((r) => r.id),
      (id) => api.moveToFolder(id, choice || null),
      "move",
    );
    if (failed) onError(failed);
    // even a partial failure moved something: close and let the reload show where everything is now
    if (failed && reviews.length === 1) {
      setBusy(false);
      return;
    }
    onClose();
    onMoved();
  }

  const one = reviews.length === 1;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={moveTitle(reviews)} description={one ? "Everyone in the project still sees the page — it just changes place." : "Everyone in the project still sees the pages — they just change place."} width={420}>
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

/** Pick another project (one the caller may edit) for one page or a selection; comments and drawings go along. */
export function MoveToProjectDialog({ reviews, onClose, onMoved, onError }: { reviews: PublicReview[]; onClose: () => void; onMoved: () => void; onError: (m: string) => void }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = reviews[0]?.project_id;

  useEffect(() => {
    api
      .listProjects()
      .then(({ projects }) => setProjects(projects.filter((p) => p.role !== "view" && p.id !== from)))
      .catch((e) => onError((e as Error).message));
  }, [from, onError]);

  async function move() {
    if (!choice) return;
    setBusy(true);
    const failed = await forEachPage(
      reviews.map((r) => r.id),
      (id) => api.patchReview(id, { project_id: choice }),
      "move",
    );
    if (failed) onError(failed);
    if (failed && reviews.length === 1) {
      setBusy(false);
      return;
    }
    onClose();
    onMoved();
  }

  const one = reviews.length === 1;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={moveTitle(reviews)}
        description={one ? "The page, its comments and drawings move together. Members of the other project will see it there." : "The pages, their comments and drawings move together. Members of the other project will see them there."}
        width={420}
      >
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
