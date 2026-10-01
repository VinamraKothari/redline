import type { Metadata } from "next";
import { currentUser, testAuthEnabled } from "@/lib/auth/server";
import { Landing } from "@/components/home/Landing";
import { Projects } from "@/components/home/Projects";
import { SITE_URL } from "@/content/site";

export const dynamic = "force-dynamic";

const description = "Load any website, comment like Figma, draw on it, inspect fonts, colours and spacing, compare it with Figma, and share the marked-up canvas.";

/** The home page is also the landing page, so it carries the site's canonical and Open Graph data. */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Redline — design feedback on any live website",
  description,
  alternates: { canonical: "/" },
  openGraph: { title: "Redline — design feedback on any live website", description, type: "website", url: "/", siteName: "Redline" },
};

/** Signed out: the landing page (with sign-in). Signed in: your projects. */
export default async function Page() {
  const user = await currentUser();
  if (!user) return <Landing next="/" error={null} testMode={testAuthEnabled()} />;
  return <Projects />;
}
