import type { Metadata } from "next";
import { UsersPage } from "@/components/admin/UsersPage";

export const metadata: Metadata = { title: "Users — Redline admin" };

export default function Page() {
  return <UsersPage />;
}
