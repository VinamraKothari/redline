import { guarded } from "@/lib/auth/server";
import { requireAdmin } from "@/lib/admin/auth";
import { stats } from "@/lib/admin/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The overview tiles: accounts, who pays, grants, projects, pages, Figma runs this month, MRR. */
export const GET = guarded(async () => {
  await requireAdmin();
  return Response.json(await stats());
});
