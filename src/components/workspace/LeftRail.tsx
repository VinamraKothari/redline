"use client";

import { Eye, EyeOff, HelpCircle, MessageCircle, MousePointer2, Pencil, Ruler } from "lucide-react";
import { IconButton, Tip } from "@/components/ui/primitives";
import { useStore, type Mode } from "@/lib/store";

const TOOLS: { mode: Mode; label: string; kbd: string; Icon: typeof MousePointer2 }[] = [
  { mode: "browse", label: "Browse the page", kbd: "V", Icon: MousePointer2 },
  { mode: "comment", label: "Comment — click or drag a region", kbd: "C", Icon: MessageCircle },
  { mode: "draw", label: "Draw & annotate", kbd: "D", Icon: Pencil },
  { mode: "inspect", label: "Inspect type, colour & spacing", kbd: "I", Icon: Ruler },
];

export function LeftRail() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const showComments = useStore((s) => s.showComments);
  const viewOnly = useStore((s) => s.viewOnly);
  const set = useStore((s) => s.set);

  return (
    <nav className="z-20 flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-paper py-2">
      {TOOLS.filter((t) => !viewOnly || t.mode === "browse" || t.mode === "inspect").map(({ mode: m, label, kbd, Icon }) => (
        <Tip key={m} label={label} kbd={kbd}>
          <IconButton active={mode === m} onClick={() => setMode(m)} aria-label={label} size="lg">
            <Icon size={17} strokeWidth={mode === m ? 2.2 : 1.8} />
          </IconButton>
        </Tip>
      ))}
      <div className="my-1 h-px w-6 bg-line" />
      <Tip label={showComments ? "Hide comments & drawings" : "Show comments & drawings"} kbd="⇧C">
        <IconButton onClick={() => set({ showComments: !showComments })} aria-label="Toggle markup" size="lg">
          {showComments ? <Eye size={17} strokeWidth={1.8} /> : <EyeOff size={17} strokeWidth={1.8} />}
        </IconButton>
      </Tip>
      <div className="flex-1" />
      <Tip label="Keyboard shortcuts" kbd="?">
        <IconButton onClick={() => window.dispatchEvent(new CustomEvent("redline:help"))} aria-label="Help" size="lg">
          <HelpCircle size={17} strokeWidth={1.8} />
        </IconButton>
      </Tip>
    </nav>
  );
}
