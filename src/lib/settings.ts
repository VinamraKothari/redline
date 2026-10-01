"use client";

import { categoryOf } from "./figma/categories";
import { useStore } from "./store";
import type { DevMeta, UserSettings } from "./types";

/**
 * Account preferences, client side. The server copy is the truth; a copy in
 * localStorage lets the workspace apply the last known preferences the moment
 * it loads, before the round trip to the server settles.
 */
const CACHE_KEY = "redline:settings";

export function loadCachedSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as UserSettings) : {};
  } catch {
    return {};
  }
}

function cacheSettings(s: UserSettings) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(s));
  } catch {
    /* private mode or full storage — the server copy still applies */
  }
}

/** Bumped by every save, so a slow GET issued before a save can't undo it. */
let version = 0;

async function request(init?: RequestInit): Promise<UserSettings> {
  const res = await fetch("/api/me/settings", { credentials: "same-origin", ...init });
  const data = (await res.json().catch(() => ({}))) as { settings?: UserSettings; error?: string };
  // signed out: whatever the cache holds belongs to a previous session on this browser
  if (res.status === 401) clearCachedSettings();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data.settings ?? {};
}

export function fetchSettings(): Promise<UserSettings> {
  return request();
}

export function saveSettings(settings: UserSettings): Promise<UserSettings> {
  version++;
  return request({ method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(settings) });
}

/** Forget the browser copy — on sign-out, so the next account doesn't start with this one's filters. */
export function clearCachedSettings() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

/** Adopt settings in this tab and remember them for the next load. */
export function applySettings(settings: UserSettings) {
  useStore.getState().setSettings(settings);
  cacheSettings(settings);
}

let loaded = false;
/**
 * Once per page load: apply the cached copy immediately, then reconcile with
 * the server. Safe to call from several components.
 */
export function ensureSettingsLoaded() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  useStore.getState().setSettings(loadCachedSettings());
  const asked = version;
  fetchSettings()
    .then((s) => {
      // a change made while the answer was in flight is newer than the answer
      if (asked === version) applySettings(s);
    })
    .catch(() => {
      /* offline or signed out: the cached copy stays in effect */
    });
}

/**
 * Whether a developer comment passes the account's category and severity
 * choice. A missing list means "everything"; an empty one hides all of that kind.
 */
export function devCommentShown(dev: DevMeta | null | undefined, settings: UserSettings): boolean {
  if (!dev) return true;
  if (settings.devCategories && !settings.devCategories.includes(categoryOf(dev.rule).id)) return false;
  if (settings.devSeverities && !settings.devSeverities.includes(dev.severity)) return false;
  return true;
}
