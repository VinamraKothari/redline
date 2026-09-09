import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { PROXY_TARGET_HEADER, SITE_COOKIE } from "@/lib/proxy/site-cookie";
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
 *    proxy sets on every reviewed page.
 */

const PAGE = /^\/(?:$|p\/|r\/|start$|login$)/;
/** pages a signed-out visitor may see (the landing page decides what to render) */
const PUBLIC_PAGE = /^\/(?:$|login$)/;
const OWN_PREFIXES = [
  "/api/",
  "/auth/",
  "/r/",
  "/p/",
  "/start",
  "/login",
  "/bridge.js",
  "/favicon.ico",
];

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (PAGE.test(pathname)) return gate(req);
  if (OWN_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const site = siteFor(req);
  if (!site) return NextResponse.next();

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

function siteFor(req: NextRequest): string | null {
  const ref = req.headers.get("referer");
  if (!ref) return null;
  let r: URL;
  try {
    r = new URL(ref);
  } catch {
    return null;
  }
  if (r.host !== req.nextUrl.host && r.host !== req.headers.get("host")) return null;

  // Requested by a proxied document: the referer names the site.
  if (r.pathname.startsWith("/api/proxy")) {
    const u = r.searchParams.get("url");
    try {
      return u ? new URL(u).origin : null;
    } catch {
      return null;
    }
  }
  // Requested by one of Redline's own pages or stylesheets: ours.
  if (PAGE.test(r.pathname) || r.pathname.startsWith("/_next/static/css/")) return null;
  // Requested by a rewritten site asset (a module importing another): the
  // reviewed site's origin was remembered in a cookie.
  const c = req.cookies.get(SITE_COOKIE)?.value;
  if (!c) return null;
  try {
    return new URL(c).origin;
  } catch {
    return null;
  }
}

export const config = {
  // everything, including /_next/static — reviewed sites use that path too
  matcher: ["/(.*)"],
};
