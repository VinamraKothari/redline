import type { NextRequest } from "next/server";
import { readJson } from "@/lib/body";
import { db } from "@/lib/db";
import { guarded, HttpError, reviewAccess } from "@/lib/auth/server";
import { screenshotsAvailable } from "@/lib/screenshot";
import { cropAround, renderFull, sections, type RenderPin } from "@/lib/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Chromium cold start + a full-page render of a long page. */
export const maxDuration = 120;

const MAX_BODY = 12 * 1024 * 1024;

interface Body {
  kind: "png" | "jira";
  html: string;
  width: number;
  pins?: RenderPin[];
  overlaySvg?: string | null;
}

/**
 * POST — render the reviewer's snapshot of the page with the markup on top.
 * Body: JSON, optionally gzip-compressed (header x-redline-gzip: 1).
 *  kind "png"  → { sections: [{ n, height, url }], width, height }  (signed URLs, 20 min)
 *  kind "jira" → { crops: { [commentId]: publicUrl }, width, height }
 */
export const POST = guarded(async (req: NextRequest, ctx: RouteContext<"/api/reviews/[id]/render">) => {
  const { id } = await ctx.params;
  const { review } = await reviewAccess(id, "view");
  if (!screenshotsAvailable()) throw new HttpError(501, "Rendering is not available on this server.");

  const body = await readJson<Body>(req, MAX_BODY);
  if (!body) throw new HttpError(400, "Bad render payload (or the page snapshot is too large).");
  if (!body || typeof body.html !== "string" || !body.html || !(body.kind === "png" || body.kind === "jira")) throw new HttpError(400, "Bad render payload.");
  const width = Number(body.width) || review.default_viewport;
  const pins = (Array.isArray(body.pins) ? body.pins : [])
    .filter((p) => p && typeof p.id === "string" && Number.isFinite(p.x) && Number.isFinite(p.y))
    .slice(0, 500)
    .map((p, i) => ({ ...p, n: Number(p.n) || i + 1, color: typeof p.color === "string" && /^#[0-9a-f]{3,8}$/i.test(p.color) ? p.color : "#e2342b" }));

  const baseUrl = review.url.startsWith("upload://") ? "about:blank" : review.url;
  let full;
  try {
    full = await renderFull({ html: body.html, baseUrl, width, pins, overlaySvg: body.overlaySvg || null });
  } catch (e) {
    throw new HttpError(502, `Couldn't render the page: ${(e as Error).message}`);
  }
  const d = await db();
  const stamp = Date.now().toString(36);

  if (body.kind === "png") {
    const parts = await sections(full);
    const out = [];
    for (const s of parts) {
      const path = `exports/${id}/${stamp}-${s.n}.png`;
      await d.putPrivateFile(path, new Uint8Array(s.png), "image/png");
      out.push({ n: s.n, y: s.y, height: s.height, url: await d.privateFileUrl(path, 20 * 60) });
    }
    return Response.json({ sections: out, width: full.width, height: full.height });
  }

  const crops: Record<string, string> = {};
  for (const p of pins) {
    const jpg = await cropAround(full, p);
    crops[p.id] = await d.putPublicFile(`jira/${id}/${p.id}-${stamp}.jpg`, new Uint8Array(jpg), "image/jpeg");
  }
  return Response.json({ crops, width: full.width, height: full.height });
});
