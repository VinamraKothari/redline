"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getStroke } from "perfect-freehand";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import type { Shape, ShapeStyle } from "@/lib/types";
import { newId, cn } from "@/lib/util";
import { PageLayer } from "./PageLayer";
import type { StageGeom } from "../Stage";

/* ─── geometry helpers ──────────────────────────────────────────────────── */

function strokePath(points: number[][], size: number, thinning: number): string {
  const outline = getStroke(points, { size, thinning, smoothing: 0.55, streamline: 0.45, simulatePressure: points.every((p) => p[2] === 0.5) });
  if (!outline.length) return "";
  const d = outline.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", ...outline[0], "Q"] as (string | number)[],
  );
  d.push("Z");
  return d.join(" ");
}

function bounds(s: Shape): { x: number; y: number; w: number; h: number } {
  const d = s.data;
  if (d.points?.length) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of d.points) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    const pad = s.style.width * 2;
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  }
  if (s.type === "line" || s.type === "arrow") {
    const x0 = Math.min(d.x!, d.x2!), y0 = Math.min(d.y!, d.y2!);
    return { x: x0 - 6, y: y0 - 6, w: Math.abs(d.x2! - d.x!) + 12, h: Math.abs(d.y2! - d.y!) + 12 };
  }
  if (s.type === "text") {
    const lines = (d.text || "").split("\n");
    const fs = s.style.fontSize || 18;
    const w = Math.max(...lines.map((l) => l.length)) * fs * 0.58 + 8;
    return { x: d.x!, y: d.y!, w, h: lines.length * fs * 1.3 + 4 };
  }
  return { x: d.x!, y: d.y!, w: d.w!, h: d.h! };
}

function translate(s: Shape, dx: number, dy: number): Shape {
  const d = { ...s.data };
  if (d.points) d.points = d.points.map(([x, y, p]) => [x + dx, y + dy, p]);
  if (d.x != null) d.x += dx;
  if (d.y != null) d.y += dy;
  if (d.x2 != null) d.x2 += dx;
  if (d.y2 != null) d.y2 += dy;
  return { ...s, data: d };
}

/* ─── one shape ─────────────────────────────────────────────────────────── */

function ShapeView({ s, selectable, selected, onPointerDown, onDoubleClick }: {
  s: Shape;
  selectable: boolean;
  selected: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onDoubleClick?: () => void;
}) {
  const st = s.style;
  const common = {
    onPointerDown,
    onDoubleClick,
    style: { pointerEvents: selectable ? ("all" as const) : ("none" as const), cursor: selectable ? "move" : "default" },
  };
  const d = s.data;
  let el: React.ReactNode = null;
  switch (s.type) {
    case "pen":
      el = <path d={strokePath(d.points || [], st.width * 1.6, 0.55)} fill={st.stroke} opacity={st.opacity} {...common} />;
      break;
    case "highlighter":
      el = (
        <path d={strokePath(d.points || [], st.width * 7, 0)} fill={st.stroke} opacity={0.32 * st.opacity} style={{ ...common.style, mixBlendMode: "multiply" }} onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} />
      );
      break;
    case "line":
    case "arrow":
      el = (
        <g {...common}>
          <line x1={d.x} y1={d.y} x2={d.x2} y2={d.y2} stroke="transparent" strokeWidth={Math.max(12, st.width * 3)} />
          <line
            x1={d.x} y1={d.y} x2={d.x2} y2={d.y2}
            stroke={st.stroke} strokeWidth={st.width} strokeLinecap="round" opacity={st.opacity}
            markerEnd={s.type === "arrow" ? `url(#arrow-${s.id})` : undefined}
          />
          {s.type === "arrow" && (
            <defs>
              <marker id={`arrow-${s.id}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth={Math.max(3, 5 - st.width * 0.3)} markerHeight={Math.max(3, 5 - st.width * 0.3)} orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={st.stroke} />
              </marker>
            </defs>
          )}
        </g>
      );
      break;
    case "rect":
      el = <rect x={d.x} y={d.y} width={d.w} height={d.h} rx={2} fill={st.fill || "transparent"} stroke={st.stroke} strokeWidth={st.width} opacity={st.opacity} {...common} style={{ ...common.style, pointerEvents: selectable ? "visiblePainted" : "none" }} />;
      break;
    case "ellipse":
      el = <ellipse cx={d.x! + d.w! / 2} cy={d.y! + d.h! / 2} rx={d.w! / 2} ry={d.h! / 2} fill={st.fill || "transparent"} stroke={st.stroke} strokeWidth={st.width} opacity={st.opacity} {...common} style={{ ...common.style, pointerEvents: selectable ? "visiblePainted" : "none" }} />;
      break;
    case "text": {
      const fs = st.fontSize || 18;
      const lines = (d.text || "").split("\n");
      el = (
        <text x={d.x} y={d.y! + fs} fill={st.stroke} fontSize={fs} fontWeight={600} fontFamily="var(--font-ui), system-ui, sans-serif" opacity={st.opacity} {...common} style={{ ...common.style, userSelect: "none", paintOrder: "stroke", stroke: "rgba(255,255,255,.85)", strokeWidth: 3, strokeLinejoin: "round" }}>
          {lines.map((l, i) => (
            <tspan key={i} x={d.x} dy={i === 0 ? 0 : fs * 1.3}>{l || " "}</tspan>
          ))}
        </text>
      );
      break;
    }
  }
  const b = selected ? bounds(s) : null;
  return (
    <g>
      {el}
      {b && <rect data-selection x={b.x - 3} y={b.y - 3} width={b.w + 6} height={b.h + 6} fill="none" stroke="var(--blue)" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />}
    </g>
  );
}

/* ─── the layer ─────────────────────────────────────────────────────────── */

type Op = { kind: "add"; shape: Shape } | { kind: "del"; shape: Shape } | { kind: "upd"; before: Shape; after: Shape };

export function DrawLayer({ geom }: { geom: StageGeom }) {
  const mode = useStore((s) => s.mode);
  const tool = useStore((s) => s.tool);
  const style = useStore((s) => s.style);
  const shapes = useStore((s) => s.shapes);
  const viewport = useStore((s) => s.viewport);
  const review = useStore((s) => s.review);
  const viewer = useStore((s) => s.viewer);
  const selectedShape = useStore((s) => s.selectedShape);
  const showOthers = useStore((s) => s.showOthersDrawings);
  const viewOnly = useStore((s) => s.viewOnly);
  const set = useStore((s) => s.set);
  const upsert = useStore((s) => s.upsertShape);
  const remove = useStore((s) => s.removeShape);
  const toast = useStore((s) => s.toast);

  const [live, setLive] = useState<Shape | null>(null); // shape being drawn
  const [editing, setEditing] = useState<{ id: string; x: number; y: number; text: string } | null>(null);
  const undo = useRef<Op[]>([]);
  const redo = useRef<Op[]>([]);
  const drag = useRef<{ id: string; start: Shape; lastX: number; lastY: number } | null>(null);

  const drawing = mode === "draw" && !viewOnly;
  const visible = shapes.filter((s) => s.viewport_width === viewport && (showOthers || s.author_id === viewer.user_id));

  const persist = useCallback(
    async (s: Shape) => {
      if (!review) return;
      try {
        await api.putShape(review.id, s);
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },
    [review, toast],
  );

  const commit = useCallback(
    (op: Op, record = true) => {
      if (record) {
        undo.current.push(op);
        redo.current = [];
      }
      if (op.kind === "add") {
        upsert(op.shape);
        persist(op.shape);
      } else if (op.kind === "del") {
        remove(op.shape.id);
        api.deleteShape(op.shape.id).catch(() => {});
      } else {
        upsert(op.after);
        persist(op.after);
      }
    },
    [upsert, remove, persist],
  );

  // undo / redo / delete events (from shortcuts)
  useEffect(() => {
    const onUndo = () => {
      const op = undo.current.pop();
      if (!op) return;
      redo.current.push(op);
      if (op.kind === "add") commit({ kind: "del", shape: op.shape }, false);
      else if (op.kind === "del") commit({ kind: "add", shape: op.shape }, false);
      else commit({ kind: "upd", before: op.after, after: op.before }, false);
    };
    const onRedo = () => {
      const op = redo.current.pop();
      if (!op) return;
      undo.current.push(op);
      commit(op, false);
    };
    const onDelete = () => {
      const id = useStore.getState().selectedShape;
      const s = useStore.getState().shapes.find((x) => x.id === id);
      if (s) {
        commit({ kind: "del", shape: s });
        set({ selectedShape: null });
      }
    };
    window.addEventListener("redline:undo", onUndo);
    window.addEventListener("redline:redo", onRedo);
    window.addEventListener("redline:delete-shape", onDelete);
    return () => {
      window.removeEventListener("redline:undo", onUndo);
      window.removeEventListener("redline:redo", onRedo);
      window.removeEventListener("redline:delete-shape", onDelete);
    };
  }, [commit, set]);

  function make(type: Shape["type"], data: Shape["data"], st: ShapeStyle = style): Shape {
    const now = new Date().toISOString();
    return {
      id: newId(),
      review_id: review?.id || "",
      viewport_width: viewport,
      type,
      data,
      style: { ...st },
      author_id: viewer.user_id || null,
      author_name: viewer.name || "Anonymous",
      z: Date.now(),
      created_at: now,
      updated_at: now,
    };
  }

  /* pointer handlers on the drawing surface */
  function onDown(e: React.PointerEvent) {
    if (e.button !== 0 || tool === "select") return;
    if (editing) {
      finishText();
      if (tool !== "text") return;
    }
    const { x, y } = geom.toPage(e.clientX, e.clientY);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const pressure = e.pressure || 0.5;
    if (tool === "pen" || tool === "highlighter") setLive(make(tool, { points: [[x, y, pressure]] }));
    else if (tool === "line" || tool === "arrow") setLive(make(tool, { x, y, x2: x, y2: y }));
    else if (tool === "rect" || tool === "ellipse") setLive(make(tool, { x, y, w: 0, h: 0 }));
    else if (tool === "text") {
      // The native focus change of this pointerdown would land *after* React
      // mounts the editor and blur it straight away — keep focus where it is.
      e.preventDefault();
      const s = make("text", { x, y, text: "" });
      setEditing({ id: s.id, x, y, text: "" });
      setLive(s);
    }
  }

  function onMove(e: React.PointerEvent) {
    if (!live || tool === "text") return;
    const { x, y } = geom.toPage(e.clientX, e.clientY);
    const d = live.data;
    if (d.points) setLive({ ...live, data: { points: [...d.points, [x, y, e.pressure || 0.5]] } });
    else if (live.type === "line" || live.type === "arrow") {
      let x2 = x, y2 = y;
      if (e.shiftKey) {
        const dx = x - d.x!, dy = y - d.y!;
        if (Math.abs(dx) > Math.abs(dy)) y2 = d.y!;
        else x2 = d.x!;
      }
      setLive({ ...live, data: { ...d, x2, y2 } });
    } else {
      let w = x - d.x!, h = y - d.y!;
      if (e.shiftKey) {
        const m = Math.max(Math.abs(w), Math.abs(h));
        w = Math.sign(w) * m; h = Math.sign(h) * m;
      }
      setLive({ ...live, data: { x: Math.min(d.x!, d.x! + w), y: Math.min(d.y!, d.y! + h), w: Math.abs(w), h: Math.abs(h) } });
    }
  }

  function onUp() {
    if (!live || tool === "text") return;
    const d = live.data;
    const tiny =
      (d.points && d.points.length < 2) ||
      ((live.type === "rect" || live.type === "ellipse") && (d.w! < 3 || d.h! < 3)) ||
      ((live.type === "line" || live.type === "arrow") && Math.hypot(d.x2! - d.x!, d.y2! - d.y!) < 3);
    if (tiny) {
      // a click with the pen still leaves a dot
      if (d.points) commit({ kind: "add", shape: { ...live, data: { points: [...d.points, [d.points[0][0] + 0.1, d.points[0][1] + 0.1, 0.5]] } } });
    } else commit({ kind: "add", shape: live });
    setLive(null);
  }

  function finishText() {
    if (!editing) return;
    const text = editing.text.trim();
    const base = live && live.id === editing.id ? live : shapes.find((s) => s.id === editing.id);
    setEditing(null);
    setLive(null);
    if (!base) return;
    if (!text) {
      if (shapes.some((s) => s.id === base.id)) commit({ kind: "del", shape: base });
      return;
    }
    const after = { ...base, data: { ...base.data, text } };
    if (shapes.some((s) => s.id === base.id)) commit({ kind: "upd", before: base, after });
    else commit({ kind: "add", shape: after });
  }

  /* select / move */
  function onShapeDown(s: Shape, e: React.PointerEvent) {
    if (tool !== "select") return;
    e.stopPropagation();
    set({ selectedShape: s.id });
    const { x, y } = geom.toPage(e.clientX, e.clientY);
    drag.current = { id: s.id, start: s, lastX: x, lastY: y };
    const move = (ev: PointerEvent) => {
      if (!drag.current) return;
      const p = geom.toPage(ev.clientX, ev.clientY);
      const cur = useStore.getState().shapes.find((k) => k.id === drag.current!.id);
      if (!cur) return;
      upsert(translate(cur, p.x - drag.current.lastX, p.y - drag.current.lastY));
      drag.current.lastX = p.x;
      drag.current.lastY = p.y;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      const cur = useStore.getState().shapes.find((k) => k.id === d.id);
      if (cur && JSON.stringify(cur.data) !== JSON.stringify(d.start.data)) {
        undo.current.push({ kind: "upd", before: d.start, after: cur });
        redo.current = [];
        persist(cur);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const cursor = tool === "select" ? "default" : tool === "text" ? "text" : "crosshair";
  const all = live && live.type !== "text" ? [...visible, live] : visible;

  return (
    <>
      <PageLayer className={cn(drawing ? "z-[45]" : "z-[20]")}>
        <svg data-redline-draw-svg className="absolute left-0 top-0 h-full w-full overflow-visible" style={{ pointerEvents: "none" }}>
          {all.map((s) => (
            <ShapeView
              key={s.id}
              s={s}
              selectable={drawing && tool === "select"}
              selected={selectedShape === s.id}
              onPointerDown={(e) => onShapeDown(s, e)}
              onDoubleClick={() => {
                if (s.type === "text" && drawing) setEditing({ id: s.id, x: s.data.x!, y: s.data.y!, text: s.data.text || "" });
              }}
            />
          ))}
        </svg>
        {editing && (
          <textarea
            ref={(el) => {
              if (el && document.activeElement !== el) requestAnimationFrame(() => el.focus());
            }}
            value={editing.text}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            onBlur={finishText}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); finishText(); }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); finishText(); }
              e.stopPropagation();
            }}
            placeholder="Type…"
            spellCheck={false}
            className="pointer-events-auto absolute m-0 min-w-[120px] resize-none overflow-hidden rounded-sm bg-white/85 p-0.5 font-semibold leading-[1.3] outline outline-1 outline-blue"
            style={{ left: editing.x - 2, top: editing.y - 2, color: style.stroke, fontSize: style.fontSize || 18, fontFamily: "var(--font-ui)", width: Math.max(140, (editing.text.split("\n").reduce((m, l) => Math.max(m, l.length), 0) + 2) * (style.fontSize || 18) * 0.6) }}
            rows={Math.max(1, editing.text.split("\n").length)}
          />
        )}
      </PageLayer>

      {drawing && (
        <div
          className="absolute inset-0 z-[42] touch-none"
          style={{ cursor }}
          onPointerDown={(e) => {
            if (tool === "select") {
              set({ selectedShape: null });
              return;
            }
            onDown(e);
          }}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
      )}
    </>
  );
}
