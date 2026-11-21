"use client";

import { forwardRef, type ReactNode } from "react";
import { Folder as FolderIcon, FolderInput, Globe, Trash2, X } from "lucide-react";
import { Button, Dialog, DialogContent, IconButton } from "@/components/ui/primitives";
import type { PublicReview } from "@/lib/review";
import { pagesLabel } from "./selection";

/**
 * The bottom-centre spot for what concerns the selection: the bar, and above
 * it the outcome of a bulk action that went wrong — where the person is
 * looking, not in the error line under the add-page box, which is usually
 * scrolled out of view by then. The notice stays after the selection is gone.
 */
export function BottomDock({ notice, onDismiss, children }: { notice: string | null; onDismiss: () => void; children?: ReactNode }) {
  if (!notice && !children) return null;
  return (
    <div
      data-no-marquee
      className="pointer-events-none fixed bottom-5 left-1/2 z-[140] flex w-max max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col items-center gap-2 max-sm:w-[calc(100vw-32px)]"
    >
      {notice && (
        <div role="alert" data-testid="bulk-notice" className="toast-in pointer-events-auto flex max-w-full items-start gap-2 rounded-lg bg-panel py-1.5 pl-3 pr-1.5 text-[12.5px] text-red-ink shadow-pop hairline">
          <span className="py-1">{notice}</span>
          <IconButton size="sm" onClick={onDismiss} aria-label="Dismiss">
            <X size={13} />
          </IconButton>
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * The floating bar of a page selection: how many are selected and what can
 * be done to all of them at once. Only the actions the viewer may take are
 * shown — a viewer gets the count and the way out.
 */
export function SelectionBar({
  count,
  canMoveToFolder,
  canMove,
  canDelete,
  onMoveToFolder,
  onMoveToProject,
  onDelete,
  onClear,
}: {
  count: number;
  canMoveToFolder: boolean;
  canMove: boolean;
  canDelete: boolean;
  onMoveToFolder: () => void;
  onMoveToProject: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Selected pages"
      data-testid="selection-bar"
      // one row on a wide screen; on a phone the count and × share the top row and the actions get a row of their own
      className="toast-in pointer-events-auto flex w-max max-w-full flex-wrap items-center gap-1 rounded-xl bg-panel p-1.5 shadow-pop hairline max-sm:w-full"
    >
      <span className="num px-2 text-[13px] font-medium text-ink max-sm:flex-1" aria-live="polite">
        {pagesLabel(count)} selected
      </span>
      {(canMove || canDelete) && (
        <div className="flex items-center gap-1 before:mx-0.5 before:h-4 before:w-px before:bg-line max-sm:order-last max-sm:basis-full max-sm:justify-between max-sm:border-t max-sm:border-line max-sm:pt-1 max-sm:before:hidden">
          {canMove && canMoveToFolder && (
            <Button variant="ghost" size="sm" onClick={onMoveToFolder}>
              <FolderIcon size={13} /> Move to folder…
            </Button>
          )}
          {canMove && (
            <Button variant="ghost" size="sm" onClick={onMoveToProject}>
              <FolderInput size={13} /> Move to project…
            </Button>
          )}
          {canDelete && (
            <Button variant="ghost" size="sm" onClick={onDelete} className="text-red hover:bg-red-soft hover:text-red">
              <Trash2 size={13} /> Delete
            </Button>
          )}
        </div>
      )}
      <IconButton size="sm" onClick={onClear} aria-label="Clear selection" title="Clear selection (Esc)">
        <X size={14} />
      </IconButton>
    </div>
  );
}

/**
 * Confirms deleting a selection. Only pages the caller may delete (an admin
 * any, an editor their own) are deleted; the dialog says when that is fewer
 * than were selected, rather than failing on the others one by one.
 */
export function DeletePagesDialog({ selected, deletable, onClose, onDelete }: { selected: number; deletable: PublicReview[]; onClose: () => void; onDelete: (ids: string[]) => void }) {
  const n = deletable.length;
  const title = n === 1 ? `Delete "${deletable[0].title}" and all its comments?` : `Delete ${pagesLabel(n)} and all their comments?`;
  const partial = n < selected ? `${n} of ${selected} can be deleted (you didn't create the others). ` : "";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={title} description={`${partial}This can't be undone.`} width={420}>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={n === 0}
            onClick={() => {
              // the project page removes the cards at once and reports failures in its error line
              onDelete(deletable.map((r) => r.id));
              onClose();
            }}
          >
            {n === 1 ? "Delete page" : `Delete ${pagesLabel(n)}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * What the pointer carries while a selection is dragged: the first card on a
 * small stack, with the count. It lives off-screen and is handed to
 * `setDragImage`, which snapshots it at the start of the drag — so it is
 * rendered ahead of time, whenever more than one page is selected.
 */
export const DragStack = forwardRef<HTMLDivElement, { lead: PublicReview; count: number }>(function DragStack({ lead, count }, ref) {
  return (
    <div ref={ref} aria-hidden data-testid="drag-stack" className="pointer-events-none fixed left-[-10000px] top-0 p-4">
      <div className="relative w-[168px]">
        <div className="absolute inset-0 translate-x-[7px] translate-y-[7px] rotate-[3deg] rounded-lg bg-panel hairline" />
        <div className="absolute inset-0 translate-x-[3.5px] translate-y-[3.5px] rotate-[1.5deg] rounded-lg bg-panel hairline" />
        <div className="relative overflow-hidden rounded-lg bg-panel shadow-pop hairline">
          <div className="aspect-[16/10] w-full overflow-hidden bg-hover">
            {lead.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lead.thumbnail_url} alt="" className="h-full w-full object-cover object-top" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-ink-3">
                <Globe size={16} />
              </div>
            )}
          </div>
          <div className="truncate px-2.5 py-1.5 text-[12px] font-medium text-ink">{lead.title}</div>
        </div>
        <span className="num absolute -right-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-blue px-1.5 text-[12px] font-semibold text-white shadow-[0_0_0_2px_var(--panel)]">
          {count}
        </span>
      </div>
    </div>
  );
});
