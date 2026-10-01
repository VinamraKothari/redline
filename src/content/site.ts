/** The public origin of the site; the Vercel deployment when nothing else is configured. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://redline-wheat.vercel.app").replace(/\/$/, "");

/** When the legal pages (privacy, terms, imprint) last changed. */
export const LEGAL_UPDATED = "2026-09-30";
