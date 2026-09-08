"use client";

import { useStore } from "@/lib/store";
import { cn } from "@/lib/util";

/**
 * An overlay the size of the iframe viewport whose children are positioned in
 * page coordinates; it translates by the page's scroll so pins and drawings
 * stay glued to the content.
 */
export function PageLayer({
  children,
  className,
  interactive = false,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
  style?: React.CSSProperties;
}) {
  const scroll = useStore((s) => s.scroll);
  const doc = useStore((s) => s.docSize);
  return (
    <div className={cn("absolute inset-0 overflow-hidden", interactive ? "pointer-events-auto" : "pointer-events-none", className)} style={style}>
      <div
        className="absolute left-0 top-0"
        style={{ width: doc.w, height: doc.h, transform: `translate(${-scroll.x}px, ${-scroll.y}px)`, willChange: "transform" }}
      >
        {children}
      </div>
    </div>
  );
}
