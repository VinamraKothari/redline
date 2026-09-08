"use client";

import { useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { frame } from "@/lib/frame/controller";
import { inspect, pageRect, pathLabel, type Rect } from "@/lib/frame/dom";
import { RealtimeContext } from "../Workspace";
import { PageLayer } from "./PageLayer";
import type { StageGeom } from "../Stage";

/**
 * Transparent surface over the iframe for the comment and inspect modes.
 * It hit-tests the page with elementFromPoint on the same-origin document.
 * In browse and draw modes it stays out of the way.
 */
export function CaptureLayer({ geom }: { geom: StageGeom }) {
  const mode = useStore((s) => s.mode);
  const set = useStore((s) => s.set);
  const viewOnly = useStore((s) => s.viewOnly);
  const [rubber, setRubber] = useState<Rect | null>(null);
  const down = useRef<{ x: number; y: number; deep: boolean; hadOpen: boolean } | null>(null);

  const active = (mode === "comment" && !viewOnly) || mode === "inspect";
  if (!active) return null;

  const deepOf = (e: React.PointerEvent) => e.ctrlKey || e.metaKey || useStore.getState().deepSelect;

  function onMove(e: React.PointerEvent) {
    const { x, y } = geom.toPage(e.clientX, e.clientY);
    RealtimeContext.current?.track({ cursor: { x, y } });
    const st = useStore.getState();

    if (mode === "inspect") {
      const el = frame().elementAtPage(x, y, deepOf(e));
      if (!el) return set({ hover: null });
      const info = frame().hoverInfo(el);
      if (e.altKey && st.selected) set({ hover: info, measureTarget: info });
      else set({ hover: info, measureTarget: e.altKey ? st.measureTarget : null });
      return;
    }

    // comment mode
    if (down.current) {
      const dx = x - down.current.x;
      const dy = y - down.current.y;
      if (Math.hypot(dx, dy) > 4) {
        setRubber({
          x: Math.min(x, down.current.x),
          y: Math.min(y, down.current.y),
          w: Math.abs(dx),
          h: Math.abs(dy),
        });
      }
      return;
    }
    const el = frame().elementAtPage(x, y, deepOf(e));
    if (!el || el === frame().doc?.body) return set({ hover: null });
    set({ hover: { rect: pageRect(el), label: pathLabel(el, 2) } });
  }

  function onDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const { x, y } = geom.toPage(e.clientX, e.clientY);
    const st = useStore.getState();
    down.current = { x, y, deep: deepOf(e), hadOpen: Boolean(st.activeThread || st.draft) };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onUp(e: React.PointerEvent) {
    const start = down.current;
    down.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    const { x, y } = geom.toPage(e.clientX, e.clientY);
    const st = useStore.getState();

    if (mode === "inspect") {
      const el = frame().elementAtPage(x, y, deepOf(e));
      if (!el) return;
      if (e.altKey && st.selected) return; // measuring: keep the selection
      set({ selected: inspect(el), measureTarget: null, panel: "inspect" });
      return;
    }

    // comment mode
    if (!start) return;
    const region = rubber && rubber.w > 8 && rubber.h > 8 ? rubber : null;
    setRubber(null);
    if (start.hadOpen && !region) {
      // first click outside an open thread / draft just closes it (like Figma)
      set({ activeThread: null, draft: st.draft?.dirty ? st.draft : null });
      return;
    }
    const px = region ? region.x + region.w : x;
    const py = region ? region.y : y;
    const a = frame().anchorFor(region ? region.x + region.w / 2 : x, region ? region.y + region.h / 2 : y, region, start.deep);
    set({
      draft: { px, py, region, selector: a.selector, fx: region ? 0 : a.fx, fy: region ? 0 : a.fy, element_label: a.element_label ?? null },
      activeThread: null,
    });
  }

  const cursor = mode === "comment" ? "crosshair" : "default";

  return (
    <>
      {rubber && (
        <PageLayer>
          <div
            className="absolute border border-red bg-red/10"
            style={{ left: rubber.x, top: rubber.y, width: rubber.w, height: rubber.h }}
          />
        </PageLayer>
      )}
      <div
        className="absolute inset-0 z-[40] touch-none"
        style={{ cursor }}
        onPointerMove={onMove}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerLeave={() => {
          set({ hover: null });
          RealtimeContext.current?.track({ cursor: null });
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
    </>
  );
}
