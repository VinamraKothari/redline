import { HttpError } from "@/lib/auth/server";
import { MAX_HTML, MAX_RAW_HTML, sanitizeChecked } from "./sanitize";

/**
 * Request validation shared by the text-edit routes (server only). Limits are
 * generous for real copy and small enough that one row stays cheap to store
 * and stream. Raw HTML may be much longer than what is stored: a site's
 * per-word spans and contentEditable's leftovers mostly disappear when it is
 * cleaned, and it is the cleaned copy that must fit.
 */
export const LIMITS = {
  selector: 1000,
  label: 140,
  rawHtml: MAX_RAW_HTML,
  html: MAX_HTML,
  note: 1000,
  viewport: { min: 200, max: 4000 },
  /** undo tokens per restore, and the request body that carries them */
  restore: 200,
  restoreBytes: 2 * 1024 * 1024,
} as const;

export function str(v: unknown, field: string, max: number, opts: { required?: boolean } = {}): string {
  if (v === undefined || v === null) {
    if (opts.required) throw new HttpError(400, `${field} is missing.`);
    return "";
  }
  if (typeof v !== "string") throw new HttpError(400, `${field} must be text.`);
  if (opts.required && !v.trim()) throw new HttpError(400, `${field} is missing.`);
  if (v.length > max) throw new HttpError(400, `${field} is limited to ${max} characters.`);
  return v;
}

export function viewport(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < LIMITS.viewport.min || n > LIMITS.viewport.max) {
    throw new HttpError(400, `viewport_width must be a whole number between ${LIMITS.viewport.min} and ${LIMITS.viewport.max}.`);
  }
  return n;
}

/** A note: trimmed, empty = none. `undefined` means "leave it as it is". */
export function note(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  const s = str(v, "note", LIMITS.note).trim();
  return s || null;
}

/** Sanitized inline HTML from a request field; 400 when the raw or the cleaned copy is too long. */
export function cleanHtml(v: unknown, field: string): string {
  const { html, truncated } = sanitizeChecked(str(v, field, LIMITS.rawHtml));
  if (truncated) throw new HttpError(400, `${field}: the copy is limited to ${LIMITS.html} characters of HTML.`);
  return html;
}
