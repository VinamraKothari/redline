"use client";

import { useCallback, useRef } from "react";
import { useStore } from "@/lib/store";
import { frame } from "@/lib/frame/controller";
import { cn } from "@/lib/util";

/**
 * An overlay the size of the iframe viewport whose children are positioned in
 * page coordinates. The frame controller translates it by the page's scroll
 * directly inside the scroll event, so pins and drawings stay glued to the
 * content without waiting for a React render.
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
  const doc = useStore((s) => s.docSize);
  const unfollow = useRef<(() => void) | null>(null);
  const inner = useCallback((el: HTMLDivElement | null) => {
    unfollow.current?.();
    unfollow.current = el ? frame().follow(el) : null;
  }, []);
  return (
    <div className={cn("absolute inset-0 overflow-hidden", interactive ? "pointer-events-auto" : "pointer-events-none", className)} style={style}>
      <div ref={inner} className="absolute left-0 top-0" style={{ width: doc.w, height: doc.h, willChange: "transform" }}>
        {children}
      </div>
    </div>
  );
}
