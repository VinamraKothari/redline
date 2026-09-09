import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { Projects } from "@/components/home/Projects";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <Projects />;
}
