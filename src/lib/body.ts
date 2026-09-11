import type { NextRequest } from "next/server";
import { gunzipSync } from "node:zlib";

/**
 * JSON request body, optionally gzip-compressed by the browser
 * (header `x-redline-gzip: 1`, raw gzip bytes). Big page snapshots travel
 * this way so they stay well under the platform's request-size limit.
 */
export async function readJson<T>(req: NextRequest, maxBytes = 12 * 1024 * 1024): Promise<T | null> {
  try {
    const raw = Buffer.from(await req.arrayBuffer());
    if (raw.byteLength > maxBytes) return null;
    const text = req.headers.get("x-redline-gzip") === "1" ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
