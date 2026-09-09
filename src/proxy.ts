import { NextResponse, type NextRequest } from "next/server";
import { PROXY_TARGET_HEADER, SITE_COOKIE } from "@/lib/proxy/site-cookie";

/**
 * Same-origin asset routing for reviewed pages.
 *
 * A proxied page has no <base>, so its root-relative assets — above all the
 * `/_next/static/chunks/*.js` files a Next.js/Turbopack app registers by the
 * literal `src` attribute — resolve on *this* origin. Serving them from here
 * keeps the framework's chunk bookkeeping intact and makes script errors
 * readable (no cross-origin "Script error."). This proxy rewrites such
 * requests, invisibly, to /api/proxy for the reviewed site.
 *
 * Which site? The Referer of a request made by a proxied document is the
 * document's proxy URL, which carries the site. Requests whose referer is a
 * rewritten asset (nested ES module imports) fall back to the cookie the
 * proxy sets on every reviewed page. Redline's own assets are never touched:
 * they are requested from `/` or `/r/…` pages, or from Redline's own CSS.
 */

const OWN_PREFIXES = [
  "/api/proxy",
  "/api/health",
  "/api/reviews",
  "/api/comments",
  "/api/shapes",
  "/api/snapshot",
  "/r/",
  "/bridge.js",
  "/favicon.ico",
];

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname === "/" || OWN_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

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

  // 1. Requested by a proxied document: the referer names the site.
  if (r.pathname.startsWith("/api/proxy")) {
    const u = r.searchParams.get("url");
    try {
      return u ? new URL(u).origin : null;
    } catch {
      return null;
    }
  }
  // 2. Requested by one of Redline's own pages or stylesheets: ours.
  if (r.pathname === "/" || r.pathname.startsWith("/r/") || r.pathname.startsWith("/_next/static/css/")) return null;
  // 3. Requested by a rewritten site asset (e.g. a module importing another):
  //    the reviewed site's origin was remembered in a cookie.
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
