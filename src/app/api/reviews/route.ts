import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import type { Review } from "@/lib/types";
import { hostOf, newKey, newSlug, normalizeUrl } from "@/lib/util";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    return await create(req);
  } catch (e) {
    console.error("[redline] create review failed", e);
    return Response.json({ error: (e as Error).message || "Could not create the review." }, { status: 500 });
  }
}

async function create(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    url?: string;
    name?: string;
    viewport?: number;
    mode?: "live" | "upload";
    html?: string;
    title?: string;
  };

  let url: string | null = null;
  if (body.mode === "upload") {
    if (!body.html || body.html.length > 4 * 1024 * 1024) {
      return Response.json({ error: "Upload an HTML file up to 4 MB." }, { status: 400 });
    }
    url = "upload://" + (body.title || "page.html");
  } else {
    url = normalizeUrl(body.url || "");
    if (!url) return Response.json({ error: "Enter a valid web address, e.g. example.com" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const review: Review = {
    id: newSlug(),
    url,
    title: body.title || (body.mode === "upload" ? body.title || "Uploaded page" : hostOf(url)),
    mode: body.mode === "upload" ? "upload" : "live",
    snapshot_path: null,
    default_viewport: body.viewport || 1440,
    created_by: (body.name || "Anonymous").slice(0, 60),
    owner_key: newKey(),
    created_at: now,
    updated_at: now,
  };

  const d = await db();
  if (body.mode === "upload" && body.html) {
    review.snapshot_path = `${review.id}/upload.html`;
    await d.putSnapshot(review.snapshot_path, body.html);
  }
  await d.createReview(review);
  return Response.json({ review });
}
