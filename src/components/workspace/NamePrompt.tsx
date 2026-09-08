"use client";

import { useEffect, useState } from "react";
import { Avatar, Button, Dialog, DialogContent, Input } from "@/components/ui/primitives";
import { saveViewer, useStore } from "@/lib/store";
import { AUTHOR_COLORS } from "@/lib/types";
import { colorFor } from "@/lib/util";
import { RealtimeContext } from "./Workspace";

/**
 * Name prompt — opened on demand (window event "redline:name") from the panel,
 * and used by the Share dialog. The comment composer asks inline, so this
 * doesn't block first use.
 */
export function NamePrompt() {
  const viewer = useStore((s) => s.viewer);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(viewer.name);
  const [color, setColor] = useState(viewer.color);

  useEffect(() => {
    const o = () => {
      setName(useStore.getState().viewer.name);
      setColor(useStore.getState().viewer.color);
      setOpen(true);
    };
    window.addEventListener("redline:name", o);
    return () => window.removeEventListener("redline:name", o);
  }, []);

  function save() {
    const n = name.trim();
    if (!n) return;
    saveViewer(n, color || colorFor(n));
    RealtimeContext.current?.track({ name: n, color: color || colorFor(n) });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Your name" description="Shown on your comments, cursor and drawings. No account needed." width={380}>
        <div className="flex items-center gap-3">
          <Avatar name={name || "?"} color={color} size={36} />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya" maxLength={40} autoFocus onKeyDown={(e) => e.key === "Enter" && save()} />
        </div>
        <div className="mt-3 flex items-center gap-1.5">
          {AUTHOR_COLORS.map((c) => (
            <button key={c} type="button" onClick={() => setColor(c)} className="h-5 w-5 rounded-full transition-transform hover:scale-110" style={{ background: c, boxShadow: color === c ? "0 0 0 2px #fff, 0 0 0 4px var(--ink)" : undefined }} aria-label={c} />
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!name.trim()}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
