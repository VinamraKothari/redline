/** Hosts the server must never fetch or render on someone's behalf (SSRF guard). */
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  // Test-only escape hatch so local fixtures can be proxied in CI.
  if (process.env.REDLINE_ALLOW_LOCAL === "1" && (h === "localhost" || h === "127.0.0.1")) return false;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (/^127\.|^10\.|^0\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === "::1" || h.startsWith("[::1]") || h.startsWith("fc") || h.startsWith("fd")) return true;
  return false;
}

/** True when `url` is an http(s) URL on a host we may fetch. */
export function fetchableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && !isBlockedHost(u.hostname);
  } catch {
    return false;
  }
}
