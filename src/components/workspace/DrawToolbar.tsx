"use client";

import { ArrowUpRight, Circle, Eraser, Highlighter, Minus, MousePointer2, Pencil, Redo2, Square, Type, Undo2, Users } from "lucide-react";
import { IconButton, Tip } from "@/components/ui/primitives";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { cn } from "@/lib/util";

const TOOLS = [
  { t: "select", Icon: MousePointer2, label: "Select / move", kbd: "S" },
  { t: "pen", Icon: Pencil, label: "Pen", kbd: "P" },
  { t: "highlighter", Icon: Highlighter, label: "Highlighter", kbd: "H" },
  { t: "line", Icon: Minus, label: "Line (⇧ to snap)", kbd: "L" },
  { t: "arrow", Icon: ArrowUpRight, label: "Arrow", kbd: "A" },
  { t: "rect", Icon: Square, label: "Rectangle (⇧ for square)", kbd: "R" },
  { t: "ellipse", Icon: Circle, label: "Ellipse", kbd: "O" },
  { t: "text", Icon: Type, label: "Text", kbd: "T" },
] as const;

const COLORS = ["#e2342b", "#2c6cf6", "#1f9d55", "#d98b0b", "#8b5cf6", "#1c1b18", "#ffffff"];
const WIDTHS = [2, 4, 7];

export function DrawToolbar() {
  const tool = useStore((s) => s.tool);
  const style = useStore((s) => s.style);
  const showOthers = useStore((s) => s.showOthersDrawings);
  const review = useStore((s) => s.review);
  const viewport = useStore((s) => s.viewport);
  const shapes = useStore((s) => s.shapes);
  const set = useStore((s) => s.set);
  const toast = useStore((s) => s.toast);

  async function clear() {
    if (!review) return;
    const mine = shapes.filter((s) => s.viewport_width === viewport);
    if (!mine.length) return;
    if (!confirm(`Remove all ${mine.length} drawing${mine.length > 1 ? "s" : ""} at ${viewport}px? This can't be undone.`)) return;
    try {
      await api.clearShapes(review.id, viewport);
      set({ shapes: shapes.filter((s) => s.viewport_width !== viewport), selectedShape: null });
      toast("Drawings cleared.");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-1 rounded-xl glass p-1 shadow-pop hairline toast-in">
        {TOOLS.map(({ t, Icon, label, kbd }) => (
          <Tip key={t} label={label} kbd={kbd} side="top">
            <IconButton active={tool === t} onClick={() => set({ tool: t, selectedShape: null })} aria-label={label}>
              <Icon size={16} />
            </IconButton>
          </Tip>
        ))}
        <div className="mx-1 h-5 w-px bg-line" />
        <div className="flex items-center gap-1 px-1">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => set({ style: { ...style, stroke: c } })}
              className={cn("h-5 w-5 rounded-full transition-transform hover:scale-110", style.stroke === c && "scale-110 ring-2 ring-offset-2 ring-ink")}
              style={{ background: c, boxShadow: c === "#ffffff" ? "inset 0 0 0 1px var(--line-strong)" : undefined }}
              aria-label={`Colour ${c}`}
            />
          ))}
          <label className="relative ml-0.5 h-5 w-5 cursor-pointer overflow-hidden rounded-full" style={{ background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }} title="Custom colour">
            <input type="color" value={style.stroke} onChange={(e) => set({ style: { ...style, stroke: e.target.value } })} className="absolute inset-0 cursor-pointer opacity-0" />
          </label>
        </div>
        <div className="mx-1 h-5 w-px bg-line" />
        <div className="flex items-center gap-0.5">
          {WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => set({ style: { ...style, width: w, fontSize: w === 2 ? 14 : w === 4 ? 18 : 26 } })}
              className={cn("flex h-8 w-8 items-center justify-center rounded-md hover:bg-hover", style.width === w && "bg-active")}
              title={`Stroke ${w}px`}
            >
              <span className="rounded-full bg-ink" style={{ width: 4 + w * 2, height: 4 + w * 2 }} />
            </button>
          ))}
        </div>
        <div className="mx-1 h-5 w-px bg-line" />
        <Tip label="Undo" kbd="⌘Z" side="top">
          <IconButton onClick={() => window.dispatchEvent(new CustomEvent("redline:undo"))}>
            <Undo2 size={15} />
          </IconButton>
        </Tip>
        <Tip label="Redo" kbd="⌘⇧Z" side="top">
          <IconButton onClick={() => window.dispatchEvent(new CustomEvent("redline:redo"))}>
            <Redo2 size={15} />
          </IconButton>
        </Tip>
        <Tip label={showOthers ? "Hide others' drawings" : "Show others' drawings"} side="top">
          <IconButton active={!showOthers} onClick={() => set({ showOthersDrawings: !showOthers })}>
            <Users size={15} />
          </IconButton>
        </Tip>
        <Tip label={`Clear drawings at ${viewport}px`} side="top">
          <IconButton danger onClick={clear}>
            <Eraser size={15} />
          </IconButton>
        </Tip>
      </div>
    </div>
  );
}
