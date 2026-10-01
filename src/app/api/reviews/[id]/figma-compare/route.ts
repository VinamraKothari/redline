import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, HttpError, reviewAccess } from "@/lib/auth/server";
import { readJson } from "@/lib/body";
import { assertCanCompareFigma } from "@/lib/billing/entitlements";
import { newId } from "@/lib/util";
import { compare, summarize, TITLE_MAX, type Finding } from "@/lib/figma/compare";
import { fetchFigmaSpec, FigmaError } from "@/lib/figma/fetch";
import { parseFigmaUrl } from "@/lib/figma/spec";
import type { ImplSnapshot } from "@/lib/figma/snapshot";
import { DEV_AUTHOR, DEV_COLOR, isDevComment } from "@/lib/figma/dev";
import type { Comment } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Body {
  figmaUrl: string;
  snapshot: ImplSnapshot;
  viewport?: number;
}

/**
 * POST { figmaUrl, snapshot } — compares the rendered page (a snapshot the
 * browser built from the review iframe) with the Figma frame the link points
 * at, and turns every difference into a developer comment pinned to the
 * element concerned. Re-running replaces the unresolved findings of the
 * previous run; resolved ones and their replies are kept.
 */
export const POST = guarded(async (req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/figma-compare">) => {
  const { id } = await ctx.params;
  const { user, review } = await reviewAccess(id, "edit");
  // Runs count against the project owner's monthly allowance.
  const { ownerId } = await assertCanCompareFigma(review.project_id as string, user.id);
  const body = await readJson<Body>(req, 24 * 1024 * 1024);
  if (!body?.figmaUrl || !body.snapshot?.nodes?.length) throw new HttpError(400, "Send the Figma link and a page snapshot.");
  const link = parseFigmaUrl(body.figmaUrl);
  if (!link) throw new HttpError(400, "That doesn't look like a Figma design link (https://www.figma.com/design/…?node-id=…).");
  if (!link.nodeId) throw new HttpError(400, "The Figma link needs a node-id — select the page frame in Figma and copy the link to it.");

  let spec;
  try {
    spec = await fetchFigmaSpec(link.fileKey, link.nodeId);
  } catch (e) {
    if (e instanceof FigmaError) throw new HttpError(e.status, e.message);
    throw e;
  }
  const findings = compare(spec, body.snapshot);

  const d = await db();
  await d.recordFigmaRun(ownerId, id, new Date().toISOString());
  const existing = (await d.listComments(id)).filter((c) => c.parent_id === null && isDevComment(c));
  const keepByFp = new Map<string, Comment>();
  for (const c of existing) if (c.anchor?.dev?.fingerprint) keepByFp.set(c.anchor.dev.fingerprint, c);
  const now = new Date().toISOString();
  const viewport = Number(body.viewport) || body.snapshot.width || review.default_viewport;
  const created: Comment[] = [];
  const kept: string[] = [];
  const fresh = new Set<string>();
  for (const f of findings) {
    fresh.add(f.fingerprint);
    const prev = keepByFp.get(f.fingerprint);
    if (prev) {
      kept.push(prev.id);
      continue;
    }
    // a millisecond apart, so the panel lists them in page order
    created.push(toComment(id, f, body.figmaUrl, viewport, now, new Date(Date.parse(now) + created.length).toISOString()));
  }
  if (created.length) await d.createComments(created);
  // stale findings from earlier runs go — unless someone resolved or replied to them
  const all = await d.listComments(id);
  const removed: string[] = [];
  for (const c of existing) {
    const fp = c.anchor?.dev?.fingerprint;
    if (fp && fresh.has(fp)) continue;
    if (c.resolved) continue;
    if (all.some((r) => r.parent_id === c.id)) continue;
    await d.deleteThread(c.id);
    removed.push(c.id);
  }
  return Response.json({
    figma: { fileKey: link.fileKey, nodeId: link.nodeId, name: spec.name, width: spec.w, height: spec.h },
    findings: findings.length,
    created: created.length,
    kept: kept.length,
    removed: removed.length,
    summary: summarize(findings),
    comments: created,
  });
});

function toComment(reviewId: string, f: Finding, figmaUrl: string, viewport: number, now: string, createdAt = now): Comment {
  const region = f.region && f.region.w > 2 && f.region.h > 2 ? { x: r(f.region.x), y: r(f.region.y), w: r(f.region.w), h: r(f.region.h) } : null;
  const px = region ? region.x + region.w : f.x + Math.min(f.w, 24);
  const py = region ? region.y : f.y + Math.min(f.h / 2, 12);
  return {
    id: newId(),
    review_id: reviewId,
    parent_id: null,
    author_id: null,
    author_name: DEV_AUTHOR,
    author_color: DEV_COLOR,
    title: f.title.slice(0, TITLE_MAX),
    body: `${f.body}\n\n— Compare with Figma · ${f.rule} · ${f.severity}${f.figmaName ? ` · layer “${f.figmaName}”` : ""}`.slice(0, 5000),
    anchor: {
      selector: f.sel || null,
      fx: region ? 0 : 0.5,
      fy: region ? 0 : 0.5,
      px: r(px),
      py: r(py),
      region,
      element_label: f.label || null,
      dev: { rule: f.rule, severity: f.severity, figmaId: f.figmaId, figmaName: f.figmaName, expected: f.expected, actual: f.actual, fingerprint: f.fingerprint, figmaUrl, run: now },
    },
    viewport_width: viewport,
    resolved: false,
    reactions: {},
    attachments: [],
    edited_at: null,
    created_at: createdAt,
  };
}

const r = (v: number) => Math.round(v * 100) / 100;
