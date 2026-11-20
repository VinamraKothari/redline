import { isBlockedHost } from "@/lib/proxy/hosts";
import type { NextRequest } from "next/server";
import { decodeBody, detectCharset, rewriteCss, rewriteHtml } from "@/lib/proxy/rewrite";
import { PROXY_TARGET_HEADER, SITE_COOKIE } from "@/lib/proxy/site-cookie";
import type { CookieJar } from "@/lib/proxy/cookies";
import { loadJar, saveJar } from "@/lib/proxy/sessions";
import { currentUser } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_HOPS = 10;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/** Public origin of this deployment (respects Vercel's forwarded headers). */
function appOriginOf(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

function errorPage(status: number, title: string, detail: string, url: string): Response {
  const html = `<!doctype html><html data-redline-error="1"><head><meta charset="utf-8"><title>${title}</title>
<style>body{margin:0;font:14px/1.5 system-ui,sans-serif;color:#1c1b18;background:#fff;display:grid;place-items:center;height:100vh}
.b{max-width:440px;padding:32px;text-align:center}h1{font-size:16px;margin:0 0 8px}p{color:#5f5b52;margin:0 0 6px}code{font:12px ui-monospace,monospace;color:#9a958a;word-break:break-all}</style></head>
<body><div class="b"><h1>${title}</h1><p>${detail}</p><code>${url.replace(/</g, "&lt;")}</code></div></body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-redline-error": "1" },
  });
}

/**
 * Every method goes through here. Reviewed sites call their own APIs with
 * POST (search, cart, GraphQL…) as much as with GET; the bridge routes them
 * all to the proxy so they stay same-origin instead of dying on CORS.
 */
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;

async function handle(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url") || req.headers.get(PROXY_TARGET_HEADER);
  if (!target) return new Response("missing url", { status: 400 });
  // Members only — otherwise this would be an open proxy.
  const user = await currentUser();
  if (!user) return errorPage(401, "Please sign in", "Your Redline session has expired. Reload to sign in again.", target);

  let u: URL;
  try {
    u = new URL(target);
  } catch {
    return errorPage(400, "That doesn't look like a URL", "Check the address and try again.", target);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return errorPage(400, "Unsupported protocol", "Only http and https pages can be loaded.", target);
  }
  if (isBlockedHost(u.hostname)) {
    return errorPage(403, "This address can't be loaded", "Local and private network addresses are blocked.", target);
  }
  // A link on another site pointing at /api/proxy?url=https://shop/account/delete
  // would ride on the reviewer's Redline session *and* their jar for the shop.
  // Everything legitimate — the frame, the bridge's fetches, the app — is
  // same-origin; a cross-site navigation here is nobody's review. `same-site`
  // is deliberately still allowed (Redline has no sibling apps on its domain
  // today); the day it does, allow only same-origin / none / absent.
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return errorPage(403, "This page can only be opened from Redline", "Open the review in Redline instead of following a link to it.", target);
  }

  // The site's cookies for this account — a login made in Browse mode lives
  // here, never in the browser (where it would sit on Redline's origin).
  const { site, jar } = await loadJar(user.id, u.hostname);
  try {
    return await fetchThrough(req, u, target, jar);
  } finally {
    // one write per request, and only when a response set or cleared something
    await saveJar(user.id, site, jar).catch((e) => console.warn("[redline] site session not saved:", (e as Error).message));
  }
}

const REDIRECT = new Set([301, 302, 303, 307, 308]);

async function fetchThrough(req: NextRequest, u: URL, target: string, jar: CookieJar): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  const accept = req.headers.get("accept") || "";
  const wantsDocument = /text\/html/i.test(accept) || !accept;
  const baseHeaders: Record<string, string> = {
    "user-agent": UA,
    accept: accept || "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": req.headers.get("accept-language") || "en-US,en;q=0.9",
    "cache-control": "no-cache",
  };
  if (wantsDocument) {
    // some CDNs vary on these
    baseHeaders["sec-fetch-dest"] = "document";
    baseHeaders["sec-fetch-mode"] = "navigate";
    baseHeaders["sec-fetch-site"] = "none";
    baseHeaders["upgrade-insecure-requests"] = "1";
  }
  // Framework data requests (Next.js RSC / router prefetch), API calls and
  // form posts need their own headers — but never our cookies, and never the
  // hop-by-hop x-forwarded-* family: it names Redline's host and the
  // reviewer's IP, and a self-hosted Next.js compares Origin with
  // x-forwarded-host before running a Server Action.
  req.headers.forEach((v, k) => {
    if (/^(rsc|next-.*|x-requested-with|x-[\w-]+|content-type|authorization|accept-encoding)$/i.test(k) && !/^x-(forwarded-|real-ip|vercel-|middleware-|invoke-|redline)/i.test(k)) baseHeaders[k] = v;
  });
  let method = req.method.toUpperCase();
  const write = !["GET", "HEAD", "OPTIONS"].includes(method);
  let body: ArrayBuffer | undefined = write ? await req.arrayBuffer() : undefined;

  // Cookies the page set itself through document.cookie arrive with the
  // request on our origin; forward the site's own, never Redline's.
  const browserCookies = req.headers.get("cookie");
  // once cookies went upstream the answer may be personal: never cache it at the edge
  let sentCookies = false;

  /** Request headers for one hop: the jar's cookies for that URL and, for writes, an Origin the site's CSRF check accepts. */
  const headersFor = (cur: URL): Record<string, string> => {
    const h = { ...baseHeaders };
    if (method === "GET" || method === "HEAD") {
      delete h["content-type"];
    } else {
      // Next.js Server Actions and most CSRF checks compare Origin with Host
      h.origin = cur.origin;
      h.referer = cur.origin + "/";
      if (wantsDocument) h["sec-fetch-site"] = "same-origin";
    }
    const cookie = jar.headerFor(cur, browserCookies);
    if (cookie) {
      h.cookie = cookie;
      sentCookies = true;
    }
    return h;
  };

  // Redirects are followed by hand: fetch's own "follow" discards the
  // Set-Cookie of every intermediate response, and a login's session cookie
  // arrives on exactly such a 302.
  let cur = u;
  let res: Response;
  let hops = 0;
  for (;;) {
    try {
      res = await fetch(cur.toString(), { method, body, redirect: "manual", signal: ctrl.signal, headers: headersFor(cur) });
    } catch (e) {
      clearTimeout(timer);
      const aborted = (e as Error).name === "AbortError";
      return errorPage(
        504,
        aborted ? "The page took too long to respond" : "The page couldn't be reached",
        aborted ? "It didn't answer within 20 seconds. Try again, or upload the page as an HTML file." : String((e as Error).message),
        target,
      );
    }
    // a login that failed (401 "wrong password") refreshes its CSRF cookie too — that is not a session
    jar.store(res.headers, cur, write && res.status < 400);
    const location = res.headers.get("location");
    if (!REDIRECT.has(res.status) || !location) break;
    if (++hops > MAX_HOPS) {
      clearTimeout(timer);
      return errorPage(502, "Too many redirects", "The site kept redirecting without arriving anywhere.", cur.toString());
    }
    let next: URL;
    try {
      next = new URL(location, cur);
    } catch {
      break;
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      clearTimeout(timer);
      return errorPage(400, "Unsupported protocol", "The site redirected to an address that isn't a web page.", next.toString());
    }
    if (isBlockedHost(next.hostname)) {
      clearTimeout(timer);
      return errorPage(403, "This address can't be loaded", "The site redirected to a local or private network address.", next.toString());
    }
    // 303 always becomes a GET; 301/302 do for anything but GET/HEAD (what
    // browsers do); 307/308 keep method and body.
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method !== "GET" && method !== "HEAD")) {
      method = "GET";
      body = undefined;
    }
    // the response body of a redirect is noise; release the connection
    await res.arrayBuffer().catch(() => {});
    cur = next;
  }
  clearTimeout(timer);

  const ct = res.headers.get("content-type") || "";
  const finalUrl = cur.toString();
  const appOrigin = appOriginOf(req);

  // Read with a size cap.
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) {
    return errorPage(413, "The page is too large", "Redline loads pages up to 8 MB.", target);
  }

  const isHtml = /text\/html|application\/xhtml/i.test(ct) || (!ct && /<html/i.test(new TextDecoder().decode(buf.subarray(0, 2048))));
  const isCss = /text\/css/i.test(ct) || (!ct && /\.css(\?|$)/i.test(u.pathname));

  // Upstream Set-Cookie headers never reach the browser: they are in the jar
  // now, and on our origin they would leak between reviewed sites.
  if (isHtml) {
    if (!res.ok && res.status >= 400) {
      const status = res.status;
      // A 401/403 that answers a form post, or that carries a login form of
      // its own ("Wrong password"), is the site talking to the person — show
      // it. A bare refusal gets our explanation instead.
      const siteSpeaks = (status === 401 || status === 403) && (req.method.toUpperCase() !== "GET" || /<input[^>]+type=["']?password/i.test(new TextDecoder().decode(buf)));
      if (!siteSpeaks) {
        const refused = status === 403 || status === 401;
        return errorPage(
          status,
          refused ? "The site refused the request" : `The site returned ${status}`,
          !refused
            ? "The server returned an error for this address."
            : jar.signedIn
              ? `You are signed in to ${u.hostname} in Redline, but it still refused this page — it may need a different account or be bot-protected. You can also upload the page as an HTML file.`
              : "It may be behind a login. Switch to <em>Browse the page</em> and sign in there — Redline keeps that session for you. If it keeps refusing (bot protection), upload the page as an HTML file instead.",
          finalUrl,
        );
      }
    }
    const charset = detectCharset(ct, buf);
    const html = decodeBody(buf, charset);
    const stripScripts = req.nextUrl.searchParams.get("js") === "0";
    const out = rewriteHtml(html, { finalUrl, requestedUrl: u.toString(), appOrigin, stripScripts });
    const resHeaders = new Headers({
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-redline-final-url": encodeURIComponent(finalUrl),
      "content-security-policy": "frame-ancestors 'self'",
    });
    // Remembered for same-origin asset routing when the Referer can't tell
    // us the site (nested ES module imports) — see src/proxy.ts.
    resHeaders.append("set-cookie", `${SITE_COOKIE}=${encodeURIComponent(new URL(finalUrl).origin)}; Path=/; SameSite=Lax; Max-Age=86400`);
    return new Response(out, { status: 200, headers: resHeaders });
  }

  if (isCss) {
    const css = decodeBody(buf, detectCharset(ct, buf));
    return new Response(rewriteCss(css, finalUrl, appOrigin), {
      status: res.status,
      headers: {
        "content-type": "text/css; charset=utf-8",
        "cache-control": sentCookies ? "private, no-store" : "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  }

  // Passthrough: scripts, fonts, images, JSON/API data, framework payloads…
  // Only immutable-ish static assets are cached at the edge, and only when
  // they were fetched anonymously — an avatar fetched with someone's session
  // must not become everyone's; data stays live.
  const isStatic = res.ok && !sentCookies && /javascript|ecmascript|font|image\/|css|wasm|svg/i.test(ct);
  const headers = new Headers();
  headers.set("content-type", ct || "application/octet-stream");
  headers.set("cache-control", isStatic ? "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" : sentCookies ? "private, no-store" : "no-store");
  headers.set("access-control-allow-origin", "*");
  return new Response(buf, { status: res.status, headers });
}
