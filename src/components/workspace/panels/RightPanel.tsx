"use client";

import { PanelRightClose } from "lucide-react";
import { IconButton, Segmented, Tip } from "@/components/ui/primitives";
import { useStore } from "@/lib/store";
import { isDevComment } from "@/lib/figma/dev";
import { devCommentShown } from "@/lib/settings";
import { CommentsPanel } from "./CommentsPanel";
import { InspectPanel } from "./InspectPanel";
import { CopyPanel } from "./CopyPanel";

export function RightPanel() {
  const panel = useStore((s) => s.panel);
  const set = useStore((s) => s.set);
  const comments = useStore((s) => s.comments);
  const settings = useStore((s) => s.settings);
  const copyCount = useStore((s) => s.textEdits.length);
  // developer threads the account's settings hide don't count as open work
  const pending = comments.filter((c) => !c.parent_id && !c.resolved && (!isDevComment(c) || devCommentShown(c.anchor?.dev, settings))).length;

  return (
    // on a phone the panel lies over the page instead of squeezing it out of the window
    <aside className="z-20 flex w-[320px] shrink-0 flex-col border-l border-line bg-paper max-sm:absolute max-sm:inset-y-0 max-sm:right-0 max-sm:z-30 max-sm:w-[min(320px,calc(100vw-48px))] max-sm:shadow-pop">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-2">
        <Segmented
          value={panel ?? "comments"}
          onChange={(v) => set({ panel: v, ...(v === "inspect" ? { mode: "inspect" } : {}) })}
          options={[
            {
              value: "comments",
              label: (
                <span className="flex items-center gap-1.5">
                  Comments
                  {pending > 0 && <span className="num rounded-full bg-red px-1.5 text-[10px] font-semibold text-white">{pending}</span>}
                </span>
              ),
            },
            { value: "inspect", label: "Inspect" },
            {
              value: "copy",
              label: (
                <span className="flex items-center gap-1.5">
                  Copy
                  {copyCount > 0 && <span className="num rounded-full bg-copy px-1.5 text-[10px] font-semibold text-white">{copyCount}</span>}
                </span>
              ),
            },
          ]}
        />
        <div className="flex-1" />
        <Tip label="Hide panel" side="left">
          <IconButton size="sm" onClick={() => set({ panel: null })}>
            <PanelRightClose size={15} />
          </IconButton>
        </Tip>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{panel === "inspect" ? <InspectPanel /> : panel === "copy" ? <CopyPanel /> : <CommentsPanel />}</div>
    </aside>
  );
}
