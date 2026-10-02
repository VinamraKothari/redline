import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guarded } from "@/lib/auth/server";
import { requireAdmin } from "@/lib/admin/auth";
import { withProfiles } from "@/lib/admin/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?target=<user id>&limit= — the audit log, newest first, with actor and target profiles. */
export const GET = guarded(async (req: NextRequest) => {
  await requireAdmin();
  const sp = req.nextUrl.searchParams;
  const target = sp.get("target") || undefined;
  const limit = Math.min(500, Math.max(1, Number(sp.get("limit")) || 100));
  const entries = await (await db()).listAudit({ limit, targetUserId: target });
  return Response.json({ entries: await withProfiles(entries) });
});
