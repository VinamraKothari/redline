import { currentUser, testAuthEnabled } from "@/lib/auth/server";
import { Landing } from "@/components/home/Landing";
import { Projects } from "@/components/home/Projects";

export const dynamic = "force-dynamic";

/** Signed out: the landing page (with sign-in). Signed in: your projects. */
export default async function Page() {
  const user = await currentUser();
  if (!user) return <Landing next="/" error={null} testMode={testAuthEnabled()} />;
  return <Projects />;
}
