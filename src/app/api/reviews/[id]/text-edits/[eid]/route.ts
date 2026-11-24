import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, HttpError, reviewAccess } from "@/lib/auth/server";
import { sameCopy } from "@/lib/text-edits/diff";
import { normalizeText } from "@/lib/text-edits/sanitize";
import { signUndo } from "@/lib/text-edits/undo";
import { cleanHtml, note } from "@/lib/text-edits/validate";
import type { TextEdit } from "@/lib/types";

export const runtime = "nodejs";

/** The edit, if it belongs to this review; an edit of another review is as missing as one that never existed. */
async function editOf(reviewId: string, eid: string): Promise<TextEdit> {
  const d = await db();
  const e = await d.getTextEdit(eid);
  if (!e || e.review_id !== reviewId) throw new HttpError(404, "That edit no longer exists.");
  return e;
}

/**
 * PATCH `{ status?, note?, after_html? }` — mark done / reopen, write a note,
 * or change the new copy. Copy edits belong to the page, not to their
 * author: anyone who may edit the review may handle them (like developer
 * comments). New copy reopens a done edit; copy that is the original again
 * (spacing aside) deletes the edit (`{ deleted }`).
 */
export const PATCH = guarded(async (req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/text-edits/[eid]">) => {
  const { id, eid } = await ctx.params;
  await reviewAccess(id, "edit");
  const cur = await editOf(id, eid);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Partial<TextEdit> = {};

  if (body.status !== undefined) {
    if (body.status !== "open" && body.status !== "done") throw new HttpError(400, "status must be open or done.");
    patch.status = body.status;
  }
  const n = note(body.note);
  if (n !== undefined) patch.note = n;
  if (body.after_html !== undefined) {
    const after = cleanHtml(body.after_html, "after_html");
    if (sameCopy(after, cur.before_html)) {
      const d = await db();
      await d.deleteTextEdit(cur.id);
      return Response.json({ deleted: cur.id });
    }
    patch.after_html = after;
    patch.after_text = normalizeText(after);
    // new copy is something to implement again, as with a PUT (unless this very request sets the status)
    if (after !== cur.after_html && patch.status === undefined) patch.status = "open";
  }
  if (!Object.keys(patch).length) throw new HttpError(400, "Nothing to change.");

  const d = await db();
  const edit = await d.updateTextEdit(cur.id, { ...patch, updated_at: new Date().toISOString() });
  if (!edit) throw new HttpError(404, "That edit no longer exists.");
  return Response.json({ edit });
});

/** DELETE — "Reset to original". Returns the deleted row and its undo token (see restore). */
export const DELETE = guarded(async (_req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/text-edits/[eid]">) => {
  const { id, eid } = await ctx.params;
  await reviewAccess(id, "edit");
  const edit = await editOf(id, eid);
  const d = await db();
  await d.deleteTextEdit(edit.id);
  return Response.json({ ok: true, edit, token: signUndo(edit) });
});
