"use client";

import { useEffect, useState } from "react";
import { GitCompareArrows, ExternalLink } from "lucide-react";
import { Button, Dialog, DialogContent, Input } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { frame } from "@/lib/frame/controller";
import { snapshotDocument, waitForImages } from "@/lib/figma/snapshot";
import { parseFigmaUrl } from "@/lib/figma/spec";
import { isDevComment } from "@/lib/figma/dev";
import { useStore } from "@/lib/store";
import { openSettings } from "@/components/settings/SettingsDialog";

const LINK_KEY = "redline:figma:";

/**
 * "Compare with Figma": paste the link to the page's frame in Figma, and the
 * rendered page is checked against it — copy, type, colours, sizes, spacing,
 * images — with one developer comment per difference, pinned where it is.
 */
export function FigmaCompareDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const review = useStore((s) => s.review);
  const comments = useStore((s) => s.comments);
  const viewport = useStore((s) => s.viewport);
  const frameReady = useStore((s) => s.frameReady);
  const toast = useStore((s) => s.toast);
  const set = useStore((s) => s.set);
  const [url, setUrl] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // remember the last link per page; fall back to the one a previous run used
  useEffect(() => {
    if (!open || !review) return;
    let last = "";
    try {
      last = localStorage.getItem(LINK_KEY + review.id) || "";
    } catch {
      /* ignore */
    }
    if (!last) {
      const prev = useStore
        .getState()
        .comments.filter((c) => isDevComment(c) && c.anchor?.dev?.figmaUrl)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      last = prev?.anchor?.dev?.figmaUrl || "";
    }
    setUrl(last);
    setError(null);
    api
      .figmaStatus()
      .then((s) => setConfigured(s.configured))
      .catch(() => setConfigured(null));
    // only when the dialog opens — comments change while it is open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, review?.id]);

  if (!review) return null;
  const parsed = parseFigmaUrl(url);
  const devCount = comments.filter((c) => c.parent_id === null && isDevComment(c)).length;

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    if (!review || phase) return;
    if (!parsed) return setError("Paste a Figma design link — it looks like https://www.figma.com/design/…?node-id=….");
    if (!parsed.nodeId) return setError("The link needs a node-id: in Figma select the page frame (the 1440px artboard), then Share → Copy link.");
    const doc = frame().doc;
    if (!doc || !frameReady) return setError("The page hasn't finished loading yet.");
    setError(null);
    try {
      localStorage.setItem(LINK_KEY + review.id, url.trim());
    } catch {
      /* ignore */
    }
    try {
      setPhase("Loading every part of the page…");
      await frame().warmUp();
      await waitForImages(doc);
      setPhase("Reading the rendered page…");
      // read the page from the top, where sticky bars sit where the design has them
      const win = doc.defaultView;
      const scrolled = win?.scrollY ?? 0;
      if (win && scrolled) {
        win.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 250));
      }
      const snapshot = snapshotDocument(doc);
      if (win && scrolled) win.scrollTo(0, scrolled);
      setPhase(`Comparing ${snapshot.nodes.length} elements with Figma…`);
      const res = await api.figmaCompare(review.id, url.trim(), snapshot, viewport);
      // adopt the new state of the comment list (created + removed) in one go
      const data = await api.loadReview(review.id);
      set({ comments: data.comments, showDevComments: true, commentFilter: "dev" });
      toast(
        res.findings === 0
          ? `No differences found against “${res.figma.name}”.`
          : `${res.findings} difference${res.findings === 1 ? "" : "s"} against “${res.figma.name}” — ${res.created} new developer comment${res.created === 1 ? "" : "s"}${res.kept ? `, ${res.kept} unchanged` : ""}${res.removed ? `, ${res.removed} outdated removed` : ""}.`,
        "success",
      );
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message || "The comparison failed.");
    } finally {
      setPhase(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !phase && onOpenChange(o)}>
      <DialogContent
        title="Compare with Figma"
        description="Checks this page against its Figma frame — copy, fonts, colours, sizes, spacing, images — and leaves one developer comment per difference, pinned to the element."
        width={520}
      >
        <form onSubmit={run} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[12px] text-ink-2">
            Figma link to the page frame
            <Input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.figma.com/design/…?node-id=1234-5678"
              aria-label="Figma link"
              spellCheck={false}
            />
          </label>
          <ul className="list-disc space-y-1 pl-4 text-[11.5px] text-ink-3">
            <li>In Figma, select the whole page frame (the 1440px artboard), then Share → Copy link — the link must contain a node-id.</li>
            <li>Findings are written from a developer&apos;s point of view, in violet, and can be hidden with the Developer comments toggle in the panel. They export to the Jira CSV like any other thread.</li>
            <li>
              Each finding carries its category (typography, spacing, images…). You choose which categories and severities you see in{" "}
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  openSettings();
                }}
                className="underline decoration-ink-3/40 underline-offset-2 hover:text-ink"
              >
                Settings
              </button>
              .
            </li>
            <li>Running again refreshes the findings: outdated ones are removed, resolved ones and ones with replies are kept.</li>
          </ul>
          {configured === false && (
            <div className="rounded-lg bg-red-soft px-3 py-2 text-[12px] text-red-ink">
              Figma isn&apos;t connected on this server yet. Create a personal access token in Figma (Settings → Security → Personal access tokens, read-only file access) and set it as{" "}
              <span className="mono">FIGMA_TOKEN</span> in the hosting environment, then redeploy.
            </div>
          )}
          {parsed && (
            <p className="text-[11.5px] text-ink-3">
              File <span className="mono">{parsed.fileKey.slice(0, 10)}…</span> · frame <span className="mono">{parsed.nodeId ?? "— no node-id"}</span>
              {devCount > 0 && ` · ${devCount} developer comment${devCount === 1 ? "" : "s"} on this page now`}
            </p>
          )}
          {error && <p className="text-[12px] text-red-ink">{error}</p>}
          <div className="mt-1 flex items-center gap-2">
            <a href="https://help.figma.com/hc/en-us/articles/8085703771159" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11.5px] text-ink-3 underline decoration-ink-3/40 underline-offset-2 hover:text-ink">
              How to create a token <ExternalLink size={10} />
            </a>
            <div className="flex-1" />
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={Boolean(phase)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={Boolean(phase) || configured === false || !frameReady}>
              <GitCompareArrows size={13} /> {phase ?? (frameReady ? "Compare" : "Waiting for the page…")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
