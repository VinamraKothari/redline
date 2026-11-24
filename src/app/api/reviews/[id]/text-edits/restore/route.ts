import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, HttpError, reviewAccess } from "@/lib/auth/server";
import { sameCopy } from "@/lib/text-edits/diff";
import { readUndo } from "@/lib/text-edits/undo";
import { LIMITS } from "@/lib/text-edits/validate";
import type { TextEdit } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST `{ tokens: string[] }` — undo of "Reset to original" / "Restore all":
 * puts back the rows the DELETE routes returned, as they were (same ids,
 * authors, creation times and status), so other viewers see the very same
 * edits return. Only signed undo tokens are accepted (lib/text-edits/undo):
 * one that is forged, altered, older than a day or for another page fails
 * the whole request with 400.
 *
 * A row is skipped (its id listed in `skipped`) when its block meanwhile got
 * a different edit — that newer copy is what someone wants now — or when its
 * copy no longer differs from the original.
 */
export const POST = guarded(async (req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/text-edits/restore">) => {
  const { id } = await ctx.params;
  await reviewAccess(id, "edit");
  if (Number(req.headers.get("content-length") || 0) > LIMITS.restoreBytes) throw new HttpError(413, "Too much to restore at once.");
  const raw = await req.text();
  if (raw.length > LIMITS.restoreBytes) throw new HttpError(413, "Too much to restore at once.");
  let body: { tokens?: unknown };
  try {
    body = JSON.parse(raw) as { tokens?: unknown };
  } catch {
    throw new HttpError(400, "tokens must be a list.");
  }
  if (!Array.isArray(body.tokens)) throw new HttpError(400, "tokens must be a list.");
  if (body.tokens.length > LIMITS.restore) throw new HttpError(400, `At most ${LIMITS.restore} edits at a time.`);

  const rows: TextEdit[] = [];
  for (const t of body.tokens) {
    const row = readUndo(t, id);
    if (!row) throw new HttpError(400, "This undo is no longer possible (it expired or isn't valid).");
    rows.push(row);
  }

  const d = await db();
  const current = await d.listTextEdits(id);
  const now = new Date().toISOString();
  const restore: TextEdit[] = [];
  const skipped: string[] = [];
  for (const r of rows) {
    const holder = current.find((e) => e.selector === r.selector);
    const clash = (holder && holder.id !== r.id) || restore.some((x) => x.selector === r.selector);
    if (clash || sameCopy(r.after_html, r.before_html)) skipped.push(r.id);
    else restore.push({ ...r, updated_at: now });
  }
  const edits = restore.length ? await d.insertTextEdits(restore) : [];
  return Response.json({ edits, skipped });
});
