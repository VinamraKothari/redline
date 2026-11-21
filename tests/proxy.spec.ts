import fs from "node:fs";
import path from "node:path";
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import sharp from "sharp";
import { createProject, createReview, FIXTURE, signIn } from "./helpers";
import { isOwnPage, isOwnPath } from "../src/lib/proxy/own-paths";

/**
 * Reviewed pages whose address looks like Redline's own. Redline's pages are
 * matched route by route (src/lib/proxy/own-paths.ts), so a shop's
 * /account/overview is an ordinary reviewed page: it sees its real path and
 * all its assets — images, mask icons, stylesheets and /_next/ chunks, also
 * the ones a script adds later — come from the site. A page at exactly one of
 * Redline's routes (/pricing) keeps its /api/proxy address and still gets its
 * images and icons. Redline's own pages keep their own chunks throughout.
 */

const SITE = new URL(FIXTURE).origin;

const framePath = (page: Page) =>
  page.evaluate(() => document.querySelector<HTMLIFrameElement>('iframe[title="Page under review"]')!.contentWindow!.location.pathname);

/**
 * Every resource the framed page loaded from Redline's origin (directly or
 * through the proxy) whose URL mentions `part`, with its HTTP status. The
 * images the proxy pointed straight at the site are cross-origin, and their
 * status is not visible to the page.
 */
async function resources(frame: FrameLocator, part: string) {
  return frame.locator("html").evaluate(
    (_el, part) =>
      (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
        .filter((e) => new URL(e.name).origin === location.origin && decodeURIComponent(e.name).includes(part))
        .map((e) => ({ url: e.name, status: e.responseStatus })),
    part,
  );
}

/** Mean brightness (0–255) of an element as rendered: a masked black icon is dark, an icon whose mask failed is not there. */
async function brightness(frame: FrameLocator, selector: string) {
  const png = await frame.locator(selector).screenshot();
  const { channels } = await sharp(png).stats();
  return (channels[0].mean + channels[1].mean + channels[2].mean) / 3;
}

async function expectAssetsLoaded(frame: FrameLocator, imgs: string[], icons: string[]) {
  for (const sel of imgs) await expect.poll(() => frame.locator(sel).evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBe(48);
  for (const sel of icons) await expect.poll(() => brightness(frame, sel)).toBeLessThan(160);
  // the root-relative requests themselves (not just the ones the proxy rewrote) answered 200
  await expect.poll(async () => (await resources(frame, "/images/")).filter((r) => !r.url.includes("/api/proxy")).length).toBeGreaterThan(0);
  const all = await resources(frame, "/images/");
  expect(all.filter((r) => r.status !== 200)).toEqual([]);
}

test("a shop's /account/overview sees its real path and loads every asset, chunks included", async ({ page }) => {
  const frame = await createReview(page, `${SITE}/account/overview`);
  await expect(frame.locator("h1")).toHaveText("Account overview");
  // not one of Redline's routes: the page is shown its own address (Next's usePathname works)
  expect(await framePath(page)).toBe("/account/overview");

  await expectAssetsLoaded(frame, ["#static-img", "#js-img"], ["#static-icon", "#js-icon"]);
  // the stylesheet in the HTML and the one the script added under /account/ both apply
  await expect(frame.locator("h1")).toHaveCSS("color", "rgb(5, 120, 85)");
  await expect(frame.locator("#static-bg")).toHaveCSS("background-image", /pic\.png/);
  await expect(frame.locator("#js-bg")).toHaveCSS("background-image", /pic\.png/);
  const css = await resources(frame, "/account/js-style.css");
  expect(css.length).toBeGreaterThan(0);
  expect(css.filter((r) => r.status !== 200)).toEqual([]);
  // the /_next/static chunk in the HTML and the one loaded later both ran — they are the site's
  await expect(frame.locator("html")).toHaveAttribute("data-main", "1");
  await expect(frame.locator("html")).toHaveAttribute("data-lazy", "1");
  const chunks = await resources(frame, "/_next/static/chunks/fixture-");
  expect(chunks.length).toBe(2);
  expect(chunks.filter((r) => r.status !== 200)).toEqual([]);
});

test("a page at exactly one of Redline's routes keeps the proxy address and still shows its images and icons", async ({ page }) => {
  const frame = await createReview(page, `${SITE}/pricing`);
  await expect(frame.locator("h1")).toHaveText("Pricing");
  expect(await framePath(page)).toBe("/api/proxy");
  await expectAssetsLoaded(frame, ["#static-img", "#js-img"], ["#static-icon", "#js-icon"]);
});

test("a page that moves its own address onto one of Redline's routes (as Next.js does) still gets its images and icons", async ({ page }) => {
  const frame = await createReview(page, `${SITE}/pricing?self=1`);
  await expect(frame.locator("h1")).toHaveText("Pricing");
  // every image it adds from here on has a Referer that looks like Redline's /pricing
  expect(await framePath(page)).toBe("/pricing");
  await expectAssetsLoaded(frame, ["#static-img", "#js-img"], ["#static-icon", "#js-icon"]);
});

test("a page at a path Redline doesn't use still sees its own path", async ({ page }) => {
  await createReview(page);
  expect(await framePath(page)).toBe("/site.html");
});

test("Redline's own pages keep their own chunks while a reviewed site is remembered", async ({ page }) => {
  await signIn(page);
  const project = await createProject(page);
  // a review sets the site cookie the fallbacks read
  await createReview(page, `${SITE}/account/overview`);
  const reviewPath = new URL(page.url()).pathname;
  expect((await page.context().cookies()).some((c) => c.name === "redline_site")).toBe(true);

  const bad: string[] = [];
  page.on("response", (r) => {
    if (r.frame() !== page.mainFrame() || !new URL(r.url()).pathname.startsWith("/_next/")) return;
    if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
    // what the proxy serves carries `access-control-allow-origin: *`; Redline's own files don't
    if (r.headers()["access-control-allow-origin"]) bad.push(`from the site: ${r.url()}`);
  });
  for (const p of ["/account", "/account/billing", "/admin", `/p/${project.id}`, reviewPath]) {
    await page.goto(p);
    await page.waitForLoadState("networkidle");
    const chunks = await page.evaluate(() =>
      (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
        .filter((e) => new URL(e.name).pathname.startsWith("/_next/static/"))
        .map((e) => ({ url: e.name, status: e.responseStatus })),
    );
    expect(chunks.length, p).toBeGreaterThan(0);
    expect(chunks.filter((c) => c.status !== 200), p).toEqual([]);
  }
  expect(bad).toEqual([]);

  // the routing rules, request by request (Referer and Sec-Fetch-Dest as a browser sends them)
  const base = new URL(page.url()).origin;
  const chunk = (await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name))).find((u) => /\/_next\/static\/chunks\/.*\.js$/.test(u))!;
  const own = await (await page.request.get(chunk)).text();
  // Redline's chunk asked for by Redline's pages: Redline's
  for (const ref of ["/account/billing", `/p/${project.id}`, "/pricing/"]) {
    const res = await page.request.get(chunk, { headers: { referer: base + ref, "sec-fetch-dest": "script" } });
    expect(await res.text(), ref).toBe(own);
  }
  // an image Redline doesn't have, asked for from /pricing: the remembered site's
  const img = await page.request.get("/images/pic.png", { headers: { referer: `${base}/pricing`, "sec-fetch-dest": "image" } });
  expect(img.status()).toBe(200);
  expect(img.headers()["content-type"]).toContain("image/png");
  // …but never code, and never a page visit
  for (const dest of ["script", "worker", "serviceworker", "manifest", "document", "iframe"]) {
    const res = await page.request.get("/images/pic.png", { headers: { referer: `${base}/pricing`, "sec-fetch-dest": dest } });
    expect(res.status(), dest).toBe(404);
  }
  // a reviewed page's asset at one of Redline's API paths comes from the site; the bridge it runs stays Redline's
  const fromPage = { referer: `${base}/api/proxy?url=${encodeURIComponent(`${SITE}/pricing`)}` };
  const css = await page.request.get("/account/js-style.css", { headers: { ...fromPage, "sec-fetch-dest": "style" } });
  expect(await css.text()).toContain(".js-bg");
  const bridge = await page.request.get("/bridge.js", { headers: { ...fromPage, "sec-fetch-dest": "script" } });
  expect(await bridge.text()).toContain("__redline");
});

/** The URL path Next.js serves a metadata file under src/app at (route groups dropped). */
function metadataRoute(rel: string): string | null {
  const parts = rel.split(path.sep);
  const file = parts.pop()!;
  const dir = parts.filter((p) => !/^\(.*\)$/.test(p));
  const base = file.replace(/\.[^.]+$/, "");
  let name: string | null = null;
  if (file === "favicon.ico") name = "favicon.ico";
  else if (base === "robots") name = "robots.txt";
  else if (base === "sitemap") name = "sitemap.xml";
  else if (base === "manifest") name = /\.(ts|js)$/.test(file) ? "manifest.webmanifest" : file;
  else if (/^(icon|apple-icon|opengraph-image|twitter-image)\d*$/.test(base)) name = base;
  return name ? "/" + [...dir, name].join("/") : null;
}

function walk(dir: string, root = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full, root) : [path.relative(root, full)];
  });
}

test("every file Redline serves from public/ and every app metadata file counts as Redline's own", () => {
  // otherwise a page under review could be handed the site's file of that name, and Redline's pages the site's too
  const served = [
    ...walk(path.join(__dirname, "../public")).map((f) => "/" + f.split(path.sep).join("/")),
    ...walk(path.join(__dirname, "../src/app")).filter((f) => !f.startsWith(`api${path.sep}`)).map(metadataRoute).filter((r): r is string => Boolean(r)),
  ];
  expect(served).toEqual(expect.arrayContaining(["/bridge.js", "/favicon.ico", "/robots.txt", "/sitemap.xml"]));
  expect(served.filter((p) => !isOwnPath(p))).toEqual([]);
});

test("every page the app has is one of Redline's own routes", () => {
  // a page missing from own-paths.ts would be taken for a reviewed page and load a site's /_next chunks
  const pages = walk(path.join(__dirname, "../src/app"))
    .filter((f) => path.basename(f) === "page.tsx")
    .map((f) => {
      const segs = path.dirname(f).split(path.sep).filter((s) => s !== "." && !/^\(.*\)$/.test(s));
      // dynamic segments: a uuid for an account id, else an id as newSlug() makes them
      const sample = segs.map((s, i) => (/^\[.*\]$/.test(s) ? (segs[i - 1] === "users" ? "00000000-0000-4000-8000-000000000001" : "k3m9x2a7q") : s));
      return "/" + sample.join("/");
    });
  expect(pages).toEqual(expect.arrayContaining(["/", "/account", "/admin/users/00000000-0000-4000-8000-000000000001", "/p/k3m9x2a7q/f/k3m9x2a7q", "/pricing"]));
  expect(pages.filter((p) => !isOwnPage(p))).toEqual([]);
  // …and only those: a shop's paths next to them are not
  for (const p of ["/account/overview", "/p/blue-shirt", "/admin/users/not-a-uuid", "/pricing/plans"]) expect(isOwnPage(p), p).toBe(false);
});

test("Redline's 404 pages keep Redline's chunks while a reviewed site is remembered", async ({ browser }) => {
  // a fresh browser that has only the cookie: nothing else to tell its requests apart
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const origin = new URL(test.info().project.use.baseURL!).origin;
  await ctx.addCookies([{ name: "redline_site", value: encodeURIComponent(SITE), url: origin }]);
  const page = await ctx.newPage();
  const foreign: string[] = [];
  const next: string[] = [];
  page.on("response", (r) => {
    if (!new URL(r.url()).pathname.startsWith("/_next/")) return;
    next.push(r.url());
    if (r.headers()["access-control-allow-origin"] || r.status() >= 400) foreign.push(`${r.status()} ${r.url()}`);
  });
  for (const p of ["/account/typo", "/foo"]) {
    const res = await page.goto(p);
    // the page visit itself was Redline's, not the site's
    expect(res!.status(), p).toBe(404);
    expect(res!.headers()["referrer-policy"], p).toBe("origin");
    await page.waitForLoadState("networkidle");
  }
  // not one of the routes either, but Redline answers it (the admin area sends a visitor to sign in)
  await page.goto("/admin/users/not-a-uuid");
  await page.waitForLoadState("networkidle");
  expect(next.length).toBeGreaterThan(0);
  expect(foreign).toEqual([]);
  await ctx.close();
});
