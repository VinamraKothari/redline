import type { MetadataRoute } from "next";
import { SITE_URL } from "@/content/site";

/** Crawl the marketing pages; keep reviews, projects, the API and the account out of search. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/r/", "/p/", "/api/", "/account/", "/start", "/login", "/auth/"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
