"use client";

import { useEffect } from "react";
import { api } from "./api";
import { useStore } from "./store";

/**
 * What the proxy keeps for this account on the reviewed site (docs/site-sessions.md).
 * `signedIn`: a login landed there — the top bar shows a green pill. `kept`:
 * the jar merely holds cookies (CSRF, consent, a session started on the first
 * GET) — nearly every site; that only shows inside the page menu, where
 * "Forget session" stays reachable.
 */
export interface SiteSessionState {
  site: string;
  signedIn: boolean;
  kept: boolean;
}

/** Re-checks after every frame load, since that is when a login lands. */
export function useSiteSessionSync() {
  const review = useStore((s) => s.review);
  const frameReady = useStore((s) => s.frameReady);
  const frameError = useStore((s) => s.frameError);
  const navigatedAway = useStore((s) => s.navigatedAway);
  const set = useStore((s) => s.set);
  const url = review?.mode === "live" ? navigatedAway || review.url : "";

  useEffect(() => {
    if (!url || (!frameReady && !frameError)) return;
    let alive = true;
    api
      .siteSession(url)
      .then((s) => alive && set({ siteSession: { site: s.site, signedIn: s.signedIn, kept: s.kept } }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url, frameReady, frameError, set]);
}

/** Drop the jar for the reviewed site and reload the page signed out. */
export async function forgetSiteSession() {
  const st = useStore.getState();
  const url = st.navigatedAway || st.review?.url;
  if (!url) return;
  const wasLogin = Boolean(st.siteSession?.signedIn);
  try {
    const { site } = await api.forgetSiteSession(url);
    st.set({ siteSession: { site, signedIn: false, kept: false } });
    st.toast(wasLogin ? `Signed out of ${site} in Redline.` : `Forgot ${site}'s cookies in Redline.`, "success");
    window.dispatchEvent(new CustomEvent("redline:reload"));
  } catch (e) {
    st.toast((e as Error).message, "error");
  }
}
