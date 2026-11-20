import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import type { SiteCookie, StoredSiteCookies } from "@/lib/types";
import { CookieJar, siteKeyOf } from "./cookies";

/**
 * Where a site's cookie jar lives between proxy requests: one row per
 * (Redline account, site) in the storage adapter. Optionally sealed at rest —
 * with REDLINE_SITE_SESSION_KEY set, what the database holds is
 * `{ enc: base64(iv ‖ ciphertext ‖ tag) }` under AES-256-GCM, so a database
 * dump alone doesn't hand out other people's logins.
 */

const KEY_ENV = "REDLINE_SITE_SESSION_KEY";

function sealingKey(): Buffer | null {
  const raw = process.env[KEY_ENV];
  if (!raw || raw.length < 32) return null;
  return createHash("sha256").update(raw).digest();
}

/** The form the cookies take in storage (sealed when a key is configured). */
export function sealCookies(cookies: SiteCookie[]): StoredSiteCookies {
  const key = sealingKey();
  if (!key) return cookies;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(cookies), "utf8"), cipher.final()]);
  return { enc: Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64") };
}

/**
 * Back to cookies. A sealed jar without the key (or with another key) opens
 * as empty: the review loads, just signed out, rather than failing.
 */
export function openCookies(stored: StoredSiteCookies | null | undefined): SiteCookie[] {
  if (!stored) return [];
  if (Array.isArray(stored)) return stored.filter((c) => c && typeof c.name === "string" && typeof c.value === "string");
  const key = sealingKey();
  if (!key || typeof stored.enc !== "string") return [];
  try {
    const buf = Buffer.from(stored.enc, "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(buf.length - 16);
    const body = buf.subarray(12, buf.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    return openCookies(JSON.parse(json) as SiteCookie[]);
  } catch {
    return [];
  }
}

/** The jar for `host` as seen by `userId`, and when it was last written. */
export async function loadJar(userId: string, host: string): Promise<{ site: string; jar: CookieJar; updatedAt: string | null }> {
  const site = siteKeyOf(host);
  const row = await (await db()).getSiteCookies(userId, site);
  return { site, jar: new CookieJar(openCookies(row?.cookies)), updatedAt: row?.updated_at ?? null };
}

/** Write the jar back when it changed; an empty jar is removed rather than stored. */
export async function saveJar(userId: string, site: string, jar: CookieJar): Promise<void> {
  if (!jar.changed) return;
  const d = await db();
  const cookies = jar.toJSON();
  if (cookies.length === 0) await d.deleteSiteCookies(userId, site);
  else await d.putSiteCookies(userId, site, sealCookies(cookies));
}
