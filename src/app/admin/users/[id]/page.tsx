import type { Metadata } from "next";
import { UserDetail } from "@/components/admin/UserDetail";

export const metadata: Metadata = { title: "User — Redline admin" };

export default async function Page({ params }: PageProps<"/admin/users/[id]">) {
  const { id } = await params;
  return <UserDetail id={id} />;
}
