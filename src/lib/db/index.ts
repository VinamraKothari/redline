import type { DbAdapter } from "./adapter";
import { SUPABASE_URL } from "@/lib/supabase-config";

/** Server-side key: new-style "sb_secret_…" or the legacy service_role JWT. */
export function supabaseSecret(): string | undefined {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function hasSupabase(): boolean {
  return Boolean(SUPABASE_URL && supabaseSecret());
}

/** Which backend is active — for the /api/health endpoint. Never exposes values. */
export function backendInfo() {
  return {
    backend: hasSupabase() ? "supabase" : "local-file",
    supabaseUrlConfigured: Boolean(SUPABASE_URL),
    secretKeyConfigured: Boolean(supabaseSecret()),
    vercel: Boolean(process.env.VERCEL),
  };
}

let adapter: DbAdapter | null = null;

/** Returns the configured storage adapter (Supabase in production, local file otherwise). */
export async function db(): Promise<DbAdapter> {
  if (adapter) return adapter;
  if (hasSupabase()) {
    adapter = (await import("./supabase")).supabaseDb;
  } else {
    if (process.env.VERCEL) {
      // Serverless filesystems are read-only: fail loudly instead of a cryptic ENOENT.
      throw new Error(
        "Storage is not configured on this deployment. Set SUPABASE_SECRET_KEY in the hosting environment (see README → Supabase setup).",
      );
    }
    adapter = (await import("./local")).localDb;
  }
  return adapter;
}
