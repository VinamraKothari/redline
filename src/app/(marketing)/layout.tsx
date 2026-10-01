import type { Metadata } from "next";
import { Shell } from "@/components/marketing/Shell";
import { SITE_URL } from "@/content/site";

/** Absolute Open Graph and canonical URLs for every marketing page; each page adds its own title, description and canonical. */
export const metadata: Metadata = { metadataBase: new URL(SITE_URL) };

/** Nav and footer around every marketing page. */
export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return <Shell>{children}</Shell>;
}
