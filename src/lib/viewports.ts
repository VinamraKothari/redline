import type { Comment } from "./types";

/**
 * A thread normally belongs to the viewport it was written at. It can instead
 * apply to a range of viewports — "tablet + phone", or every size — stored on
 * its anchor as `viewports: { min, max }` (widths in px, inclusive).
 */

export type ViewportKind = "desktop" | "tablet" | "mobile";

/** Width bands behind the desktop / tablet / phone presets. */
export const KIND_RANGE: Record<ViewportKind, { min: number; max: number }> = {
  desktop: { min: 1200, max: 100_000 },
  tablet: { min: 700, max: 1199 },
  mobile: { min: 0, max: 699 },
};
export const KIND_ORDER: ViewportKind[] = ["desktop", "tablet", "mobile"];
export const KIND_LABEL: Record<ViewportKind, string> = { desktop: "Desktop", tablet: "Tablet", mobile: "Phone" };

export function kindOf(width: number): ViewportKind {
  return width >= 1200 ? "desktop" : width >= 700 ? "tablet" : "mobile";
}

/** The contiguous band covering every selected kind (gaps are filled in). */
export function rangeForKinds(kinds: ViewportKind[]): { min: number; max: number } | null {
  if (!kinds.length) return null;
  return { min: Math.min(...kinds.map((k) => KIND_RANGE[k].min)), max: Math.max(...kinds.map((k) => KIND_RANGE[k].max)) };
}

export function kindsInRange(r: { min: number; max: number }): ViewportKind[] {
  return KIND_ORDER.filter((k) => KIND_RANGE[k].max >= r.min && KIND_RANGE[k].min <= r.max);
}

export function viewportRange(c: Pick<Comment, "anchor">): { min: number; max: number } | null {
  const v = c.anchor?.viewports;
  if (!v || typeof v.min !== "number" || typeof v.max !== "number") return null;
  return v;
}

/** Does this thread belong on the given viewport? */
export function showsAt(c: Pick<Comment, "anchor" | "viewport_width">, viewport: number): boolean {
  const r = viewportRange(c);
  return r ? viewport >= r.min && viewport <= r.max : c.viewport_width === viewport;
}

/** "1440", "Tablet + Phone", "All viewports" — for tiles, thread headers and exports. */
export function viewportLabel(c: Pick<Comment, "anchor" | "viewport_width">): string {
  const r = viewportRange(c);
  if (!r) return String(c.viewport_width);
  const kinds = kindsInRange(r);
  if (kinds.length === KIND_ORDER.length) return "All viewports";
  return kinds.map((k) => KIND_LABEL[k]).join(" + ");
}

/** Same, spelled out with the pixel band for CSV / Markdown exports. */
export function viewportExportLabel(c: Pick<Comment, "anchor" | "viewport_width">): string {
  const r = viewportRange(c);
  if (!r) return `${c.viewport_width}px`;
  const kinds = kindsInRange(r);
  if (kinds.length === KIND_ORDER.length) return `all viewports (written at ${c.viewport_width}px)`;
  return `${kinds.map((k) => KIND_LABEL[k]).join(" + ")} (${r.min}–${Math.min(r.max, 9999)}px; written at ${c.viewport_width}px)`;
}

/** A viewport band is two whole pixel widths, min ≤ max; anything else means "just the original viewport". */
export function sanitizeViewports(v: unknown): { min: number; max: number } | null {
  if (!v || typeof v !== "object") return null;
  const { min, max } = v as { min?: unknown; max?: unknown };
  if (typeof min !== "number" || typeof max !== "number" || !Number.isFinite(min) || !Number.isFinite(max)) return null;
  const a = Math.max(0, Math.round(Math.min(min, max)));
  const b = Math.min(100_000, Math.round(Math.max(min, max)));
  return { min: a, max: b };
}
