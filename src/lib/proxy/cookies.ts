import type { SiteCookie } from "@/lib/types";

/**
 * A cookie jar for reviewed sites, so a page behind a login can be reviewed:
 * the person signs in once in Browse mode, the proxy keeps the site's cookies
 * for their Redline account, and every later request to that site carries
 * them. The browser itself never sees the site's cookies — they would land on
 * Redline's origin, shared between every site anyone reviews.
 *
 * Matching follows RFC 6265 (host-only vs. domain cookies, path prefixes,
 * `Secure` only over https, expiry). Pure functions + a small class; storage
 * is in ./sessions.ts.
 */

/** Hosts whose subdomains belong to unrelated people: a session on one must never reach another. */
const PUBLIC_SUFFIXES = new Set([
  "vercel.app",
  "netlify.app",
  "github.io",
  "pages.dev",
  "herokuapp.com",
  "web.app",
  "firebaseapp.com",
  "azurewebsites.net",
  "cloudfront.net",
  "amazonaws.com",
]);
/** second-level labels under which the registrable domain takes three labels (example.co.uk) */
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);

/**
 * The "site" a host belongs to — the key of its cookie jar. The registrable
 * domain in the common case (`shop.example.com` → `example.com`,
 * `shop.example.co.uk` → `example.co.uk`); the full host on hosting
 * platforms where every subdomain is somebody else's site, and for
 * localhost / IP addresses.
 */
export function siteKeyOf(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h.includes(".") || /^[\d.]+$/.test(h) || h.includes(":")) return h;
  const labels = h.split(".");
  if (labels.length >= 2 && PUBLIC_SUFFIXES.has(labels.slice(-2).join("."))) return h;
  if (labels.length >= 3 && SECOND_LEVEL.has(labels[labels.length - 2])) return labels.slice(-3).join(".");
  return labels.slice(-2).join(".");
}

/** RFC 6265 §5.1.3: the host is the domain, or a subdomain of it. */
export function domainMatches(host: string, domain: string): boolean {
  return host === domain || (host.endsWith("." + domain) && !/^[\d.]+$/.test(host));
}

/** RFC 6265 §5.1.4 */
function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
}

/** RFC 6265 §5.1.4: the default path of a cookie set without a Path attribute. */
function defaultPath(url: URL): string {
  const p = url.pathname;
  if (!p.startsWith("/") || p.lastIndexOf("/") === 0) return "/";
  return p.slice(0, p.lastIndexOf("/"));
}

export const MAX_COOKIES = 150;
export const MAX_VALUE_BYTES = 4096;

/**
 * Parse one `Set-Cookie` header received from `url`. Returns null when the
 * cookie must be ignored (malformed, for another domain, a public suffix,
 * too large). A cookie with an empty value or `Max-Age=0` comes back with
 * `expires` in the past — storing it deletes the previous value, as the
 * site intends.
 */
export function parseSetCookie(header: string, url: URL, now = Date.now()): SiteCookie | null {
  const parts = header.split(";");
  const first = parts.shift() ?? "";
  const eq = first.indexOf("=");
  if (eq <= 0) return null;
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();
  if (!name || Buffer.byteLength(value) > MAX_VALUE_BYTES) return null;

  const host = url.hostname.toLowerCase();
  let domain = host;
  let hostOnly = true;
  let path = defaultPath(url);
  let expires: number | null = null;
  let secure = false;
  let httpOnly = false;
  let maxAge: number | null = null;
  for (const raw of parts) {
    const i = raw.indexOf("=");
    const k = (i < 0 ? raw : raw.slice(0, i)).trim().toLowerCase();
    const v = i < 0 ? "" : raw.slice(i + 1).trim();
    if (k === "domain" && v) {
      const d = v.replace(/^\./, "").toLowerCase();
      // §5.3 step 6: a Domain the request host doesn't belong to is ignored; a
      // public suffix would let one tenant's cookie reach every other tenant.
      if (!domainMatches(host, d) || PUBLIC_SUFFIXES.has(d) || siteKeyOf(d) !== siteKeyOf(host)) return null;
      domain = d;
      hostOnly = false;
    } else if (k === "path" && v.startsWith("/")) path = v;
    else if (k === "max-age" && /^-?\d+$/.test(v)) maxAge = Number(v);
    else if (k === "expires" && v) {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) expires = t;
    } else if (k === "secure") secure = true;
    else if (k === "httponly") httpOnly = true;
  }
  // Max-Age wins over Expires (§5.3 step 3)
  if (maxAge !== null) expires = maxAge <= 0 ? 0 : now + maxAge * 1000;
  if (value === "") expires = 0;
  return { name, value, domain, hostOnly, path, expires, secure, httpOnly };
}

/** All `Set-Cookie` headers of a response, on runtimes with and without `getSetCookie()`. */
export function setCookiesOf(headers: Headers): string[] {
  const h = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === "function") return h.getSetCookie();
  const joined = headers.get("set-cookie");
  // Expires dates contain a comma ("Wed, 21 Oct …"), so split only before "name="
  return joined ? joined.split(/,(?=\s*[^;,]+=)/).map((s) => s.trim()) : [];
}

const alive = (c: SiteCookie, now: number) => c.expires === null || c.expires > now;
const keyOf = (c: SiteCookie) => `${c.name}\u0000${c.domain}\u0000${c.path}`;

/** The cookies of one (account, site) pair, kept in memory for the length of a proxy request. */
export class CookieJar {
  private cookies = new Map<string, SiteCookie>();
  /** something was set or deleted — the jar needs persisting */
  changed = false;

  constructor(cookies: SiteCookie[] = [], private now = Date.now()) {
    for (const c of cookies) if (alive(c, now)) this.cookies.set(keyOf(c), c);
    // dropping expired cookies on read is a change worth writing back
    if (this.cookies.size !== cookies.length) this.changed = true;
  }

  /**
   * Take the cookies a response from `url` sets. `write` marks them as set by
   * a POST/PUT/… (or a redirect following one) — see SiteCookie.auth; a
   * cookie that already counted as a session keeps counting when a GET
   * refreshes it.
   */
  store(headers: Headers, url: URL, write = false) {
    for (const h of setCookiesOf(headers)) {
      const c = parseSetCookie(h, url, this.now);
      if (!c) continue;
      const k = keyOf(c);
      if (!alive(c, this.now)) {
        if (this.cookies.delete(k)) this.changed = true;
        continue;
      }
      if (write || this.cookies.get(k)?.auth) c.auth = true;
      this.cookies.set(k, c);
      this.changed = true;
    }
    // the oldest-expiring cookies go first when the cap is hit; session
    // cookies (no expiry) are the ones a login needs, so they stay
    while (this.cookies.size > MAX_COOKIES) {
      const victim = [...this.cookies.values()].sort((a, b) => (a.expires ?? Infinity) - (b.expires ?? Infinity))[0];
      this.cookies.delete(keyOf(victim));
    }
  }

  /** The cookies to send to `url`, most specific path first (§5.4). */
  matching(url: URL): SiteCookie[] {
    const host = url.hostname.toLowerCase();
    const https = url.protocol === "https:";
    const path = url.pathname || "/";
    return [...this.cookies.values()]
      .filter((c) => alive(c, this.now))
      .filter((c) => (c.hostOnly ? c.domain === host : domainMatches(host, c.domain)))
      .filter((c) => pathMatches(path, c.path))
      .filter((c) => !c.secure || https)
      .sort((a, b) => b.path.length - a.path.length);
  }

  /**
   * `cookie` request header for `url`: the jar's cookies first, then the
   * site's own cookies from the browser's request (`browserCookies`, the
   * incoming Cookie header — set by the page through document.cookie, never
   * Redline's) unless the jar has a cookie of that name. Empty when nothing
   * matches.
   */
  headerFor(url: URL, browserCookies: string | null = null): string {
    const own = this.matching(url);
    const extra = browserCookiesFor(browserCookies, new Set(own.map((c) => c.name)));
    return [own.map((c) => `${c.name}=${c.value}`).join("; "), extra].filter(Boolean).join("; ");
  }

  get size(): number {
    return [...this.cookies.values()].filter((c) => alive(c, this.now)).length;
  }

  /** a live cookie that a write set: someone signed in here */
  get signedIn(): boolean {
    return [...this.cookies.values()].some((c) => c.auth && alive(c, this.now));
  }

  toJSON(): SiteCookie[] {
    return [...this.cookies.values()].filter((c) => alive(c, this.now));
  }
}

/** Request cookies that are the site's own (set by the page via document.cookie), never Redline's. */
export function browserCookiesFor(cookieHeader: string | null, exclude: Set<string>): string {
  if (!cookieHeader) return "";
  return cookieHeader
    .split(";")
    .map((s) => s.trim())
    .filter((s) => {
      const name = s.slice(0, s.indexOf("=") < 0 ? s.length : s.indexOf("="));
      return name && !/^(sb-|redline_|__Host-redline)/.test(name) && !exclude.has(name);
    })
    .join("; ");
}
