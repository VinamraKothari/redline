import { currentUser, guarded, syncProfile } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in profile (created/updated on the fly, pending invites claimed). */
export const GET = guarded(async () => {
  const u = await currentUser();
  if (!u) return Response.json({ user: null }, { status: 401 });
  const profile = await syncProfile(u);
  return Response.json({ user: profile });
});
