"use client";

import { toCanvas } from "html-to-image";
import { frame } from "./frame/controller";
import { useStore, threadRoots } from "./store";
import { initials } from "./util";

/**
 * Renders the full page (as currently displayed) plus drawings and comment
 * pins into a PNG. Best effort: cross-origin images that refuse CORS are
 * skipped by html-to-image.
 */
export async function toPng(viewport: number): Promise<Blob | null> {
  const doc = frame().doc;
  if (!doc?.documentElement) return null;
  const st = useStore.getState();
  const w = viewport;
  const h = Math.min(st.docSize.h, 20000);

  const page = await toCanvas(doc.documentElement as HTMLElement, {
    width: w,
    height: h,
    pixelRatio: 1,
    cacheBust: false,
    skipFonts: false,
    filter: (n) => !(n instanceof HTMLScriptElement),
    style: { transform: "none" },
  });

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(page, 0, 0);

  // drawings: serialise the live SVG layer
  const svg = document.querySelector<SVGSVGElement>("[data-redline-draw-svg]");
  if (svg) {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    clone.querySelectorAll("[data-selection]").forEach((n) => n.remove());
    const src = new XMLSerializer().serializeToString(clone).replace(/var\(--font-ui\)/g, "system-ui").replace(/var\(--blue\)/g, "#2c6cf6");
    const img = new Image();
    await new Promise<void>((res) => {
      img.onload = () => res();
      img.onerror = () => res();
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(src);
    });
    try {
      ctx.drawImage(img, 0, 0);
    } catch {
      /* ignore */
    }
  }

  // pins
  if (st.showComments) {
    const roots = threadRoots(st.comments).filter((c) => c.viewport_width === viewport && (st.showResolved || !c.resolved) && c.anchor);
    ctx.font = "700 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const c of roots) {
      const p = frame().resolveAnchor(c.anchor!);
      if (c.anchor!.region) {
        const r = c.anchor!.region;
        ctx.strokeStyle = "#e2342b";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      }
      const x = p.x + 16, y = p.y - 16;
      ctx.beginPath();
      ctx.fillStyle = c.resolved ? "#1f9d55" : c.author_color;
      ctx.moveTo(p.x, p.y);
      ctx.arc(x, y, 16, Math.PI * 0.5, Math.PI * 2.5);
      ctx.lineTo(p.x, p.y);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.fillText(c.resolved ? "✓" : initials(c.author_name), x, y);
    }
  }

  return await new Promise<Blob | null>((res) => out.toBlob(res, "image/png"));
}
