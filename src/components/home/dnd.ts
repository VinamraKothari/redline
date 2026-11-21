"use client";

import { useState, type DragEvent } from "react";

/**
 * Native HTML5 drag and drop of page tiles into folders. A dragged tile puts
 * the ids of the pages it carries under this custom type — a JSON array, since
 * dragging one tile of a selection takes the whole selection along — so drop
 * targets, and the project page's "drop an .html file anywhere" handler, can
 * tell a tile from a file.
 */
export const REVIEW_DRAG_TYPE = "text/redline-review";

/** Is this drag a page tile (as opposed to a file, a link or an image)? Safe during dragover, where the data itself is sealed. */
export function hasReviewDrag(dt: DataTransfer | null): boolean {
  return Boolean(dt && Array.from(dt.types).includes(REVIEW_DRAG_TYPE));
}

/** Puts the dragged pages on a drag. */
export function setReviewDrag(dt: DataTransfer, ids: string[]) {
  dt.setData(REVIEW_DRAG_TYPE, JSON.stringify(ids));
  dt.effectAllowed = "move";
}

/** The pages on a drop. A bare id (what a single tile carried before multi-drag) still counts as one page. */
export function readReviewDrag(dt: DataTransfer): string[] {
  const raw = dt.getData(REVIEW_DRAG_TYPE);
  if (!raw) return [];
  if (!raw.startsWith("[")) return [raw];
  try {
    const ids: unknown = JSON.parse(raw);
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
  } catch {
    return [];
  }
}

/**
 * Makes an element accept dropped page tiles: `over` is true while a tile
 * hovers it (for the highlight), `props` go on the element. Leaving for a
 * child element is not leaving, so the highlight doesn't flicker.
 */
export function useReviewDropTarget(onDrop: (reviewIds: string[]) => void, enabled = true) {
  const [over, setOver] = useState(false);
  const props = enabled
    ? {
        onDragOver: (e: DragEvent<HTMLElement>) => {
          if (!hasReviewDrag(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          setOver(true);
        },
        onDragLeave: (e: DragEvent<HTMLElement>) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setOver(false);
        },
        onDrop: (e: DragEvent<HTMLElement>) => {
          if (!hasReviewDrag(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          const ids = readReviewDrag(e.dataTransfer);
          if (ids.length) onDrop(ids);
        },
      }
    : {};
  return { over: enabled && over, props };
}
