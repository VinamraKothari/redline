import type { MetadataRoute } from "next";
import { CHANGELOG } from "@/content/changelog";
import { LEGAL_UPDATED, SITE_URL } from "@/content/site";

type Frequency = MetadataRoute.Sitemap[number]["changeFrequency"];

/** The product pages change with each release; the legal pages when their text does. */
const RELEASED = new Date(CHANGELOG[0].date);
const LEGAL = new Date(LEGAL_UPDATED);

const PAGES: { path: string; priority: number; changeFrequency: Frequency; lastModified: Date }[] = [
  { path: "/", priority: 1, changeFrequency: "weekly", lastModified: RELEASED },
  { path: "/how-it-works", priority: 0.8, changeFrequency: "monthly", lastModified: RELEASED },
  { path: "/pricing", priority: 0.9, changeFrequency: "monthly", lastModified: RELEASED },
  { path: "/changelog", priority: 0.6, changeFrequency: "weekly", lastModified: RELEASED },
  { path: "/privacy", priority: 0.2, changeFrequency: "yearly", lastModified: LEGAL },
  { path: "/terms", priority: 0.2, changeFrequency: "yearly", lastModified: LEGAL },
  { path: "/imprint", priority: 0.2, changeFrequency: "yearly", lastModified: LEGAL },
];

/** Only the marketing pages: reviews and projects are private. */
export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((p) => ({ url: `${SITE_URL}${p.path}`, lastModified: p.lastModified, changeFrequency: p.changeFrequency, priority: p.priority }));
}
