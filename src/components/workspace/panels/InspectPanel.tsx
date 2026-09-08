"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, MousePointerClick, RefreshCw } from "lucide-react";
import { Segmented, Tip, IconButton } from "@/components/ui/primitives";
import { useStore } from "@/lib/store";
import { frame } from "@/lib/frame/controller";
import { inspect, resolveSelector, rgbToHex, summarize, type DesignSummary, type ElementInfo } from "@/lib/frame/dom";
import { cn } from "@/lib/util";

/* ─── bits ──────────────────────────────────────────────────────────────── */

function useCopy() {
  const toast = useStore((s) => s.toast);
  return (text: string, what = "Copied") => navigator.clipboard.writeText(text).then(() => toast(`${what} — ${text.length > 24 ? text.slice(0, 24) + "…" : text}`));
}

function Row({ k, v, mono = true, copy }: { k: string; v: React.ReactNode; mono?: boolean; copy?: string }) {
  const doCopy = useCopy();
  if (v == null || v === "" || v === "none" || v === "normal" || v === "auto" || v === "0px" || v === "static") return null;
  return (
    <div className="group flex items-baseline gap-2 py-[3px]">
      <span className="w-[86px] shrink-0 text-[11.5px] text-ink-3">{k}</span>
      <span className={cn("min-w-0 flex-1 truncate text-[12px] text-ink", mono && "mono")} title={typeof v === "string" ? v : undefined}>
        {v}
      </span>
      {copy && (
        <button type="button" onClick={() => doCopy(copy, k)} className="text-ink-3 opacity-0 hover:text-ink group-hover:opacity-100" title="Copy">
          <Copy size={11} />
        </button>
      )}
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  const doCopy = useCopy();
  const hex = rgbToHex(color);
  if (/rgba?\(\s*0,\s*0,\s*0,\s*0\)|transparent/.test(color)) return null;
  return (
    <button type="button" onClick={() => doCopy(hex.split(" ")[0], label)} className="group flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-hover" title="Click to copy hex">
      <span className="h-5 w-5 shrink-0 rounded-md" style={{ background: color, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.12)" }} />
      <span className="w-[74px] shrink-0 text-[11.5px] text-ink-3">{label}</span>
      <span className="mono flex-1 truncate text-[12px] text-ink">{hex}</span>
      <Copy size={11} className="text-ink-3 opacity-0 group-hover:opacity-100" />
    </button>
  );
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="border-b border-line px-3 py-2.5">
      <div className="mb-1 flex items-center">
        <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-3">{title}</h3>
        <div className="flex-1" />
        {right}
      </div>
      {children}
    </section>
  );
}

function BoxDiagram({ info }: { info: ElementInfo }) {
  const m = info.box.margin.map((v) => v.replace("px", ""));
  const p = info.box.padding.map((v) => v.replace("px", ""));
  const b = info.box.borderWidth.map((v) => v.replace("px", ""));
  const n = (v: string) => (v === "0" ? "–" : v);
  return (
    <div className="mono select-none text-[10px]">
      <div className="rounded-md px-2 pb-1 pt-1 text-center" style={{ background: "var(--margin-fill)" }}>
        <div className="text-[9px] uppercase tracking-wider text-ink-2">margin <span className="ml-1">{n(m[0])}</span></div>
        <div className="flex items-center">
          <span className="w-6 text-ink-2">{n(m[3])}</span>
          <div className="flex-1 rounded-md px-2 pb-1 pt-1 text-center" style={{ background: "rgba(200,200,200,.5)", outline: "1px dashed rgba(0,0,0,.25)" }}>
            <div className="text-[9px] uppercase tracking-wider text-ink-2">border <span className="ml-1">{n(b[0])}</span></div>
            <div className="flex items-center">
              <span className="w-5 text-ink-2">{n(b[3])}</span>
              <div className="flex-1 rounded-md px-2 pb-1 pt-1 text-center" style={{ background: "var(--padding-fill)" }}>
                <div className="text-[9px] uppercase tracking-wider text-ink-2">padding <span className="ml-1">{n(p[0])}</span></div>
                <div className="flex items-center">
                  <span className="w-5 text-ink-2">{n(p[3])}</span>
                  <div className="flex-1 rounded-md py-1.5 text-center font-semibold text-ink" style={{ background: "var(--content-fill)" }}>
                    {Math.round(info.rect.w)} × {Math.round(info.rect.h)}
                  </div>
                  <span className="w-5 text-right text-ink-2">{n(p[1])}</span>
                </div>
                <div className="text-ink-2">{n(p[2])}</div>
              </div>
              <span className="w-5 text-right text-ink-2">{n(b[1])}</span>
            </div>
            <div className="text-ink-2">{n(b[2])}</div>
          </div>
          <span className="w-6 text-right text-ink-2">{n(m[1])}</span>
        </div>
        <div className="text-ink-2">{n(m[2])}</div>
      </div>
    </div>
  );
}

/* ─── element view ──────────────────────────────────────────────────────── */

function ElementView({ info }: { info: ElementInfo }) {
  const set = useStore((s) => s.set);
  const doCopy = useCopy();
  const t = info.typography;
  const c = info.colors;
  const b = info.box;

  const css = useMemo(() => {
    const lines = [
      `font-family: ${t.family};`,
      `font-size: ${t.size};`,
      `font-weight: ${t.weight};`,
      `line-height: ${t.lineHeight};`,
      t.letterSpacing !== "0px" ? `letter-spacing: ${t.letterSpacing};` : null,
      t.transform !== "none" ? `text-transform: ${t.transform};` : null,
      `color: ${rgbToHex(c.text).split(" ")[0]};`,
      !/rgba\(0, 0, 0, 0\)/.test(c.background) ? `background: ${rgbToHex(c.background).split(" ")[0]};` : null,
      b.padding.some((v) => v !== "0px") ? `padding: ${b.padding.join(" ")};` : null,
      b.margin.some((v) => v !== "0px") ? `margin: ${b.margin.join(" ")};` : null,
      b.borderStyle !== "none" ? `border: ${b.borderWidth[0]} ${b.borderStyle} ${rgbToHex(c.border).split(" ")[0]};` : null,
      b.radius !== "0px" ? `border-radius: ${b.radius};` : null,
      b.shadow !== "none" ? `box-shadow: ${b.shadow};` : null,
      `width: ${Math.round(info.rect.w)}px;`,
      `height: ${Math.round(info.rect.h)}px;`,
    ].filter(Boolean);
    return lines.join("\n");
  }, [info, t, c, b]);

  const crumbs = info.path.split(" › ");

  return (
    <div>
      {/* breadcrumb */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 border-b border-line px-3 py-2 text-[11px]">
        {crumbs.map((part, i) => (
          <button
            key={i}
            type="button"
            className={cn("mono rounded px-1 py-0.5 hover:bg-hover", i === crumbs.length - 1 ? "bg-active text-ink" : "text-ink-2")}
            title={i === crumbs.length - 1 ? "Selected element" : "Select this ancestor"}
            onClick={() => {
              const doc = frame().doc;
              if (!doc) return;
              let el = resolveSelector(doc, info.selector);
              for (let k = crumbs.length - 1; k > i && el?.parentElement; k--) el = el.parentElement;
              if (el) set({ selected: inspect(el) });
            }}
          >
            {part}
            {i < crumbs.length - 1 && <span className="ml-1 text-ink-3">›</span>}
          </button>
        ))}
      </div>

      <Section title="Size & position">
        <Row k="Width" v={`${Math.round(info.rect.w * 10) / 10}px`} copy={`${Math.round(info.rect.w)}px`} />
        <Row k="Height" v={`${Math.round(info.rect.h * 10) / 10}px`} copy={`${Math.round(info.rect.h)}px`} />
        <Row k="X / Y" v={`${Math.round(info.rect.x)}, ${Math.round(info.rect.y)}`} />
        <Row k="Display" v={b.display === "block" ? undefined : b.display} />
        <Row k="Position" v={b.position} />
        {b.display.includes("flex") && (
          <>
            <Row k="Direction" v={b.flexDirection} />
            <Row k="Justify" v={b.justify === "normal" || b.justify === "flex-start" ? undefined : b.justify} />
            <Row k="Align" v={b.alignItems === "normal" || b.alignItems === "stretch" ? undefined : b.alignItems} />
          </>
        )}
        <Row k="Gap" v={b.gap} />
        <Row k="Z-index" v={b.zIndex} />
        <Row k="Overflow" v={b.overflow === "visible" ? undefined : b.overflow} />
      </Section>

      {(info.text || info.tag === "input" || info.tag === "button" || info.tag === "a") && (
        <Section title="Typography">
          <div className="mb-1.5 rounded-md bg-paper px-2 py-1.5 hairline">
            <div
              className="truncate"
              style={{ fontFamily: t.family, fontSize: Math.min(22, parseFloat(t.size)), fontWeight: t.weight as React.CSSProperties["fontWeight"], fontStyle: t.style, letterSpacing: t.letterSpacing, textTransform: t.transform as React.CSSProperties["textTransform"], color: c.text, background: c.effectiveBackground, padding: "2px 4px", borderRadius: 4 }}
            >
              {info.text || "Aa Bb Cc 123"}
            </div>
          </div>
          <Row k="Font" v={t.primaryFamily} copy={t.family} />
          <Row k="Size" v={t.size} copy={t.size} />
          <Row k="Weight" v={t.weight} copy={t.weight} />
          <Row k="Line height" v={`${t.lineHeight}${t.lineHeight !== "normal" ? ` (${(parseFloat(t.lineHeight) / parseFloat(t.size)).toFixed(2)})` : ""}`} copy={t.lineHeight} />
          <Row k="Letter spacing" v={t.letterSpacing} copy={t.letterSpacing} />
          <Row k="Transform" v={t.transform} />
          <Row k="Align" v={t.align === "start" || t.align === "left" ? undefined : t.align} />
          <Row k="Style" v={t.style} />
          <Row k="Decoration" v={t.decoration} />
          {info.contrast && (
            <div className="mt-1 flex items-center gap-2 rounded-md bg-paper px-2 py-1.5 hairline">
              <span className="mono text-[12px] font-semibold text-ink">{info.contrast.ratio.toFixed(2)}:1</span>
              <span className="text-[11px] text-ink-3">contrast</span>
              <div className="flex-1" />
              <Badge ok={info.contrast.aa} label="AA" />
              <Badge ok={info.contrast.aaa} label="AAA" />
              {info.contrast.large && <span className="text-[10px] text-ink-3">large text</span>}
            </div>
          )}
        </Section>
      )}

      <Section title="Colours">
        <Swatch color={c.text} label="Text" />
        <Swatch color={c.background} label="Background" />
        {b.borderStyle !== "none" && parseFloat(b.borderWidth[0]) > 0 && <Swatch color={c.border} label="Border" />}
        {c.background !== c.effectiveBackground && /rgba\(0, 0, 0, 0\)|transparent/.test(c.background) && (
          <Swatch color={c.effectiveBackground} label="Behind" />
        )}
      </Section>

      <Section title="Box model">
        <BoxDiagram info={info} />
        <div className="mt-2">
          <Row k="Padding" v={b.padding.every((v) => v === b.padding[0]) ? b.padding[0] : b.padding.join(" ")} copy={b.padding.join(" ")} />
          <Row k="Margin" v={b.margin.every((v) => v === b.margin[0]) ? b.margin[0] : b.margin.join(" ")} copy={b.margin.join(" ")} />
          <Row k="Border" v={b.borderStyle !== "none" && parseFloat(b.borderWidth[0]) > 0 ? `${b.borderWidth[0]} ${b.borderStyle}` : undefined} />
          <Row k="Radius" v={b.radius} copy={b.radius} />
          <Row k="Shadow" v={b.shadow} copy={b.shadow} />
          <Row k="Opacity" v={b.opacity === "1" ? undefined : b.opacity} />
        </div>
      </Section>

      {(info.img || info.a || Object.keys(info.attributes).length > 0) && (
        <Section title="Element">
          {info.img && (
            <>
              <Row k="Image" v={info.img.natural + " natural"} />
              <Row k="Source" v={info.img.src.split("/").pop()} copy={info.img.src} />
            </>
          )}
          {info.a && <Row k="Link" v={info.a.href} copy={info.a.href} />}
          {Object.entries(info.attributes)
            .filter(([k]) => !["src", "href", "srcset"].includes(k))
            .slice(0, 6)
            .map(([k, v]) => (
              <Row key={k} k={k} v={v} copy={v} />
            ))}
        </Section>
      )}

      <div className="flex items-center gap-2 px-3 py-2.5">
        <button type="button" onClick={() => doCopy(css, "CSS")} className="flex h-7 items-center gap-1.5 rounded-md bg-hover px-2.5 text-[12px] font-medium text-ink hover:bg-active">
          <Copy size={12} /> Copy CSS
        </button>
        <button type="button" onClick={() => doCopy(info.selector, "Selector")} className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] text-ink-2 hover:bg-hover">
          Copy selector
        </button>
      </div>
      <p className="px-3 pb-3 text-[11px] leading-relaxed text-ink-3">
        Hold <span className="kbd">Alt</span> and hover another element to measure the distance. Hold <span className="kbd">Ctrl</span> / <span className="kbd">⌘</span> to target the innermost element.
      </p>
    </div>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", ok ? "bg-green/15 text-green" : "bg-red-soft text-red-ink")}>
      {ok ? "✓" : "✕"} {label}
    </span>
  );
}

/* ─── page summary ──────────────────────────────────────────────────────── */

function SummaryView() {
  const frameReady = useStore((s) => s.frameReady);
  const layoutTick = useStore((s) => s.layoutTick);
  const [sum, setSum] = useState<DesignSummary | null>(null);
  const [stale, setStale] = useState(false);
  const doCopy = useCopy();

  const run = () => {
    const doc = frame().doc;
    if (!doc) return;
    setSum(summarize(doc));
    setStale(false);
  };
  useEffect(() => {
    if (frameReady) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameReady]);
  useEffect(() => {
    if (sum) setStale(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutTick]);

  if (!sum) return <p className="p-4 text-[12.5px] text-ink-3">Waiting for the page…</p>;

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[11.5px] text-ink-3">
        Whole-page summary of what&apos;s actually rendered.
        <div className="flex-1" />
        <Tip label={stale ? "Page changed — refresh" : "Refresh"} side="left">
          <IconButton size="sm" onClick={run} className={stale ? "!text-red" : ""}>
            <RefreshCw size={13} />
          </IconButton>
        </Tip>
      </div>

      <Section title={`Fonts · ${sum.fonts.length}`}>
        {sum.fonts.slice(0, 8).map((f) => (
          <div key={f.family} className="py-1.5">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-[13px] font-medium text-ink" style={{ fontFamily: `"${f.family}"` }}>{f.family}</span>
              <span className="num ml-auto text-[10.5px] text-ink-3">{f.count} el</span>
            </div>
            <div className="mono mt-0.5 flex flex-wrap gap-1 text-[10.5px] text-ink-2">
              <span className="text-ink-3">w</span>
              {f.weights.map((w) => <span key={w} className="rounded bg-hover px-1">{w}</span>)}
              <span className="ml-1 text-ink-3">size</span>
              {f.sizes.slice(0, 9).map((s) => <span key={s} className="rounded bg-hover px-1">{s.replace("px", "")}</span>)}
              {f.sizes.length > 9 && <span className="text-ink-3">+{f.sizes.length - 9}</span>}
            </div>
          </div>
        ))}
      </Section>

      <Section title={`Colours · ${sum.colors.length}`}>
        <div className="grid grid-cols-6 gap-1.5 py-1">
          {sum.colors.map((c) => (
            <button
              key={c.color}
              type="button"
              onClick={() => doCopy(c.hex.split(" ")[0], "Colour")}
              className="group flex flex-col items-center gap-1"
              title={`${c.hex} · ${c.count}× as ${Array.from(c.usedFor).join(", ")}`}
            >
              <span className="h-8 w-full rounded-md transition-transform group-hover:scale-105" style={{ background: c.color, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.1)" }} />
              <span className="mono text-[9px] text-ink-3">{c.hex.split(" ")[0].replace("#", "")}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Spacing scale">
        <div className="flex flex-wrap gap-1 py-1">
          {sum.spacing.map((s) => (
            <span key={s.value} className="mono rounded bg-hover px-1.5 py-0.5 text-[11px] text-ink" title={`${s.count}×`}>
              {s.value.replace("px", "")}
            </span>
          ))}
        </div>
        <p className="text-[10.5px] text-ink-3">Most common padding, margin and gap values.</p>
      </Section>

      <Section title={`Headings · ${sum.headings.length}`}>
        {sum.headings.length === 0 && <p className="text-[12px] text-ink-3">No h1–h6 elements found.</p>}
        {sum.headings.map((h, i) => (
          <div key={i} className="flex items-baseline gap-2 py-1">
            <span className="mono w-6 shrink-0 text-[10.5px] font-semibold text-red-ink">{h.tag}</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{h.text || <i className="text-ink-3">empty</i>}</span>
            <span className="mono shrink-0 text-[10.5px] text-ink-3">{h.size.replace("px", "")}/{h.weight}</span>
          </div>
        ))}
      </Section>
    </div>
  );
}

/* ─── panel ──────────────────────────────────────────────────────────────── */

export function InspectPanel() {
  const selected = useStore((s) => s.selected);
  const hover = useStore((s) => s.hover);
  const mode = useStore((s) => s.mode);
  const [tab, setTab] = useState<"element" | "page">("element");

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b border-line px-2 py-1.5">
        <Segmented value={tab} onChange={setTab} options={[{ value: "element", label: "Element" }, { value: "page", label: "Page summary" }]} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "page" ? (
          <SummaryView />
        ) : selected ? (
          <ElementView info={selected} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <MousePointerClick size={22} className="text-ink-3" />
            <p className="text-[12.5px] text-ink-2">{mode === "inspect" ? "Click an element to inspect it." : "Switch to Inspect to select an element."}</p>
            <p className="text-[11.5px] leading-relaxed text-ink-3">
              {hover ? <span className="mono">{hover.label}</span> : <>Hover shows the box model; <span className="kbd">Alt</span> measures between elements.</>}
            </p>
            {mode !== "inspect" && (
              <button type="button" onClick={() => useStore.getState().setMode("inspect")} className="mt-1 rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-white">
                Inspect <span className="kbd ml-1 !bg-white/10 !border-white/10 !text-white/80">I</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

