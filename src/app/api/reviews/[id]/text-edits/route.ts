import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, HttpError, reviewAccess, syncProfile } from "@/lib/auth/server";
import { sameCopy } from "@/lib/text-edits/diff";
import { normalizeText } from "@/lib/text-edits/sanitize";
import { signUndo } from "@/lib/text-edits/undo";
import { cleanHtml, LIMITS, note, str, viewport } from "@/lib/text-edits/validate";
import type { TextEdit } from "@/lib/types";
import { newId } from "@/lib/util";

export const runtime = "nodejs";

/** GET — every copy edit of the page, oldest first. Anyone who can open the review. */
export const GET = guarded(async (_req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/text-edits">) => {
  const { id } = await ctx.params;
  await reviewAccess(id);
  const d = await db();
  return Response.json({ edits: await d.listTextEdits(id) });
});

/**
 * PUT `{ selector, label, before_html, after_html, viewport_width, note? }` —
 * save the copy of one block. The first save of a block creates the edit and
 * records `before_*`; later saves only change `after_*` (and reopen an edit
 * marked done, since there is new copy to implement). When the new copy is
 * the original again — same words and formatting; spacing doesn't count —
 * the edit is deleted: that is a reset.
 */
export const PUT = guarded(async (req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/text-edits">) => {
  const { id } = await ctx.params;
  const { user } = await reviewAccess(id, "edit");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const selector = str(body.selector, "selector", LIMITS.selector, { required: true });
  const label = str(body.label, "label", LIMITS.label).trim();
  const beforeClean = cleanHtml(body.before_html, "before_html");
  const after = cleanHtml(body.after_html, "after_html");
  const width = viewport(body.viewport_width);
  const noteValue = note(body.note);

  const d = await db();
  const existing = await d.getTextEditBySelector(id, selector);
  const before = existing ? existing.before_html : beforeClean;
  if (sameCopy(after, before)) {
    if (existing) await d.deleteTextEdit(existing.id);
    return Response.json({ deleted: existing?.id ?? null });
  }

  const now = new Date().toISOString();
  if (existing) {
    const changed = existing.after_html !== after;
    const edit = await d.updateTextEdit(existing.id, {
      after_html: after,
      after_text: normalizeText(after),
      ...(changed ? { status: "open" as const } : {}),
      ...(noteValue !== undefined ? { note: noteValue } : {}),
      updated_at: now,
    });
    if (!edit) throw new HttpError(404, "That edit no longer exists.");
    return Response.json({ edit });
  }

  const profile = await syncProfile(user);
  const edit: TextEdit = {
    id: newId(),
    review_id: id,
    selector,
    label,
    before_html: before,
    before_text: normalizeText(before),
    after_html: after,
    after_text: normalizeText(after),
    viewport_width: width,
    status: "open",
    note: noteValue ?? null,
    author_id: user.id,
    author_name: profile.name,
    author_color: profile.color,
    created_at: now,
    updated_at: now,
  };
  return Response.json({ edit: await d.upsertTextEdit(edit) });
});

/**
 * DELETE — "Restore all on this page": removes every edit and returns them
 * with one undo token each (`tokens[i]` restores `edits[i]`; see restore).
 */
export const DELETE = guarded(async (_req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/text-edits">) => {
  const { id } = await ctx.params;
  await reviewAccess(id, "edit");
  const d = await db();
  const edits = await d.deleteTextEdits(id);
  return Response.json({ ok: true, edits, tokens: edits.map((e) => signUndo(e)) });
});
