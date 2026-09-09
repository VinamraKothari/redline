import puppeteer, { type Browser } from "puppeteer-core";
import { fetchableUrl } from "./proxy/hosts";

/**
 * Server-side page previews with headless Chromium.
 *
 * On Vercel the browser comes from @sparticuz/chromium (a Lambda-compatible
 * build); anywhere else set REDLINE_CHROME_PATH to a Chrome/Chromium binary.
 * Rendering in a real browser on the server keeps the reviewer's tab free —
 * DOM-to-image capture in the client froze large commerce pages for a minute.
 */

export interface ShotOptions {
  /** page to open (live / frozen-by-url reviews) */
  url?: string;
  /** raw HTML to render instead (uploaded files, stored snapshots) */
  html?: string;
  /** CSS viewport width of the review */
  width: number;
  /** how much of the page to show, in CSS px */
  height?: number;
  /** output width in device px */
  outWidth?: number;
}

/**
 * Third-party widgets that would sit on top of every preview: cookie banners,
 * chat launchers, marketing pop-ups. A preview is a picture of the design,
 * not of the consent flow, so their scripts are not loaded.
 */
const NOISE_HOSTS =
  /(^|\.)(cookiebot\.com|consentcdn\.cookiebot\.com|cookielaw\.org|onetrust\.com|cookieyes\.com|usercentrics\.eu|app\.usercentrics\.eu|privacy-center\.org|didomi\.io|quantcast\.mgr\.consensu\.org|consensu\.org|trustarc\.com|iubenda\.com|cookie-script\.com|osano\.com|termly\.io|klaro\.kiprotect\.com|cookiefirst\.com|cookiehub\.com|consentmanager\.net|intercom\.io|intercomcdn\.com|drift\.com|driftt\.com|crisp\.chat|hs-scripts\.com|hubspot\.com|tawk\.to|zdassets\.com|zendesk\.com|freshchat\.com|livechatinc\.com|tidio\.co|gorgias\.chat|hotjar\.com|klaviyo\.com|privy\.com|justuno\.com|optinmonster\.com|wisepops\.com)$/i;
const NOISE_PATHS = /(cookieconsent|cookie-consent|cookiebanner|cookie-banner|consent-manager|cmp\.js|intercom|livechat|chat-widget)/i;

function isNoise(url: string): boolean {
  try {
    const u = new URL(url);
    return NOISE_HOSTS.test(u.hostname) || NOISE_PATHS.test(u.pathname);
  } catch {
    return false;
  }
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Redline/1.0 (+design review preview)";
const NAV_TIMEOUT = 15_000;
const TOTAL_TIMEOUT = 40_000;

function onLambda(): boolean {
  return !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!process.env.AWS_EXECUTION_ENV;
}

export function screenshotsAvailable(): boolean {
  return !!process.env.REDLINE_CHROME_PATH || onLambda();
}

async function launch(width: number, height: number, scale: number): Promise<Browser> {
  const local = process.env.REDLINE_CHROME_PATH;
  if (local) {
    return puppeteer.launch({
      executablePath: local,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--hide-scrollbars"],
      defaultViewport: { width, height, deviceScaleFactor: scale },
    });
  }
  if (!onLambda()) throw new Error("No browser for previews: set REDLINE_CHROME_PATH.");
  const chromium = (await import("@sparticuz/chromium")).default;
  return puppeteer.launch({
    executablePath: await chromium.executablePath(),
    headless: true,
    args: [...chromium.args, "--hide-scrollbars"],
    defaultViewport: { width, height, deviceScaleFactor: scale },
  });
}

/** JPEG bytes of the top of the page. Throws if nothing could be rendered. */
export async function screenshotPage(opts: ShotOptions): Promise<Uint8Array> {
  const width = Math.max(320, Math.min(opts.width, 2560));
  const height = Math.max(400, Math.min(opts.height ?? Math.round(width * 0.75), 2000));
  const scale = Math.min(1, (opts.outWidth ?? 800) / width);

  const browser = await launch(width, height, scale);
  const killer = setTimeout(() => browser.close().catch(() => {}), TOTAL_TIMEOUT);
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    if (opts.html != null) {
      await page.setContent(opts.html, { waitUntil: "load", timeout: NAV_TIMEOUT }).catch(() => {});
    } else if (opts.url) {
      if (!fetchableUrl(opts.url)) throw new Error("That address can't be rendered.");
      // the page may redirect or load sub-resources from private hosts; never follow those
      await page.setRequestInterception(true);
      page.on("request", (r) => {
        const u = r.url();
        if (u.startsWith("data:") || u.startsWith("blob:")) return void r.continue().catch(() => {});
        if (!fetchableUrl(u) || (r.resourceType() !== "document" && isNoise(u))) return void r.abort().catch(() => {});
        r.continue().catch(() => {});
      });
      // a slow page is still worth a picture; an unreachable one is not
      await page.goto(opts.url, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT }).catch((e: Error) => {
        if (/net::ERR_|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION/.test(String(e.message))) throw new Error(`the page could not be opened (${(e.message.match(/net::ERR_[A-Z_]+/) || [e.message])[0]})`);
      });
    } else {
      throw new Error("Nothing to capture.");
    }
    // self-hosted cookie banners / overlays that made it through: hide anything
    // fixed-position whose id or class talks about cookies or consent
    await page
      .evaluate(() => {
        const sel = '[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="gdpr" i],[class*="gdpr" i],[aria-label*="cookie" i]';
        document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
          const pos = getComputedStyle(el).position;
          if (pos === "fixed" || pos === "sticky") el.style.setProperty("display", "none", "important");
        });
        document.body.style.overflow = "";
      })
      .catch(() => {});
    // let lazy images in the first screen start, then settle
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 600))));
    const shot = await page.screenshot({ type: "jpeg", quality: 80, clip: { x: 0, y: 0, width, height }, captureBeyondViewport: false });
    return shot instanceof Uint8Array ? shot : new Uint8Array(shot as ArrayBuffer);
  } finally {
    clearTimeout(killer);
    await browser.close().catch(() => {});
  }
}
