"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Input } from "@/components/ui/primitives";
import { EmptyRow, ErrorNote, fmtDate, PageHeader, Person, PlanName, Skeleton, SourceChip, StatusChip, Table, Td, Th, useAdminData } from "./ui";

const PAGE = 50;

/** /admin/users — search, scan plans and sources, click through to an account. */
export function UsersPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [offset, setOffset] = useState(0);
  // typing shouldn't fire a request per keystroke; a short pause does
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(query.trim());
      setOffset(0);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);
  const { data, error, loading } = useAdminData(() => api.admin.users({ query: debounced, offset, limit: PAGE }), `${debounced}|${offset}`);
  const total = data?.total ?? 0;
  const from = total ? offset + 1 : 0;
  const to = Math.min(offset + PAGE, total);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Everyone who has signed in, with the plan they actually get and why. Click a row for the full picture and to change the plan."
        actions={
          <div className="relative w-full sm:w-[280px]">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or e-mail" aria-label="Search users" className="pl-7" />
          </div>
        }
      />
      {error && <ErrorNote>{error}</ErrorNote>}
      <Table minWidth={820}>
        <thead>
          <tr>
            <Th>User</Th>
            <Th>Plan</Th>
            <Th>Status</Th>
            <Th>Until / renews</Th>
            <Th align="right">Projects</Th>
            <Th align="right">Member of</Th>
            <Th>Joined</Th>
          </tr>
        </thead>
        <tbody>
          {loading && !data ? (
            [0, 1, 2, 3].map((i) => (
              <tr key={i}>
                <Td colSpan={7}>
                  <Skeleton className="h-7" />
                </Td>
              </tr>
            ))
          ) : !data?.rows.length ? (
            <EmptyRow colSpan={7}>{debounced ? `Nobody matches “${debounced}”.` : "No accounts yet."}</EmptyRow>
          ) : (
            data.rows.map((r) => (
              <tr
                key={r.profile.id}
                data-testid="user-row"
                tabIndex={0}
                onClick={() => router.push(`/admin/users/${r.profile.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") router.push(`/admin/users/${r.profile.id}`);
                }}
                className="cursor-pointer outline-none transition-colors hover:bg-hover/60 focus-visible:bg-hover/60"
              >
                <Td className="max-w-[320px]">
                  <Person profile={r.profile} />
                </Td>
                <Td className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-2">
                    <PlanName plan={r.plan} />
                    {r.source !== "free" && <SourceChip source={r.source} />}
                  </span>
                </Td>
                <Td>
                  <StatusChip status={r.status} />
                </Td>
                <Td className="whitespace-nowrap text-ink-2">{r.until ? `${r.source === "stripe" ? "renews " : "until "}${fmtDate(r.until)}` : r.plan === "free" ? "—" : "no end date"}</Td>
                <Td align="right">{r.projects_owned}</Td>
                <Td align="right">{r.memberships}</Td>
                <Td className="whitespace-nowrap text-ink-2">{fmtDate(r.profile.created_at)}</Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
      <div className="flex items-center justify-between text-[12px] text-ink-3">
        <span className="num">{total ? `${from}–${to} of ${total}` : loading ? "Loading…" : "0 accounts"}</span>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} aria-label="Previous page">
            <ChevronLeft size={13} /> Previous
          </Button>
          <Button size="sm" variant="ghost" disabled={to >= total} onClick={() => setOffset(offset + PAGE)} aria-label="Next page">
            Next <ChevronRight size={13} />
          </Button>
        </div>
      </div>
    </div>
  );
}
