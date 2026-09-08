"use client";

import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { measure, resolveSelector, pageRect, type Rect } from "@/lib/frame/dom";
import { frame } from "@/lib/frame/controller";
import { PageLayer } from "./PageLayer";

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function Outline({ r, color, dashed, fill }: { r: Rect; color: string; dashed?: boolean; fill?: string }) {
  return (
    <div
      className="absolute"
      style={{
        left: r.x,
        top: r.y,
        width: r.w,
        height: r.h,
        outline: `1.5px ${dashed ? "dashed" : "solid"} ${color}`,
        outlineOffset: -1,
        background: fill ?? "transparent",
      }}
    />
  );
}

function SizeLabel({ r, color = "var(--blue)" }: { r: Rect; color?: string }) {
  return (
    <div
      className="mono absolute whitespace-nowrap rounded px-1.5 py-0.5 text-[10.5px] font-medium text-white"
      style={{ left: r.x + r.w / 2, top: r.y + r.h + 4, transform: "translateX(-50%)", background: color }}
    >
      {fmt(r.w)} × {fmt(r.h)}
    </div>
  );
}

function BoxModel({ box }: { box: NonNullable<import("@/lib/store").HoverInfo["box"]> }) {
  const { margin, border, padding, content } = box;
  return (
    <>
      {/* margin ring */}
      <div className="absolute" style={{ left: margin.x, top: margin.y, width: margin.w, height: margin.h, background: "var(--margin-fill)" }} />
      <div className="absolute" style={{ left: border.x, top: border.y, width: border.w, height: border.h, background: "var(--padding-fill)" }} />
      <div className="absolute" style={{ left: content.x, top: content.y, width: content.w, height: content.h, background: "var(--content-fill)" }} />
      {/* padding / margin numbers */}
      {box.p.t >= 6 && <Num x={padding.x + padding.w / 2} y={padding.y + box.p.t / 2} v={box.p.t} />}
      {box.p.b >= 6 && <Num x={padding.x + padding.w / 2} y={padding.y + padding.h - box.p.b / 2} v={box.p.b} />}
      {box.p.l >= 10 && <Num x={padding.x + box.p.l / 2} y={padding.y + padding.h / 2} v={box.p.l} />}
      {box.p.r >= 10 && <Num x={padding.x + padding.w - box.p.r / 2} y={padding.y + padding.h / 2} v={box.p.r} />}
      {box.m.t >= 6 && <Num x={margin.x + margin.w / 2} y={margin.y + box.m.t / 2} v={box.m.t} tone="amber" />}
      {box.m.b >= 6 && <Num x={margin.x + margin.w / 2} y={margin.y + margin.h - box.m.b / 2} v={box.m.b} tone="amber" />}
      {box.m.l >= 10 && <Num x={margin.x + box.m.l / 2} y={margin.y + margin.h / 2} v={box.m.l} tone="amber" />}
      {box.m.r >= 10 && <Num x={margin.x + margin.w - box.m.r / 2} y={margin.y + margin.h / 2} v={box.m.r} tone="amber" />}
    </>
  );
}

function Num({ x, y, v, tone = "green" }: { x: number; y: number; v: number; tone?: "green" | "amber" }) {
  return (
    <div
      className="mono absolute -translate-x-1/2 -translate-y-1/2 rounded-sm px-1 text-[9.5px] font-semibold leading-[14px] text-white"
      style={{ left: x, top: y, background: tone === "green" ? "#3b8f3f" : "#c47a1c" }}
    >
      {fmt(v)}
    </div>
  );
}

export function InspectLayer() {
  const mode = useStore((s) => s.mode);
  const hover = useStore((s) => s.hover);
  const selected = useStore((s) => s.selected);
  const measureTarget = useStore((s) => s.measureTarget);
  const layoutTick = useStore((s) => s.layoutTick);
  // keep the selected outline glued to its element as the page changes
  const selRect = useMemo<Rect | null>(() => {
    void layoutTick;
    if (!selected) return null;
    const doc = frame().doc;
    const el = doc ? resolveSelector(doc, selected.selector) : null;
    return el ? pageRect(el) : selected.rect;
  }, [selected, layoutTick]);

  if (mode !== "inspect" && mode !== "comment") return null;

  const lines = selRect && measureTarget ? measure(selRect, measureTarget.rect) : [];

  return (
    <PageLayer className="z-[30]">
      {/* comment mode: quiet hint of what the pin will attach to */}
      {mode === "comment" && hover && <Outline r={hover.rect} color="rgba(226,52,43,.55)" dashed />}

      {mode === "inspect" && hover && !measureTarget && (
        <>
          {hover.box && <BoxModel box={hover.box} />}
          <Outline r={hover.rect} color="var(--blue)" />
          {!selected && <SizeLabel r={hover.rect} />}
          <div
            className="absolute -translate-y-full whitespace-nowrap rounded-t px-1.5 py-0.5 text-[10.5px] font-medium text-white"
            style={{ left: hover.rect.x, top: hover.rect.y, background: "var(--blue)" }}
          >
            {hover.label}
          </div>
        </>
      )}

      {mode === "inspect" && selRect && (
        <>
          <Outline r={selRect} color="var(--blue)" fill="var(--blue-fill)" />
          {/* corner handles, Figma-like */}
          {[
            [selRect.x, selRect.y],
            [selRect.x + selRect.w, selRect.y],
            [selRect.x, selRect.y + selRect.h],
            [selRect.x + selRect.w, selRect.y + selRect.h],
          ].map(([x, y], i) => (
            <div key={i} className="absolute h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 border border-blue bg-white" style={{ left: x, top: y }} />
          ))}
          <SizeLabel r={selRect} />
        </>
      )}

      {mode === "inspect" && selRect && measureTarget && (
        <>
          <Outline r={measureTarget.rect} color="var(--red)" />
          <svg className="absolute left-0 top-0 overflow-visible" width={1} height={1}>
            {lines.map((l, i) => (
              <g key={i}>
                <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className="measure-line" />
                {l.axis === "h" ? (
                  <>
                    <line x1={l.x1} y1={l.y1 - 4} x2={l.x1} y2={l.y1 + 4} className="measure-line" />
                    <line x1={l.x2} y1={l.y2 - 4} x2={l.x2} y2={l.y2 + 4} className="measure-line" />
                  </>
                ) : (
                  <>
                    <line x1={l.x1 - 4} y1={l.y1} x2={l.x1 + 4} y2={l.y1} className="measure-line" />
                    <line x1={l.x2 - 4} y1={l.y2} x2={l.x2 + 4} y2={l.y2} className="measure-line" />
                  </>
                )}
              </g>
            ))}
          </svg>
          {lines.map((l, i) => (
            <div
              key={`l${i}`}
              className="mono absolute rounded-sm bg-red px-1 text-[10px] font-semibold leading-[15px] text-white"
              style={{
                left: (l.x1 + l.x2) / 2,
                top: (l.y1 + l.y2) / 2,
                transform: l.axis === "h" ? "translate(-50%, 4px)" : "translate(6px, -50%)",
              }}
            >
              {fmt(l.label)}
            </div>
          ))}
        </>
      )}
    </PageLayer>
  );
}
