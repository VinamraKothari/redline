import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, projectAccess, syncProfile } from "@/lib/auth/server";
import { publicReview } from "@/lib/review";
import type { Review } from "@/lib/types";
import { hostOf, newKey, newSlug, normalizeUrl } from "@/lib/util";

export const runtime = "nodejs";

/** Create a review inside a project (edit role). */
export const POST = guarded(async (req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as {
    project_id?: string;
    url?: string;
    viewport?: number;
    mode?: "live" | "upload";
    html?: string;
    title?: string;
  };
  if (!body.project_id) return Response.json({ error: "Pick a project first." }, { status: 400 });
  const { user, role } = await projectAccess(body.project_id, "edit");
  const profile = await syncProfile(user);

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
    project_id: body.project_id,
    url,
    title: body.title || (body.mode === "upload" ? body.title || "Uploaded page" : hostOf(url)),
    mode: body.mode === "upload" ? "upload" : "live",
    snapshot_path: null,
    default_viewport: body.viewport || 1440,
    created_by: profile.name,
    created_by_id: user.id,
    owner_key: newKey(),
    thumbnail_url: null,
    thumbnail_at: null,
    created_at: now,
    updated_at: now,
  };

  const d = await db();
  if (body.mode === "upload" && body.html) {
    review.snapshot_path = `${review.id}/upload.html`;
    await d.putSnapshot(review.snapshot_path, body.html);
  }
  await d.createReview(review);
  await d.updateProject(body.project_id, {});
  return Response.json({ review: publicReview(review, role, user.id) });
});
