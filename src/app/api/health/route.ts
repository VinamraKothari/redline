import { backendInfo } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Deployment health: which storage backend is active. Contains no secrets. */
export async function GET() {
  return Response.json({ ok: true, ...backendInfo(), time: new Date().toISOString() });
}
