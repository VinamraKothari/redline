import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseSecret } from "@/lib/db";
import type { TextEdit } from "@/lib/types";

/**
 * Undo tokens for "Reset to original" and "Restore all" (server only).
 *
 * The DELETE routes hand back, with every row they delete, a token that
 * carries the row itself, the review it belongs to and an expiry, signed with
 * a server key. The restore route re-inserts only rows that come with a valid
 * token — so an undo can bring back exactly what was deleted (same id,
 * author, times and status), and nobody can use it to create an edit
 * attributed to someone else or dated whenever they like.
 *
 * Key: REDLINE_UNDO_KEY, else derived from the Supabase secret or the
 * site-session key; local development falls back to a fixed key (the local
 * JSON store is not for production anyway).
 */

const TTL_MS = 24 * 60 * 60 * 1000;
const DEV_KEY = "redline-local-development-undo-key";

function key(): Buffer {
  const raw = process.env.REDLINE_UNDO_KEY || supabaseSecret() || process.env.REDLINE_SITE_SESSION_KEY || DEV_KEY;
  // a key of its own, whatever secret it comes from
  return createHmac("sha256", raw).update("redline:text-edit-undo:v1").digest();
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (payload: string) => createHmac("sha256", key()).update(payload).digest();

interface Payload {
  v: 1;
  /** review id */
  r: string;
  /** expiry, epoch ms */
  x: number;
  e: TextEdit;
}

/** A token that lets `row` be restored into its review for the next 24 hours. */
export function signUndo(row: TextEdit, now = Date.now()): string {
  const payload = b64(JSON.stringify({ v: 1, r: row.review_id, x: now + TTL_MS, e: row } satisfies Payload));
  return `${payload}.${b64(mac(payload))}`;
}

/** The row a token restores into `reviewId`, or null when it is forged, altered, expired or for another page. */
export function readUndo(token: unknown, reviewId: string, now = Date.now()): TextEdit | null {
  if (typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sent = Buffer.from(token.slice(dot + 1), "base64url");
  const want = mac(payload);
  if (sent.length !== want.length || !timingSafeEqual(sent, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Payload;
    if (p.v !== 1 || p.r !== reviewId || !(p.x > now) || !p.e || p.e.review_id !== reviewId) return null;
    return p.e;
  } catch {
    return null;
  }
}
