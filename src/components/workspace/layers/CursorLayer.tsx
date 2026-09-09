"use client";

import { useStore } from "@/lib/store";
import { PageLayer } from "./PageLayer";

/** Other reviewers' cursors (Supabase Presence). */
export function CursorLayer() {
  const viewers = useStore((s) => s.viewers);
  const me = useStore((s) => s.viewer.user_id);
  const viewport = useStore((s) => s.viewport);
  const zoom = useStore((s) => s.zoom);
  // other people's cursors on this viewport — not my own other tabs
  const list = viewers.filter((v) => v.cursor && v.viewport_width === viewport && v.user_id !== me);
  if (!list.length) return null;
  return (
    <PageLayer className="z-[60]">
      {list.map((v) => (
        <div
          key={v.key}
          className="absolute transition-transform duration-75 ease-out"
          style={{ left: 0, top: 0, transform: `translate(${v.cursor!.x}px, ${v.cursor!.y}px) scale(${1 / zoom})`, transformOrigin: "top left" }}
        >
          <svg width="16" height="18" viewBox="0 0 16 18" fill="none">
            <path d="M1 1 L14 8.5 L8 10 L5.5 16 Z" fill={v.color} stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          <div className="ml-3 -mt-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10.5px] font-medium text-white" style={{ background: v.color }}>
            {v.name || "Anonymous"}
          </div>
        </div>
      ))}
    </PageLayer>
  );
}
