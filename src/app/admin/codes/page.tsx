import type { Metadata } from "next";
import { CodesPage } from "@/components/admin/CodesPage";

export const metadata: Metadata = { title: "Codes — Redline admin" };

export default function Page() {
  return <CodesPage />;
}
