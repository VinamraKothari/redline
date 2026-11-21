/**
 * The arithmetic behind selecting page tiles the way a file manager does:
 * click, Ctrl/Cmd-click, Shift-click and a rubber band. Pure functions, so the
 * project page only keeps the state.
 */

export interface Modifiers {
  /** Ctrl, or Cmd on a Mac: add to / toggle within the selection */
  toggle: boolean;
  /** Shift: everything between the anchor and here */
  range: boolean;
}

export function modifiersOf(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): Modifiers {
  return { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey };
}

/**
 * The selection after a click on `id`. `order` is the visual order of the
 * tiles in view; `anchor` the tile a Shift-click measures from (the last tile
 * clicked without Shift). Returns the new selection and the new anchor.
 */
export function clickSelect(current: ReadonlySet<string>, order: readonly string[], anchor: string | null, id: string, mods: Modifiers): { selected: Set<string>; anchor: string } {
  if (mods.range) {
    const from = anchor && order.includes(anchor) ? anchor : id;
    const a = order.indexOf(from);
    const b = order.indexOf(id);
    const span = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    // Ctrl+Shift adds the range to what was there; plain Shift replaces it. The anchor stays put either way.
    const selected = new Set(mods.toggle ? [...current, ...span] : span);
    return { selected, anchor: from };
  }
  if (mods.toggle) {
    const selected = new Set(current);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    return { selected, anchor: id };
  }
  return { selected: new Set([id]), anchor: id };
}

/** A viewport point a menu opens at. */
export type Point = { x: number; y: number };

/** Where a menu opened from the keyboard (Shift+F10, the context-menu key) appears: just under the focused element. */
export function pointUnder(el: Element): Point {
  const b = el.getBoundingClientRect();
  return { x: b.left, y: b.bottom };
}

/** Is this key press a request for the context menu? */
export function isMenuKey(e: { key: string; shiftKey: boolean }): boolean {
  return e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function intersects(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** What a rubber band leaves selected: the hits alone, or — with Ctrl/Cmd — the earlier selection with the hits toggled, as Explorer does. */
export function bandSelect(base: ReadonlySet<string>, hits: readonly string[], toggle: boolean): Set<string> {
  if (!toggle) return new Set(hits);
  const out = new Set(base);
  for (const id of hits) {
    if (base.has(id)) out.delete(id);
    else out.add(id);
  }
  return out;
}

export function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** "3 pages" / "1 page" */
export function pagesLabel(n: number): string {
  return `${n} page${n === 1 ? "" : "s"}`;
}

/**
 * Runs one API call per page, all at once, and boils the outcome down to a
 * single error line (or null when every call went through) — one line for a
 * bulk operation, not one per page.
 */
export async function forEachPage(ids: readonly string[], run: (id: string) => Promise<unknown>, verb: string): Promise<string | null> {
  const results = await Promise.allSettled(ids.map(run));
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (!failed.length) return null;
  const reason = (failed[0].reason as Error)?.message || "Something went wrong.";
  // a single page reads exactly as before multi-select existed
  if (ids.length === 1) return reason;
  return `Couldn't ${verb} ${failed.length} of ${ids.length} pages: ${reason}`;
}
