/** Cookie naming the reviewed site's origin, set on every proxied page (see src/proxy.ts). */
export const SITE_COOKIE = "redline_site";
/** Request header carrying the rewritten target URL from src/proxy.ts to the proxy route. */
export const PROXY_TARGET_HEADER = "x-redline-proxy-url";
