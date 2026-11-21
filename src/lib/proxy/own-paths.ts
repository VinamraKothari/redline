/**
 * The paths Redline answers itself, in one place for the middleware
 * (src/proxy.ts) and the in-frame bridge (src/bridge/bridge.ts). The bridge is
 * bundled by esbuild, so this module must stay free of Next.js imports.
 *
 * A reviewed page is served from /api/proxy?url=… on Redline's origin and is
 * shown its own path (history.replaceState), so its root-relative requests
 * land here too, and the middleware has to tell the two apart. Pages are
 * matched EXACTLY, route by route: a shop's /account/overview or /p/blue-shirt
 * is not a Redline page, only /account, /account/billing, /p/<slug>, … are.
 * Keep this list in step with the page.tsx files under src/app.
 *
 * Known limits:
 *  - A reviewed page whose address IS one of these routes (a site's /pricing)
 *    keeps its /api/proxy address; Next.js 16 copes (usePathname() still
 *    reads "/pricing" and everything loads). Should a site's router move the
 *    document onto that path itself, its images, fonts and stylesheets still
 *    reach the site through the `redline_site` cookie fallback in
 *    src/proxy.ts, but scripts and /_next/ chunks requested from it look
 *    exactly like Redline's own and stay Redline's.
 *  - There is a single `redline_site` cookie: with two review tabs open on
 *    different sites, a fallback request can be served from the other site.
 */

/** Project, folder and review ids (newSlug() in src/lib/util.ts). */
const SLUG = "[a-z0-9]+";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Every page route of the app (src/app/**\/page.tsx, src/app/(marketing)), plus the generated robots/sitemap. */
const PAGE_ROUTES = [
  "",
  "start",
  "login",
  "pricing",
  "how-it-works",
  "changelog",
  "privacy",
  "terms",
  "imprint",
  "account",
  "account/billing",
  "admin",
  "admin/users",
  `admin/users/${UUID}`,
  "admin/codes",
  "admin/audit",
  `p/${SLUG}`,
  `p/${SLUG}/f/${SLUG}`,
  `r/${SLUG}`,
];

/** Redline's own pages: these go through the sign-in gate, and a request whose Referer is one of them came from Redline. */
export const OWN_PAGE_RE = new RegExp(`^/(?:(?:${PAGE_ROUTES.filter(Boolean).join("|")})/?|robots\\.txt|sitemap\\.xml)?$`);

/**
 * Endpoints and files Redline serves outside its pages: src/app/api,
 * src/app/auth, public/ and the app's metadata files (src/app/favicon.ico).
 * Prefixes here are fine — no reviewed page is served from them.
 */
const OWN_MACHINERY_RE = /^\/(?:api\/|auth\/|bridge\.js$|favicon\.ico$)/;

/** Everything Redline owns outright: a request for one of these never goes to a reviewed site by its path alone. */
export const OWN_PATH_RE = new RegExp(`${OWN_PAGE_RE.source}|${OWN_MACHINERY_RE.source}`);

export function isOwnPage(pathname: string): boolean {
  return OWN_PAGE_RE.test(pathname);
}

export function isOwnPath(pathname: string): boolean {
  return OWN_PATH_RE.test(pathname);
}

/**
 * Paths both sides use: Next.js serves Redline's chunks, CSS and media from
 * /_next/, and a reviewed Next.js site requests its own from the same place.
 * Only the Referer can say whose they are.
 */
export function isSharedPath(pathname: string): boolean {
  return pathname.startsWith("/_next/");
}

/** The two addresses a reviewed page needs from Redline itself: the proxy that carries its requests and the bridge script. */
export function isProxyMachinery(pathname: string): boolean {
  return pathname === "/api/proxy" || pathname.startsWith("/api/proxy/") || pathname === "/bridge.js";
}
