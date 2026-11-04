"use client";

import { useState, type DragEvent } from "react";

/**
 * Native HTML5 drag and drop of page tiles into folders. A dragged tile puts
 * its review id under this custom type, so drop targets — and the project
 * page's "drop an .html file anywhere" handler — can tell a tile from a file.
 */
export const REVIEW_DRAG_TYPE = "text/redline-review";

/** Is this drag a page tile (as opposed to a file, a link or an image)? Safe during dragover, where the data itself is sealed. */
export function hasReviewDrag(dt: DataTransfer | null): boolean {
  return Boolean(dt && Array.from(dt.types).includes(REVIEW_DRAG_TYPE));
}

/**
 * Makes an element accept dropped page tiles: `over` is true while a tile
 * hovers it (for the highlight), `props` go on the element. Leaving for a
 * child element is not leaving, so the highlight doesn't flicker.
 */
export function useReviewDropTarget(onDrop: (reviewId: string) => void, enabled = true) {
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
          const id = e.dataTransfer.getData(REVIEW_DRAG_TYPE);
          if (id) onDrop(id);
        },
      }
    : {};
  return { over: enabled && over, props };
}
