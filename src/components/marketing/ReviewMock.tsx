import { CodeXml, Lock, MessageCircle, MousePointer2, Pencil, Ruler } from "lucide-react";
import { cn } from "@/lib/util";

/**
 * "How a review looks": a browser frame around a skeleton of a reviewed
 * page, with the things Redline puts on top of it — numbered comment pins,
 * a violet developer comment from the Figma comparison, a blue inspection
 * box and a red measuring guide, plus a freehand stroke. Pure HTML/CSS so it
 * scales from a phone to a wide hero and stays in the brand's own colours.
 */
export function ReviewMock({ className }: { className?: string }) {
  return (
    <div className={cn("relative select-none overflow-hidden rounded-xl bg-panel shadow-pop hairline", className)} aria-hidden>
      {/* browser chrome */}
      <div className="flex h-10 items-center gap-3 border-b border-line px-3">
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-2 w-2 rounded-full bg-line-strong" />
          ))}
        </div>
        <div className="mono flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md bg-paper px-2 text-[11px] text-ink-2 hairline">
          <Lock size={10} className="shrink-0 text-ink-3" />
          <span className="truncate">acme.com/pricing</span>
        </div>
        <div className="mono hidden items-center rounded-md bg-hover p-0.5 text-[10px] sm:flex">
          <span className="rounded-[4px] bg-panel px-1.5 py-0.5 text-ink shadow-sm">1440</span>
          <span className="px-1.5 text-ink-3">1024</span>
          <span className="px-1.5 text-ink-3">390</span>
        </div>
        <div className="flex items-center gap-0.5">
          {[MousePointer2, MessageCircle, Pencil, Ruler].map((Icon, i) => (
            <span
              key={i}
              className={cn("flex h-6 w-6 items-center justify-center rounded-md", i === 1 ? "bg-ink text-white" : "text-ink-3")}
            >
              <Icon size={13} />
            </span>
          ))}
        </div>
      </div>

      {/* canvas with the reviewed page */}
      <div className="mk-canvas relative aspect-[16/11]">
        <div className="absolute inset-x-[7%] top-[6%] bottom-0 rounded-t-md bg-panel shadow-[0_0_0_1px_var(--line)]">
          {/* page skeleton: nav */}
          <div className="mk-bar-ink absolute left-[6%] top-[4%] h-[4%] w-[8%]" />
          <div className="absolute right-[6%] top-[4.5%] flex w-[26%] justify-end gap-[8%]">
            <span className="mk-bar h-[5px] w-full" />
            <span className="mk-bar h-[5px] w-full" />
            <span className="mk-bar h-[5px] w-full" />
          </div>
          {/* hero: headline, paragraph, buttons */}
          <div className="mk-bar-ink absolute left-[6%] top-[16%] h-[6%] w-[46%]" />
          <div className="mk-bar-ink absolute left-[6%] top-[24%] h-[6%] w-[33%]" />
          <div className="mk-bar absolute left-[6%] top-[34%] h-[2.4%] w-[44%]" />
          <div className="mk-bar absolute left-[6%] top-[38.5%] h-[2.4%] w-[40%]" />
          <div className="mk-bar absolute left-[6%] top-[43%] h-[2.4%] w-[28%]" />
          <div className="absolute left-[6%] top-[49%] h-[7%] w-[15%] rounded-[4px] bg-ink" />
          <div className="absolute left-[23%] top-[49%] h-[7%] w-[13%] rounded-[4px] shadow-[inset_0_0_0_1px_var(--line-strong)]" />
          {/* hero image */}
          <div className="absolute left-[58%] top-[14%] h-[40%] w-[36%] rounded-[6px] bg-hover shadow-[inset_0_0_0_1px_var(--line)]">
            <div className="absolute left-[10%] top-[12%] h-[30%] w-[36%] rounded-[4px] bg-line" />
            <div className="mk-bar absolute left-[10%] top-[52%] h-[5%] w-[70%]" />
            <div className="mk-bar absolute left-[10%] top-[64%] h-[5%] w-[52%]" />
          </div>
          {/* three cards */}
          {[6, 38, 70].map((left) => (
            <div key={left} style={{ left: `${left}%` }} className="absolute top-[70%] h-[30%] w-[24%] rounded-t-[6px] bg-paper shadow-[0_0_0_1px_var(--line)]">
              <div className="absolute left-[10%] top-[12%] h-[34%] w-[80%] rounded-[4px] bg-hover" />
              <div className="mk-bar-ink absolute left-[10%] top-[56%] h-[7%] w-[54%]" />
              <div className="mk-bar absolute left-[10%] top-[70%] h-[5%] w-[76%]" />
              <div className="mk-bar absolute left-[10%] top-[80%] h-[5%] w-[60%]" />
            </div>
          ))}

          {/* ── what Redline adds ── */}
          {/* a comment thread on the headline */}
          <Pin n={1} left="5.5%" top="15.5%" />
          <div className="absolute left-[50%] top-[7%] hidden w-[44%] min-w-[184px] rounded-lg bg-panel p-3 shadow-pop hairline sm:block">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red text-[9px] font-semibold text-white">PK</span>
              <span className="text-[11.5px] font-semibold text-ink">Priya</span>
              <span className="text-[11px] text-ink-3">2 min ago</span>
            </div>
            <p className="mt-1.5 text-[11.5px] leading-snug text-ink">Headline feels heavy at this size — try 600 instead of 700?</p>
            <div className="mt-2 flex items-center justify-between">
              <span className="mono text-[10px] text-ink-3">h1 · 1440</span>
              <span className="rounded-md bg-hover px-1.5 py-0.5 text-[10px] text-ink-2">Reply…</span>
            </div>
          </div>

          {/* a developer comment from the Figma comparison, on the second headline line */}
          <span
            className="absolute flex h-[22px] w-[22px] -translate-x-1/2 -translate-y-full items-center justify-center rounded-[11px_11px_11px_2px] bg-violet text-white shadow-pin"
            style={{ left: "39.5%", top: "24%" }}
          >
            <CodeXml size={12} strokeWidth={2.5} />
          </span>
          <div className="absolute left-[54%] top-[46%] hidden w-[40%] rounded-lg border-l-2 sm:block border-violet bg-panel px-2.5 py-2 shadow-pop hairline">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-violet">
              <CodeXml size={11} /> Copy · high
            </div>
            <p className="mt-1 text-[11px] leading-snug text-ink">
              Reads <span className="mono">Ship faster</span>, the design says <span className="mono">Ship better</span>.
            </p>
          </div>

          {/* inspect: the secondary button is selected, with its size */}
          <div className="pointer-events-none absolute left-[23%] top-[49%] h-[7%] w-[13%] rounded-[4px] shadow-[0_0_0_1.5px_var(--blue)]">
            <span className="mono absolute -top-[15px] right-0 whitespace-nowrap rounded-[3px] bg-blue px-1 py-px text-[9px] font-medium text-white">132 × 40</span>
          </div>

          {/* measure: the gap between the buttons and the cards */}
          <svg className="pointer-events-none absolute left-[9%] top-[56%] h-[14%] w-[10%] overflow-visible" viewBox="0 0 40 40" preserveAspectRatio="none">
            <line x1="20" y1="0" x2="20" y2="40" className="measure-line" vectorEffect="non-scaling-stroke" />
            <line x1="0" y1="0.5" x2="40" y2="0.5" className="measure-ext" vectorEffect="non-scaling-stroke" />
            <line x1="0" y1="39.5" x2="40" y2="39.5" className="measure-ext" vectorEffect="non-scaling-stroke" />
          </svg>
          <span className="mono absolute left-[15%] top-[60.5%] rounded-[3px] bg-red px-1 py-px text-[9px] font-medium text-white">48</span>

          {/* a second thread on the middle card, and a freehand ring around the third */}
          <Pin n={2} left="52%" top="76%" />
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path
              d="M 75 73 C 66 80, 68 101, 84 103 S 103 95, 100 82 S 92 70, 80 72"
              fill="none"
              stroke="var(--red)"
              strokeWidth="2"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      </div>

      {/* status bar: who's here, what's open */}
      <div className="flex h-8 items-center justify-between border-t border-line px-3 text-[11px] text-ink-3">
        <span>
          <span className="font-medium text-ink-2">3 pending</span> · 1 resolved
        </span>
        <span className="flex items-center gap-1.5">
          <span className="flex -space-x-1">
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-red text-[8px] font-semibold text-white ring-2 ring-panel">PK</span>
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-blue text-[8px] font-semibold text-white ring-2 ring-panel">JW</span>
          </span>
          Jonas is here
        </span>
      </div>
    </div>
  );
}

function Pin({ n, left, top }: { n: number; left: string; top: string }) {
  return (
    <span
      className="absolute flex h-[22px] w-[22px] -translate-x-1/2 -translate-y-full items-center justify-center rounded-[11px_11px_11px_2px] bg-red text-[11px] font-bold text-white shadow-pin"
      style={{ left, top }}
    >
      {n}
    </span>
  );
}
