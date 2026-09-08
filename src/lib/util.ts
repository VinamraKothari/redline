import { customAlphabet } from "nanoid";
import { AUTHOR_COLORS } from "./types";

const slugAlphabet = "23456789abcdefghjkmnpqrstuvwxyz";
export const newSlug = customAlphabet(slugAlphabet, 9);
export const newId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 14);
export const newKey = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", 32);

/** Normalise user input into an absolute http(s) URL, or return null. */
export function normalizeUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AUTHOR_COLORS[h % AUTHOR_COLORS.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  const s = Math.max(0, (Date.now() - d) / 1000);
  if (s < 45) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  const days = h / 24;
  if (days < 7) return `${Math.round(days)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
