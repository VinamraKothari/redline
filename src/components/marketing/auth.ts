"use client";

import { useEffect, useState } from "react";
import { signInWithGoogle } from "@/lib/auth/client";

/**
 * Starts Google sign-in from a marketing page and lands on `next` afterwards.
 * When sign-in isn't configured (a local run without Supabase) the login page
 * shows the reason instead of a silent failure.
 */
export async function startSignIn(next = "/"): Promise<void> {
  try {
    await signInWithGoogle(next);
  } catch (e) {
    const params = new URLSearchParams({ next, error: (e as Error).message });
    // a full navigation on purpose: this runs outside any component, and the
    // login page is server-rendered with the error in its query string
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/login?${params}`);
  }
}

/** One `/api/me` request per page load, shared by every component that asks. */
let sessionCheck: Promise<boolean> | null = null;
function checkSession(): Promise<boolean> {
  sessionCheck ??= fetch("/api/me", { cache: "no-store" })
    .then((r) => r.ok)
    .catch(() => false);
  return sessionCheck;
}

/**
 * Whether the visitor has a session — `null` until we know. A 401 simply
 * means signed out, so the pricing buttons can go straight to checkout for
 * members and through sign-in for everyone else.
 */
export function useSignedIn(): boolean | null {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void checkSession().then((ok) => !cancelled && setSignedIn(ok));
    return () => {
      cancelled = true;
    };
  }, []);
  return signedIn;
}
