import { guarded, requireUser } from "@/lib/auth/server";
import { figmaConfigured } from "@/lib/figma/fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether this server can talk to Figma (FIGMA_TOKEN set). */
export const GET = guarded(async () => {
  await requireUser();
  return Response.json({ configured: figmaConfigured() });
});
