import { isBlockedHost } from "@/lib/proxy/hosts";
import type { NextRequest } from "next/server";
import { decodeBody, detectCharset, rewriteCss, rewriteHtml } from "@/lib/proxy/rewrite";
import { PROXY_TARGET_HEADER, SITE_COOKIE } from "@/lib/proxy/site-cookie";
import { currentUser } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

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
  if (!(await currentUser())) return errorPage(401, "Please sign in", "Your Redline session has expired. Reload to sign in again.", target);

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

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  const accept = req.headers.get("accept") || "";
  const wantsDocument = /text\/html/i.test(accept) || !accept;
  const upstreamHeaders: Record<string, string> = {
    "user-agent": UA,
    accept: accept || "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": req.headers.get("accept-language") || "en-US,en;q=0.9",
    "cache-control": "no-cache",
  };
  if (wantsDocument) {
    // some CDNs vary on these
    upstreamHeaders["sec-fetch-dest"] = "document";
    upstreamHeaders["sec-fetch-mode"] = "navigate";
    upstreamHeaders["sec-fetch-site"] = "none";
    upstreamHeaders["upgrade-insecure-requests"] = "1";
  }
  // Framework data requests (Next.js RSC / router prefetch), API calls and
  // form posts need their own headers — but never our cookies.
  req.headers.forEach((v, k) => {
    if (/^(rsc|next-.*|x-requested-with|x-[\w-]+|content-type|authorization|accept-encoding)$/i.test(k) && !/^x-redline/i.test(k)) upstreamHeaders[k] = v;
  });
  const method = req.method.toUpperCase();
  const hasBody = !["GET", "HEAD", "OPTIONS"].includes(method);
  const body = hasBody ? await req.arrayBuffer() : undefined;

  let res: Response;
  try {
    res = await fetch(u.toString(), { method, body, redirect: "follow", signal: ctrl.signal, headers: upstreamHeaders });
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
  clearTimeout(timer);

  const ct = res.headers.get("content-type") || "";
  const finalUrl = res.url || u.toString();
  const appOrigin = appOriginOf(req);

  // Read with a size cap.
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) {
    return errorPage(413, "The page is too large", "Redline loads pages up to 8 MB.", target);
  }

  const isHtml = /text\/html|application\/xhtml/i.test(ct) || (!ct && /<html/i.test(new TextDecoder().decode(buf.subarray(0, 2048))));
  const isCss = /text\/css/i.test(ct) || (!ct && /\.css(\?|$)/i.test(u.pathname));

  if (isHtml) {
    if (!res.ok && res.status >= 400) {
      const status = res.status;
      return errorPage(
        status,
        status === 403 || status === 401 ? "The site refused the request" : `The site returned ${status}`,
        status === 403
          ? "It may be behind a login or bot protection. Try uploading the page as an HTML file instead."
          : "The server returned an error for this address.",
        finalUrl,
      );
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
        "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  }

  // Passthrough: scripts, fonts, images, JSON/API data, framework payloads…
  // Only immutable-ish static assets are cached at the edge; data stays live.
  const isStatic = res.ok && /javascript|ecmascript|font|image\/|css|wasm|svg/i.test(ct);
  const headers = new Headers();
  headers.set("content-type", ct || "application/octet-stream");
  headers.set("cache-control", isStatic ? "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" : "no-store");
  headers.set("access-control-allow-origin", "*");
  return new Response(buf, { status: res.status, headers });
}
