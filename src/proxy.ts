import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { PROXY_TARGET_HEADER, SITE_COOKIE } from "@/lib/proxy/site-cookie";
import { isOwnPage, isOwnPath, isProxyMachinery, isSharedPath } from "@/lib/proxy/own-paths";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase-config";

/**
 * Two jobs, in one Next.js middleware:
 *
 * 1. Sign-in gate + session refresh for the app's own pages. The Supabase
 *    session lives in cookies; refreshing it here keeps API routes (which
 *    only read cookies) working after the access token expires.
 *
 * 2. Same-origin asset routing for reviewed pages. A proxied page has no
 *    <base>, so its root-relative assets — above all the `/_next/static/…`
 *    chunks a Next.js/Turbopack app registers by the literal `src` attribute —
 *    resolve on *this* origin. Serving them from here keeps the framework's
 *    chunk bookkeeping intact and makes script errors readable. Which site?
 *    The Referer of such a request is the proxy URL of the document, which
 *    names the site; nested ES module imports fall back to the cookie the
 *    proxy sets on every reviewed page. Which paths are Redline's own is
 *    decided in one place, src/lib/proxy/own-paths.ts, shared with the bridge.
 */

/** pages a signed-out visitor may see (the landing page decides what to render) */
const PUBLIC_PAGE = /^\/(?:(?:login|pricing|how-it-works|changelog|privacy|terms|imprint)\/?|robots\.txt|sitemap\.xml)?$/;

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  let site: string | null;
  if (isOwnPath(pathname)) {
    // A reviewed page may keep assets at a path that is also ours (an image
    // from /api/og, a page's own /pricing). Requested by a proxied document
    // they are the site's; Redline's own pages never have that Referer.
    site = isSubresource(req) && !isProxyMachinery(pathname) ? proxiedDocumentSite(req) : null;
    if (!site) return isOwnPage(pathname) ? gate(req) : NextResponse.next();
  } else {
    site = siteFor(req);
    if (!site) {
      const res = NextResponse.next();
      // A page visit to a path Redline has no page for (/account/typo) gets
      // Redline's 404. Its /_next requests must not look like a reviewed
      // page's: with only the origin as Referer they come from "/", one of
      // Redline's own pages, and stay Redline's.
      if (req.headers.get("sec-fetch-dest") === "document") res.headers.set("Referrer-Policy", "origin");
      return res;
    }
  }

  const target = new URL("/api/proxy", req.nextUrl.origin);
  target.searchParams.set("url", site + pathname + search);
  // The route handler may still see the original URL after a rewrite, so the
  // target also travels as a request header.
  const headers = new Headers(req.headers);
  headers.set(PROXY_TARGET_HEADER, site + pathname + search);
  return NextResponse.rewrite(target, { request: { headers } });
}

/* ── 1. auth gate ─────────────────────────────────────────────────────────── */

async function gate(req: NextRequest) {
  const isLogin = req.nextUrl.pathname === "/login";
  const isPublic = PUBLIC_PAGE.test(req.nextUrl.pathname);
  // e2e: a trusted cookie stands in for a Supabase session (never on Vercel)
  if (process.env.REDLINE_TEST_AUTH === "1" && !process.env.VERCEL) {
    const signed = Boolean(req.cookies.get("redline_test_user")?.value);
    if (!signed && !isPublic) return toLogin(req);
    if (signed && isLogin) return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return NextResponse.next();

  let res = NextResponse.next({ request: req });
  const sb = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await sb.auth.getUser();
  const signed = Boolean(data.user);
  if (!signed && !isPublic) return toLogin(req);
  if (signed && isLogin) {
    const next = req.nextUrl.searchParams.get("next");
    return NextResponse.redirect(new URL(next && next.startsWith("/") ? next : "/", req.url));
  }
  return res;
}

function toLogin(req: NextRequest) {
  const url = new URL("/login", req.url);
  const next = req.nextUrl.pathname + req.nextUrl.search;
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

/* ── 2. asset routing ─────────────────────────────────────────────────────── */

/** What a page at one of Redline's routes may fetch from the remembered site: things it shows, never code. */
const FALLBACK_DEST = new Set(["image", "font", "style", "audio", "video", "track", "empty"]);

/** Requests a document makes for what it shows (images, styles, scripts, fetches), as opposed to navigations. */
function isSubresource(req: NextRequest): boolean {
  const dest = req.headers.get("sec-fetch-dest");
  // browsers without Fetch Metadata say nothing: treat it as unknown, not as an asset
  return Boolean(dest) && !["document", "iframe", "frame", "embed", "object"].includes(dest!);
}

/** Same-origin Referer of this request, or null. */
function sameOriginReferer(req: NextRequest): URL | null {
  const ref = req.headers.get("referer");
  if (!ref) return null;
  try {
    const r = new URL(ref);
    return r.host === req.nextUrl.host || r.host === req.headers.get("host") ? r : null;
  } catch {
    return null;
  }
}

/** The site a proxied document belongs to, when that document made this request. */
function proxiedDocumentSite(req: NextRequest): string | null {
  const r = sameOriginReferer(req);
  if (!r || !r.pathname.startsWith("/api/proxy")) return null;
  const u = r.searchParams.get("url");
  try {
    return u ? new URL(u).origin : null;
  } catch {
    return null;
  }
}

/** The reviewed site remembered by the proxy (see SITE_COOKIE). */
function cookieSite(req: NextRequest): string | null {
  const c = req.cookies.get(SITE_COOKIE)?.value;
  if (!c) return null;
  try {
    return new URL(c).origin;
  } catch {
    return null;
  }
}

/** Which reviewed site a request for a path Redline doesn't own outright is meant for, if any. */
function siteFor(req: NextRequest): string | null {
  const r = sameOriginReferer(req);
  if (!r) return null;

  // Requested by a proxied document: the referer names the site.
  if (r.pathname.startsWith("/api/proxy")) return proxiedDocumentSite(req);
  // Requested by one of Redline's stylesheets: ours (fonts and media under
  // /_next/). Turbopack serves them from /_next/static/chunks/*.css. A
  // reviewed site's stylesheets never get here: the proxy rewrites their
  // url()s to proxy URLs.
  if (r.pathname.startsWith("/_next/") && r.pathname.endsWith(".css")) return null;
  if (isOwnPage(r.pathname)) {
    // Redline's pages fetch their chunks, CSS and media from /_next/: ours.
    // Anything else such a page asks for is not something Redline serves —
    // it is a reviewed page that sits at exactly one of our routes (a site's
    // own /pricing) and moved its address there itself (Next.js restores its
    // canonical URL after hydration). Its images, fonts and stylesheets go to
    // the site the proxy remembered; scripts never do, so nothing that runs
    // on this origin is ever fetched on a Referer this weak.
    if (isSharedPath(req.nextUrl.pathname) || !FALLBACK_DEST.has(req.headers.get("sec-fetch-dest") ?? "")) return null;
    return cookieSite(req);
  }
  // Requested by a rewritten site asset (a module importing another): the
  // reviewed site's origin was remembered in a cookie. A page visit never
  // goes to a site on the strength of that cookie.
  if (req.headers.get("sec-fetch-dest") === "document") return null;
  return cookieSite(req);
}

export const config = {
  // everything, including /_next/static — reviewed sites use that path too
  matcher: ["/(.*)"],
};
