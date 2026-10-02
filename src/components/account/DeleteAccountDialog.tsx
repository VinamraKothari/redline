"use client";

import { useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { accountApi } from "@/lib/account-api";
import { signOut } from "@/lib/auth/client";
import type { ProjectSummary } from "@/lib/api";
import { Button, Dialog, DialogClose, DialogContent, DialogTrigger, Input } from "@/components/ui/primitives";

/**
 * The one irreversible thing on the page. The dialog spells out what goes
 * (with the real numbers), asks for DELETE to be typed, and only then calls
 * the API; the server cancels the subscription and clears the session, and
 * the browser leaves for the landing page with its notice.
 */
export function DeleteAccountDialog({ projects, myId, paying }: { projects: ProjectSummary[] | null; myId: string; paying: boolean }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const owned = (projects ?? []).filter((p) => p.created_by === myId);
  const memberships = (projects ?? []).length - owned.length;
  const pages = owned.reduce((n, p) => n + p.review_count, 0);
  const armed = typed.trim() === "DELETE";

  async function remove() {
    if (!armed) return;
    setBusy(true);
    setError(null);
    try {
      await accountApi.deleteAccount();
      // the server already cleared the cookies; this drops the client's copy and leaves
      await signOut("/?deleted=1");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl bg-panel p-5 hairline">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[460px]">
          <h3 className="text-[13.5px] font-medium text-ink">Delete my account</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
            Removes your profile, every project you own with all its pages, comments and drawings, and your memberships in other people&apos;s projects.
            {paying ? " Your subscription is cancelled at Stripe right away." : ""} This can&apos;t be undone.
          </p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) {
              setTyped("");
              setError(null);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button variant="secondary" className="shrink-0 text-red-ink hover:bg-red-soft">
              <Trash2 size={13} /> Delete my account…
            </Button>
          </DialogTrigger>
          <DialogContent title="Delete your account?" description="Everything below is removed for good. Nobody at Redline can bring it back." width={460}>
            <ul className="space-y-1.5 text-[13px] text-ink-2">
              <li className="flex items-start gap-2">
                <AlertTriangle size={13} className="mt-[3px] shrink-0 text-red" />
                <span>
                  <span className="font-medium text-ink">
                    {owned.length} {owned.length === 1 ? "project" : "projects"} you own
                  </span>
                  , with {pages} {pages === 1 ? "page" : "pages"} and every comment and drawing in them — also for the people you invited.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <AlertTriangle size={13} className="mt-[3px] shrink-0 text-red" />
                <span>
                  Your {memberships} {memberships === 1 ? "membership" : "memberships"} in other people&apos;s projects. Comments you left there stay, under your name.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <AlertTriangle size={13} className="mt-[3px] shrink-0 text-red" />
                <span>{paying ? "Your subscription — cancelled at Stripe immediately, with no further charges." : "Your plan and settings."}</span>
              </li>
            </ul>
            <label className="mt-4 block text-[12.5px] text-ink-2">
              Type <span className="mono font-medium text-ink">DELETE</span> to confirm
              {/* focus lands in the field, not on the × — the dialog is here to be read and typed into */}
              <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" spellCheck={false} autoComplete="off" className="mono mt-1.5" aria-label="Type DELETE to confirm" />
            </label>
            {error && (
              <p role="alert" className="mt-2 text-[12.5px] text-red-ink">
                {error}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="ghost">Keep my account</Button>
              </DialogClose>
              <Button variant="danger" onClick={remove} disabled={!armed || busy}>
                {busy ? "Deleting…" : "Delete my account"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
