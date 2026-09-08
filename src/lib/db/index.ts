import type { DbAdapter } from "./adapter";

/** Server-side key: new-style "sb_secret_…" or the legacy service_role JWT. */
export function supabaseSecret(): string | undefined {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function hasSupabase(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && supabaseSecret());
}

let adapter: DbAdapter | null = null;

/** Returns the configured storage adapter (Supabase in production, local file otherwise). */
export async function db(): Promise<DbAdapter> {
  if (adapter) return adapter;
  if (hasSupabase()) {
    adapter = (await import("./supabase")).supabaseDb;
  } else {
    if (process.env.VERCEL) {
      console.warn("[redline] Supabase is not configured; data will not persist between requests.");
    }
    adapter = (await import("./local")).localDb;
  }
  return adapter;
}
