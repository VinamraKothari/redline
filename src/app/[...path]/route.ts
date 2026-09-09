import { notFound } from "next/navigation";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Catch-all for requests a proxied page makes to *our* origin by accident.
 *
 * The bridge routes fetch()/XHR/dynamic <script> through the proxy, but ES
 * module `import "/assets/x.js"` statements resolve against the importing
 * module's URL (a proxy URL on this origin) and can't be intercepted. The
 * Referer of such a request is the proxy URL of the importer, which tells us
 * the site — so we bounce the request to the proxy for that site.
 */
export async function GET(req: NextRequest) {
  const site = siteFromReferer(req.headers.get("referer"));
  if (!site) notFound();
  const target = site + req.nextUrl.pathname + req.nextUrl.search;
  // relative Location: resolved by the browser against our real public origin
  return new Response(null, {
    status: 302,
    headers: { location: `/api/proxy?url=${encodeURIComponent(target)}`, "cache-control": "no-store" },
  });
}

function siteFromReferer(ref: string | null): string | null {
  if (!ref) return null;
  try {
    const r = new URL(ref);
    if (!r.pathname.startsWith("/api/proxy")) return null;
    const u = r.searchParams.get("url");
    return u ? new URL(u).origin : null;
  } catch {
    return null;
  }
}
