"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, FolderKanban, LogOut } from "lucide-react";
import { accountApi } from "@/lib/account-api";
import type { ProjectSummary } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/types";
import { Button, Dialog, DialogClose, DialogContent } from "@/components/ui/primitives";

/**
 * Every project you can open: the ones you own and the ones you were invited
 * to. Memberships can be left from here; owned projects are deleted from
 * their own page, because that takes every page and comment with it.
 */
export function ProjectsList({ projects, myId, onChanged }: { projects: ProjectSummary[] | null; myId: string; onChanged: () => void }) {
  const [leaving, setLeaving] = useState<ProjectSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    if (!leaving) return;
    setBusy(true);
    setError(null);
    try {
      await accountApi.leaveProject(leaving.id);
      setLeaving(null);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (projects === null) return <div className="h-[96px] animate-pulse rounded-xl bg-hover" />;
  if (projects.length === 0) {
    return (
      <div className="rounded-xl bg-panel p-6 text-center hairline">
        <FolderKanban size={20} className="mx-auto text-ink-3" />
        <p className="mt-2 text-[13px] text-ink-2">No projects yet.</p>
        <Link href="/" className="mt-1 inline-block text-[12.5px] font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-red">
          Create one from the projects page
        </Link>
      </div>
    );
  }

  const sorted = [...projects].sort((a, b) => Number(b.created_by === myId) - Number(a.created_by === myId) || a.name.localeCompare(b.name));

  return (
    <>
      <ul data-testid="account-projects" className="divide-y divide-line rounded-xl bg-panel hairline">
        {sorted.map((p) => {
          const owner = p.created_by === myId;
          return (
            <li key={p.id} data-project={p.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Link href={`/p/${p.id}`} className="group inline-flex max-w-full items-center gap-1 text-[13.5px] font-medium text-ink hover:text-red">
                  <span className="truncate">{p.name}</span>
                  <ArrowUpRight size={13} className="shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
                <div className="mt-0.5 text-[12px] text-ink-3">
                  <span className={owner ? "font-medium text-ink-2" : undefined}>{owner ? "Owner" : ROLE_LABEL[p.role]}</span>
                  {" · "}
                  {p.review_count} {p.review_count === 1 ? "page" : "pages"}
                </div>
              </div>
              {owner ? (
                <span className="hidden text-[11.5px] text-ink-3 sm:inline">Delete it from its page</span>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setLeaving(p)} aria-label={`Leave ${p.name}`}>
                  <LogOut size={12} /> Leave
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog
        open={leaving !== null}
        onOpenChange={(o) => {
          if (!o) {
            setLeaving(null);
            setError(null);
          }
        }}
      >
        {leaving && (
          <DialogContent title={`Leave “${leaving.name}”?`} description="You'll lose access to its pages and comments, and need a new invitation to get back in. Nothing you wrote is deleted." width={420}>
            {error && (
              <p role="alert" className="mb-3 text-[12.5px] text-red-ink">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                {/* the safe choice gets focus, so Enter never leaves a project by accident */}
                <Button variant="ghost" autoFocus>
                  Stay
                </Button>
              </DialogClose>
              <Button variant="primary" onClick={leave} disabled={busy}>
                {busy ? "Leaving…" : "Leave project"}
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
