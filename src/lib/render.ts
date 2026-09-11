import sharp from "sharp";
import { launchBrowser, NAV_TIMEOUT } from "./screenshot";

/**
 * Full-page renders of a review snapshot with the markup drawn on top.
 * Used for the PNG export (page in numbered sections) and for the Jira CSV
 * (one crop per comment). The snapshot is the reviewer's own DOM (see
 * serializeDocument), so what the export shows is what they saw — including
 * locked hover states and frozen pages.
 */

export interface RenderPin {
  id: string;
  /** 1-based number shown in the marker (= row order of the CSV) */
  n: number;
  x: number;
  y: number;
  color: string;
  region?: { x: number; y: number; w: number; h: number } | null;
}

export interface RenderInput {
  html: string;
  /** the page's own URL — resolves any relative reference left in the snapshot */
  baseUrl: string;
  width: number;
  pins: RenderPin[];
  /** the drawing layer as an <svg> string in page coordinates (optional) */
  overlaySvg?: string | null;
}

export interface FullRender {
  /** PNG of the whole page with markup */
  png: Buffer;
  width: number;
  height: number;
}

const MAX_HEIGHT = 40_000;
const FULLPAGE_LIMIT = 16_000;

/** Undo the proxy's URL rewriting so a browser outside Redline can load the assets straight from the site. */
export function unproxyHtml(html: string, baseUrl: string): string {
  let out = html.replace(/https?:\/\/[^/"'\s)]+\/api\/proxy\?url=([^"'\s)&]+)/g, (_m, enc: string) => {
    try {
      return decodeURIComponent(enc);
    } catch {
      return enc;
    }
  });
  // the bridge is meaningless outside the reviewer; keep the rest of the scripts out too
  out = out.replace(/<script\b[^>]*\bsrc=["'][^"']*\/bridge\.js["'][^>]*>\s*<\/script>/gi, "");
  out = out.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  const extra = `<base href="${baseUrl.replace(/"/g, "&quot;")}"><style data-redline-render>
html{scrollbar-width:none}html::-webkit-scrollbar{display:none}
*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}
[data-redline-hover-lock]{}
</style>`;
  return /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, (m) => m + extra) : extra + out;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Numbered markers (and dashed region boxes) as an SVG the size of the page. */
export function pinsSvg(pins: RenderPin[], width: number, height: number): string {
  const parts: string[] = [];
  for (const p of pins) {
    const x = Math.max(16, Math.min(width - 16, p.x));
    const y = Math.max(16, Math.min(height - 16, p.y));
    if (p.region) {
      parts.push(
        `<rect x="${p.region.x}" y="${p.region.y}" width="${p.region.w}" height="${p.region.h}" fill="${esc(p.color)}" fill-opacity="0.08" stroke="${esc(p.color)}" stroke-width="2" stroke-dasharray="6 4" rx="3"/>`,
      );
    }
    parts.push(
      `<g><circle cx="${x}" cy="${y}" r="15" fill="${esc(p.color)}" stroke="#fff" stroke-width="2.5"/>` +
        `<text x="${x}" y="${y + 4.5}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="#fff">${p.n}</text></g>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
}

/** Make the client's drawing SVG self-contained (namespace, size, no CSS variables). */
function normalizeOverlay(svg: string, width: number, height: number): string {
  let s = svg.trim();
  s = s.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
    const cleaned = attrs
      .replace(/\s(width|height|viewBox|class|style|data-[\w-]+)(="[^"]*"|='[^']*')?/g, "")
      .replace(/\sxmlns="[^"]*"/g, "");
    return `<svg xmlns="http://www.w3.org/2000/svg"${cleaned} width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  });
  s = s.replace(/var\(--font-ui\)[^;"']*/g, "Helvetica, Arial, sans-serif").replace(/var\(--[\w-]+\)/g, "#2563eb");
  return s;
}

export async function renderFull(input: RenderInput): Promise<FullRender> {
  const width = Math.max(320, Math.min(input.width, 2560));
  const browser = await launchBrowser(width, 1000, 1);
  try {
    const page = await browser.newPage();
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    await page.setContent(unproxyHtml(input.html, input.baseUrl), { waitUntil: "load", timeout: NAV_TIMEOUT }).catch(() => {});
    // images and fonts: give them a moment, but never wait forever
    await page
      .evaluate(
        () =>
          Promise.race([
            Promise.all([
              document.fonts?.ready ?? Promise.resolve(),
              ...Array.from(document.images)
                .filter((i) => !i.complete)
                .map((i) => new Promise<void>((r) => ((i.onload = () => r()), (i.onerror = () => r())))),
            ]),
            new Promise((r) => setTimeout(r, 8000)),
          ]),
      )
      .catch(() => {});
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 300))));
    const height = Math.min(
      MAX_HEIGHT,
      Math.max(400, await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0))),
    );

    let base: Buffer;
    if (height <= FULLPAGE_LIMIT) {
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 200))));
      const shot = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height }, captureBeyondViewport: true });
      base = Buffer.from(shot as Uint8Array);
    } else {
      // very long page: stitch viewport-sized slices
      const slice = 4000;
      await page.setViewport({ width, height: slice, deviceScaleFactor: 1 });
      const parts: { input: Buffer; top: number; left: number }[] = [];
      for (let y = 0; y < height; y += slice) {
        const h = Math.min(slice, height - y);
        await page.evaluate((yy) => window.scrollTo(0, yy), y);
        await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 120))));
        const shot = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height: h } });
        parts.push({ input: Buffer.from(shot as Uint8Array), top: y, left: 0 });
      }
      base = await sharp({ create: { width, height, channels: 3, background: "#fff" } })
        .composite(parts)
        .png()
        .toBuffer();
    }

    const pinLayer = input.pins.length ? [{ input: Buffer.from(pinsSvg(input.pins, width, height)), top: 0, left: 0 }] : [];
    let png = base;
    if (input.overlaySvg) {
      // a drawing that librsvg can't parse must not sink the whole export
      try {
        png = await sharp(base)
          .composite([{ input: Buffer.from(normalizeOverlay(input.overlaySvg, width, height)), top: 0, left: 0 }, ...pinLayer])
          .png()
          .toBuffer();
        return { png, width, height };
      } catch (e) {
        console.warn("[redline] drawing overlay skipped:", (e as Error).message);
      }
    }
    if (pinLayer.length) png = await sharp(base).composite(pinLayer).png().toBuffer();
    return { png, width, height };
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Cut a full render into sections of at most `maxH` px (PNG). */
export async function sections(full: FullRender, maxH = 5000): Promise<{ n: number; y: number; height: number; png: Buffer }[]> {
  const out: { n: number; y: number; height: number; png: Buffer }[] = [];
  const count = Math.ceil(full.height / maxH);
  for (let i = 0; i < count; i++) {
    const y = i * maxH;
    const h = Math.min(maxH, full.height - y);
    const png = await sharp(full.png).extract({ left: 0, top: y, width: full.width, height: h }).png().toBuffer();
    out.push({ n: i + 1, y, height: h, png });
  }
  return out;
}

/** A crop around one pin (or its region) as JPEG. */
export async function cropAround(full: FullRender, pin: RenderPin, w = 960, h = 600): Promise<Buffer> {
  let box: { left: number; top: number; width: number; height: number };
  if (pin.region) {
    // the region plus context around it, never smaller than a regular crop
    const m = 80;
    const bw = Math.max(pin.region.w + 2 * m, w);
    const bh = Math.max(pin.region.h + 2 * m, h);
    box = { left: pin.region.x + pin.region.w / 2 - bw / 2, top: pin.region.y + pin.region.h / 2 - bh / 2, width: bw, height: bh };
  } else {
    box = { left: pin.x - w / 2, top: pin.y - h * 0.42, width: w, height: h };
  }
  box.width = Math.min(box.width, full.width);
  box.height = Math.min(box.height, full.height);
  box.left = Math.round(Math.max(0, Math.min(full.width - box.width, box.left)));
  box.top = Math.round(Math.max(0, Math.min(full.height - box.height, box.top)));
  box.width = Math.round(box.width);
  box.height = Math.round(box.height);
  return sharp(full.png).extract(box).jpeg({ quality: 86 }).toBuffer();
}
