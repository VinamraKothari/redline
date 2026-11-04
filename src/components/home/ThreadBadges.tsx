"use client";

import type { OpenThreadCount } from "@/lib/types";
import { DEV_COLOR } from "@/lib/figma/dev";
import { cn } from "@/lib/util";

/** The two counts a card shows, in one tooltip sentence; empty when there's nothing open. */
export function describeOpenThreads(c: OpenThreadCount | undefined): string {
  if (!c) return "";
  const parts: string[] = [];
  if (c.open > 0) parts.push(`${c.open} unresolved comment${c.open === 1 ? "" : "s"}`);
  if (c.dev > 0) parts.push(`${c.dev} developer comment${c.dev === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/**
 * Small counts in the corner of a page or folder preview — like an app badge —
 * so nobody has to open a page to see whether anything is still unresolved.
 * Red for people's threads; a violet "</>" count for developer comments
 * ("Compare with Figma"), only when there are any.
 */
export function ThreadBadges({ counts, className }: { counts?: OpenThreadCount; className?: string }) {
  const label = describeOpenThreads(counts);
  if (!counts || !label) return null;
  return (
    <span className={cn("pointer-events-auto flex items-center gap-1", className)} title={label} aria-label={label} data-testid="thread-badges">
      {counts.dev > 0 && (
        <span
          data-badge="dev"
          style={{ background: DEV_COLOR }}
          className="num inline-flex h-[18px] min-w-[18px] items-center justify-center gap-0.5 rounded-full px-1.5 text-[10.5px] font-semibold leading-none text-white shadow-sm"
        >
          <span className="mono text-[8.5px] opacity-80">&lt;/&gt;</span>
          {counts.dev}
        </span>
      )}
      {counts.open > 0 && (
        <span data-badge="open" className="num inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red px-1.5 text-[10.5px] font-semibold leading-none text-white shadow-sm">
          {counts.open}
        </span>
      )}
    </span>
  );
}

/** Adds the counts of several pages (a folder's badge). */
export function sumOpenThreads(list: (OpenThreadCount | undefined)[]): OpenThreadCount {
  const total: OpenThreadCount = { open: 0, dev: 0 };
  for (const c of list) {
    if (!c) continue;
    total.open += c.open;
    total.dev += c.dev;
  }
  return total;
}
