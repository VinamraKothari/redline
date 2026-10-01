import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded, requireUser } from "@/lib/auth/server";
import { DEV_CATEGORY_IDS, DEV_SEVERITIES } from "@/lib/figma/categories";
import type { UserSettings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in account's preferences (see UserSettings). */
export const GET = guarded(async () => {
  const user = await requireUser();
  const d = await db();
  return Response.json({ settings: await d.getSettings(user.id) });
});

/**
 * Replaces the preferences with the body. Only known keys are kept and each
 * list is reduced to the values the app knows, so a stale client can never
 * store something the current build can't read back.
 */
export const PUT = guarded(async (req: NextRequest) => {
  const user = await requireUser();
  const raw: unknown = await req.json().catch(() => ({}));
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const settings: UserSettings = {};
  const known = (v: unknown, allowed: readonly string[]) =>
    Array.isArray(v) ? allowed.filter((id) => v.includes(id)) : null;
  const categories = known(body.devCategories, DEV_CATEGORY_IDS);
  if (categories) settings.devCategories = categories;
  const severities = known(body.devSeverities, DEV_SEVERITIES.map((s) => s.id));
  if (severities) settings.devSeverities = severities as UserSettings["devSeverities"];
  const d = await db();
  await d.putSettings(user.id, settings);
  return Response.json({ settings });
});
