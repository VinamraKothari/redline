"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/util";
import { Dialog, DialogContent } from "@/components/ui/primitives";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const open = () => setHelp(true);
    window.addEventListener("redline:help", open);
    return () => window.removeEventListener("redline:help", open);
  }, []);

  return (
    <>
      <div className="pointer-events-none fixed bottom-5 right-5 z-[250] flex flex-col items-end gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-center gap-3 rounded-lg px-3 py-2 text-[12.5px] shadow-pop fade-up",
              t.kind === "error" ? "bg-red text-white" : "bg-ink text-white",
            )}
          >
            {t.kind === "success" && <span className="h-1.5 w-1.5 rounded-full bg-green" />}
            <span>{t.text}</span>
            {t.action && (
              <button type="button" onClick={() => { t.action!.onClick(); dismiss(t.id); }} className="rounded bg-white/15 px-2 py-0.5 font-medium hover:bg-white/25">
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>

      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent title="Keyboard shortcuts" width={520}>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-[12.5px]">
            {[
              ["Browse the page", "V"],
              ["Comment", "C"],
              ["Draw", "D"],
              ["Inspect", "I"],
              ["Lock hover state (menus, tooltips)", "H"],
              ["Full-screen preview", "F"],
              ["Freeze / unfreeze the page", "⇧ F"],
              ["Save this state as a new page", "⇧ P"],
              ["Share & export", "⇧ S"],
              ["Reload the page", "R"],
              ["Site scripts on / off", "⇧ J"],
              ["Viewport: desktop / tablet / phone", "1 / 2 / 3"],
              ["Hide / show comments", "⇧ C"],
              ["Next / previous comment", "N / ⇧ N"],
              ["Close / go back", "Esc"],
              ["Deep-select innermost element", "hold Ctrl / ⌘"],
              ["Measure to another element", "select, then hold Alt"],
              ["Zoom", "⌘ + / ⌘ −  or  Ctrl + scroll"],
              ["Fit / 100%", "⌘ 0 / ⌘ 1"],
              ["Undo / redo drawing", "⌘ Z / ⌘ ⇧ Z"],
              ["Draw tools", "S P H L A R O T"],
              ["Region comment", "drag in comment mode"],
              ["Send comment / new line", "Enter / ⇧ Enter"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 border-b border-line py-1">
                <span className="text-ink-2">{k}</span>
                <span className="kbd whitespace-nowrap">{v}</span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
