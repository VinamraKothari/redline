"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import { Button, Dialog, DialogContent, Input } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { frame } from "@/lib/frame/controller";
import { serializeDocument } from "@/lib/frame/dom";
import { useStore } from "@/lib/store";

/**
 * "Save this state as a new page": snapshots the page exactly as it is right
 * now — open drawer, dialog, expanded accordion, locked hover menu — into a
 * new, frozen page of the same project. Everyone who opens that page sees
 * that state, and comments anchor to it permanently.
 */
export function CaptureStateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const review = useStore((s) => s.review);
  const viewport = useStore((s) => s.viewport);
  const hoverLocked = useStore((s) => s.hoverLocked);
  const toast = useStore((s) => s.toast);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && review) setTitle(`${review.title} — state`);
  }, [open, review]);

  if (!review) return null;

  async function capture(e?: React.FormEvent) {
    e?.preventDefault();
    if (!review || busy) return;
    const doc = frame().doc;
    if (!doc) return toast("The page hasn't loaded yet.", "error");
    setBusy(true);
    try {
      const html = serializeDocument(doc);
      const { review: r } = await api.createReview({
        project_id: review.project_id!,
        url: review.url.startsWith("upload://") ? undefined : review.url,
        viewport,
        mode: review.url.startsWith("upload://") ? "upload" : "frozen",
        html,
        title: title.trim() || `${review.title} — state`,
      });
      onOpenChange(false);
      toast("State saved as a new page — opening it.", "success");
      router.push(`/r/${r.id}`);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Save this state as a new page"
        description="Captures the page exactly as it looks right now — an open drawer, dialog, accordion or a locked hover menu — as a frozen page in this project. Everyone who opens it sees that state; comments stay anchored to it."
        width={460}
      >
        <form onSubmit={capture} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[12px] text-ink-2">
            Page name
            <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} aria-label="State page name" />
          </label>
          <ul className="list-disc space-y-1 pl-4 text-[11.5px] text-ink-3">
            <li>Open the overlay or sidebar first (Browse mode, V), then save. {hoverLocked ? "The locked hover state is included." : "Hover menus: lock them with H before saving."}</li>
            <li>The new page is frozen — it never changes, and it shows in the project next to this one.</li>
          </ul>
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              <Camera size={13} /> {busy ? "Saving…" : "Save as new page"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
