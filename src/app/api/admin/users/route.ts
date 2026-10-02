import type { NextRequest } from "next/server";
import { guarded } from "@/lib/auth/server";
import { requireAdmin } from "@/lib/admin/auth";
import { listUsers } from "@/lib/admin/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?query=&offset=&limit= — the user list with each account's effective plan. */
export const GET = guarded(async (req: NextRequest) => {
  await requireAdmin();
  const sp = req.nextUrl.searchParams;
  const query = (sp.get("query") || "").slice(0, 80);
  const offset = Math.max(0, Number(sp.get("offset")) || 0);
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 50));
  return Response.json(await listUsers({ query, offset, limit }));
});
