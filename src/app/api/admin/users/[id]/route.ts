import type { NextRequest } from "next/server";
import { guarded } from "@/lib/auth/server";
import { requireAdmin } from "@/lib/admin/auth";
import { userDetail } from "@/lib/admin/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Everything the admin area shows about one account. */
export const GET = guarded(async (_req: NextRequest, ctx: RouteContext<"/api/admin/users/[id]">) => {
  await requireAdmin();
  const { id } = await ctx.params;
  return Response.json(await userDetail(id));
});
