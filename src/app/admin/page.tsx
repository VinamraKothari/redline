import type { Metadata } from "next";
import { Overview } from "@/components/admin/Overview";

export const metadata: Metadata = { title: "Overview — Redline admin" };

export default function Page() {
  return <Overview />;
}
