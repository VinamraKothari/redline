"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase-config";

/**
 * Browser-side Supabase client. Sessions are stored in cookies (not
 * localStorage) so the server can read them; the same client also carries
 * the user's JWT on the realtime connection, which is what lets RLS filter
 * the change feed per project member.
 */
let client: SupabaseClient | null = null;
export function supabaseBrowser(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null;
  if (!client) client = createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  return client;
}

export async function signInWithGoogle(next = "/"): Promise<void> {
  const sb = supabaseBrowser();
  if (!sb) throw new Error("Sign-in isn't configured on this deployment.");
  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, queryParams: { prompt: "select_account" } },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const sb = supabaseBrowser();
  await sb?.auth.signOut().catch(() => {});
  await fetch("/api/auth/test", { method: "DELETE" }).catch(() => {});
  window.location.href = "/login";
}
