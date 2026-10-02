import type { Metadata } from "next";
import { Suspense } from "react";
import { AuditPage } from "@/components/admin/AuditTable";

export const metadata: Metadata = { title: "Audit log — Redline admin" };

export default function Page() {
  return (
    // useSearchParams (?target=) needs a boundary so the shell can stream first
    <Suspense fallback={null}>
      <AuditPage />
    </Suspense>
  );
}
