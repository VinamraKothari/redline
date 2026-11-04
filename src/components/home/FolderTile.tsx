"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Folder as FolderIcon, FolderOpen, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button, Dialog, DialogContent, IconButton, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { FOLDER_NAME_MAX } from "@/lib/folders";
import type { PublicReview } from "@/lib/review";
import type { Folder, OpenThreadCount } from "@/lib/types";
import { cn, timeAgo } from "@/lib/util";
import { useReviewDropTarget } from "./dnd";
import { ThreadBadges } from "./ThreadBadges";

/**
 * A folder of a project, shown among the page tiles: a mosaic of the previews
 * of the pages inside, the summed unresolved-comment badges, and — for people
 * who may change it — rename and delete. Page tiles can be dropped on it.
 */
export function FolderTile({
  folder,
  pages,
  counts,
  canEdit,
  onChanged,
  onError,
  onDropPage,
}: {
  folder: Folder;
  /** the pages inside, newest first */
  pages: PublicReview[];
  counts: OpenThreadCount;
  canEdit: boolean;
  onChanged: () => void;
  onError: (msg: string) => void;
  onDropPage: (reviewId: string, folderId: string) => void;
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
  const [name, setName] = useState(folder.name);
  const [deleting, setDeleting] = useState(false);
  const { over, props: dropProps } = useReviewDropTarget((reviewId) => onDropPage(reviewId, folder.id), canEdit);
  const href = `/p/${folder.project_id}/f/${folder.id}`;
  const thumbs = pages.map((p) => p.thumbnail_url).filter((u): u is string => Boolean(u));
  // "updated" means the folder or anything in it — the folder row itself only changes on rename
  const updatedAt = pages.reduce((latest, p) => (p.updated_at > latest ? p.updated_at : latest), folder.updated_at);

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    setRenaming(false);
    if (!n || n === folder.name) return;
    try {
      await api.renameFolder(folder.project_id, folder.id, n);
      onChanged();
    } catch (err) {
      onError((err as Error).message);
    }
  }

  return (
    <li
      {...dropProps}
      data-testid="folder-tile"
      data-drop-over={over || undefined}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl bg-panel transition-shadow",
        // the drop ring replaces the hairline (both are box-shadows) so it reads as one clear outline
        over ? "shadow-[0_0_0_2px_var(--blue)]" : "hairline hover:shadow-pop",
      )}
    >
      <Link href={href} className="block" draggable={false}>
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-hover">
          <Mosaic urls={thumbs} empty={pages.length === 0} hidePlaceholder={over} />
          <ThreadBadges counts={counts} className="absolute right-2 top-2" />
          {over && (
            // a tint over the previews, with a chip that stays legible on top of them
            <div className="absolute inset-0 flex items-center justify-center bg-blue-soft">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-panel px-2.5 py-1 text-[11.5px] font-medium text-blue shadow-pop">
                <FolderOpen size={13} /> Move here
              </span>
            </div>
          )}
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
                  setName(folder.name);
                  returnFocus.current = true;
                  setRenaming(false);
                }
              }}
              maxLength={FOLDER_NAME_MAX}
              aria-label="Folder name"
              className="h-7 text-[13px]"
            />
          </form>
        ) : (
          <Link href={href} className="min-w-0 flex-1" draggable={false}>
            <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
              <FolderIcon size={13} className="shrink-0 text-ink-2" />
              <span className="truncate">{folder.name}</span>
            </div>
            <div className="truncate text-[11.5px] text-ink-3">
              {pages.length} page{pages.length === 1 ? "" : "s"} · updated {timeAgo(updatedAt)}
            </div>
          </Link>
        )}
        {canEdit && (
          <Menu>
            <MenuTrigger asChild>
              <IconButton ref={menuTrigger} size="sm" aria-label={`Options for folder ${folder.name}`} className="opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100">
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
                <Link href={href}>
                  <FolderOpen size={13} /> Open
                </Link>
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  setName(folder.name);
                  keepFocusForRename.current = true;
                  setRenaming(true);
                }}
              >
                <Pencil size={13} /> Rename
              </MenuItem>
              <MenuSeparator />
              <MenuItem danger onSelect={() => setDeleting(true)}>
                <Trash2 size={13} /> Delete folder…
              </MenuItem>
            </MenuContent>
          </Menu>
        )}
      </div>
      {deleting && <DeleteFolderDialog folder={folder} pageCount={pages.length} onClose={() => setDeleting(false)} onDeleted={onChanged} onError={onError} />}
    </li>
  );
}

/**
 * Previews of the pages inside, in the style of the project cards: one fills
 * the frame, two sit side by side, three or more make a small grid.
 */
function Mosaic({ urls, empty, hidePlaceholder }: { urls: string[]; empty: boolean; hidePlaceholder: boolean }) {
  if (!urls.length) {
    return (
      <div className={cn("flex h-full w-full flex-col items-center justify-center gap-1.5 text-ink-3", hidePlaceholder && "invisible")}>
        <FolderIcon size={18} />
        <span className="text-[11px]">{empty ? "Empty folder" : "Previews appear once pages are opened"}</span>
      </div>
    );
  }
  const shown = urls.slice(0, 4);
  return (
    <div className={cn("grid h-full w-full gap-1 p-1", shown.length === 1 ? "grid-cols-1" : "grid-cols-2", shown.length >= 3 && "grid-rows-2")}>
      {shown.map((u, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i} src={u} alt="" loading="lazy" className={cn("h-full w-full min-h-0 min-w-0 rounded-md object-cover object-top", shown.length === 3 && i === 0 && "row-span-2")} />
      ))}
    </div>
  );
}

function DeleteFolderDialog({ folder, pageCount, onClose, onDeleted, onError }: { folder: Folder; pageCount: number; onClose: () => void; onDeleted: () => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      await api.deleteFolder(folder.project_id, folder.id);
      onClose();
      onDeleted();
    } catch (e) {
      onError((e as Error).message);
      setBusy(false);
    }
  }
  const pages = pageCount === 1 ? "The page inside moves" : `The ${pageCount} pages inside move`;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Delete the folder "${folder.name}"?`} description={pageCount ? `${pages} back to the project — nothing is deleted.` : "The folder is empty — nothing else changes."} width={400}>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={busy} onClick={remove}>
            {busy ? "Deleting…" : "Delete folder"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
