"use client";

import { useEffect, useState } from "react";
import { Square, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/util";
import { Dialog, DialogContent } from "@/components/ui/primitives";
import { cancelRecording, clock, MAX_SECONDS, stopRecording } from "@/lib/recorder";

/** The floating "● 0:07 · Stop" pill while a screen recording runs. */
function RecordingBar() {
  const recording = useStore((s) => s.recording);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [recording]);
  if (!recording) return null;
  const elapsed = Math.min(MAX_SECONDS, Math.floor((now - recording.startedAt) / 1000));
  return (
    <div
      role="status"
      aria-label="Screen recording in progress"
      className="pointer-events-auto fixed left-1/2 top-3 z-[260] flex -translate-x-1/2 items-center gap-2 rounded-full glass-dark py-1 pl-3 pr-1 text-[12.5px] text-white shadow-pop toast-in"
    >
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red" />
      </span>
      <span className="num font-medium">{clock(elapsed)}</span>
      <span className="text-white/60">/ {clock(MAX_SECONDS)}</span>
      <span className="hidden text-white/60 sm:inline">· use the page as normal</span>
      <button
        type="button"
        onClick={() => stopRecording()}
        className="press ml-1 flex h-7 items-center gap-1.5 rounded-full bg-white px-3 text-[12px] font-semibold text-ink hover:bg-paper"
      >
        <Square size={11} fill="currentColor" /> Stop <span className="kbd !py-0.5">Esc</span>
      </button>
      <button type="button" onClick={() => cancelRecording()} title="Discard the recording" aria-label="Discard recording" className="press flex h-7 w-7 items-center justify-center rounded-full text-white/70 hover:bg-white/15 hover:text-white">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

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
      <RecordingBar />
      <div className="pointer-events-none fixed bottom-5 right-5 z-[250] flex flex-col items-end gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-center gap-3 rounded-lg px-3 py-2 text-[12.5px] shadow-pop toast-in",
              t.kind === "error" ? "bg-red text-white" : "glass-dark text-white",
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
              ["Mark thread unread / read", "U"],
              ["Mark all threads read", "⇧ U"],
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
