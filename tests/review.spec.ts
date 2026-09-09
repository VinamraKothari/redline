import { expect, test, type Page } from "@playwright/test";

/**
 * End-to-end smoke test of the review flow against the local fixture site.
 * Requires: fixture server on :3999 and the app started with REDLINE_ALLOW_LOCAL=1.
 */
const FIXTURE = process.env.FIXTURE_URL || "http://localhost:3999/site.html";

/** Client-space point for an element inside the (CSS-scaled) review iframe. */
async function pointIn(page: Page, selector: string, dx = 0.3, dy = 0.5) {
  return page.evaluate(
    ({ selector, dx, dy }) => {
      const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="Page under review"]')!;
      const fr = iframe.getBoundingClientRect();
      const zoom = fr.width / iframe.offsetWidth;
      const el = iframe.contentDocument!.querySelector(selector)!;
      const r = el.getBoundingClientRect();
      return { x: fr.left + (r.left + r.width * dx) * zoom, y: fr.top + (r.top + r.height * dy) * zoom, w: r.width, h: r.height };
    },
    { selector, dx, dy },
  );
}

async function createReview(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder(/Paste a URL/).fill(FIXTURE);
  await page.getByRole("button", { name: "Review" }).click();
  await page.waitForURL(/\/r\/[a-z0-9]+/);
  const frame = page.frameLocator('iframe[title="Page under review"]');
  await expect(frame.locator("h1")).toHaveText("Ship better design reviews");
  return frame;
}

test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Design feedback");
});

test("creates a review, proxies the page, neutralises frame busting", async ({ page }) => {
  const frame = await createReview(page);
  // We're still on our own origin (frame-buster did not escape)
  expect(page.url()).toMatch(/\/r\//);
  // Title picked up from the page
  await expect(page.locator("header").getByText("Acme — Fixture page")).toBeVisible();
  // Stylesheet was proxied and applied (card border from fixture css)
  const shadow = await frame.locator(".card").first().evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow).not.toBe("none");
});

test("comment: pin, thread, reply, resolve, panel sections, CSV export", async ({ page }) => {
  const frame = await createReview(page);
  // comment mode is the default for the creator
  const pt = await pointIn(page, '[data-testid="headline"]', 0.1, 0.5);
  await page.mouse.click(pt.x, pt.y);

  // composer opens; first-time name prompt inline
  await page.getByPlaceholder(/Your name/).fill("Priya Test");
  await page.getByPlaceholder(/Leave a comment/).fill("The headline feels too heavy at this size.");
  await page.keyboard.press("Enter");

  // pin visible + tile in Pending
  await expect(page.locator("aside").getByText("The headline feels too heavy")).toBeVisible();
  await expect(page.locator("aside").getByText("Pending")).toBeVisible();
  // thread popover shows element label from the anchor
  await page.locator("aside").getByText("The headline feels too heavy").click();
  await expect(page.getByText(/h1/).first()).toBeVisible();

  // reply
  await page.getByPlaceholder("Reply…").fill("Agreed — try 40px.");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Agreed — try 40px.")).toBeVisible();

  // resolve
  await page.getByRole("button", { name: "Mark as resolved" }).click();
  await expect(page.locator("aside").getByRole("button", { name: /^Resolved/ })).toBeVisible();

  // CSV export endpoint has the row in Jira shape
  const id = page.url().match(/\/r\/([a-z0-9]+)/)![1];
  const res = await page.request.get(`/api/reviews/${id}/export?format=jira`);
  expect(res.status()).toBe(200);
  const csv = await res.text();
  expect(csv).toContain("Summary,Description,Issue Type,Priority,Status,Labels,Labels,Reporter,Created,Comment");
  expect(csv).toContain("Done");
  expect(csv).toContain("Priya Test");
  expect(csv).toMatch(/\d{2}\/[A-Z][a-z]{2}\/\d{2} \d{1,2}:\d{2} [AP]M;Priya Test;Agreed — try 40px\./);
});

test("inspect: hover, select, typography panel, alt-measure", async ({ page }) => {
  const frame = await createReview(page);
  await page.keyboard.press("i");
  const h1 = await pointIn(page, "h1", 0.1, 0.5);
  const p = await pointIn(page, ".hero p", 0.1, 0.5);
  await page.mouse.move(h1.x, h1.y);
  await page.mouse.click(h1.x, h1.y);
  const aside = page.locator("aside");
  await expect(aside.getByText("Typography")).toBeVisible();
  await expect(aside.getByText("Georgia")).toBeVisible();
  await expect(aside.getByText("48px").first()).toBeVisible();
  await expect(aside.getByText("Colours")).toBeVisible();

  // alt + hover the paragraph → a red measurement label appears
  await page.keyboard.down("Alt");
  await page.mouse.move(p.x, p.y);
  await expect(page.locator(".measure-line").first()).toBeAttached();
  await page.keyboard.up("Alt");

  // ctrl deep-select flag toggles
  await page.keyboard.down("Control");
  await page.mouse.move(h1.x + 5, h1.y + 2);
  await page.keyboard.up("Control");
});

test("draw: pen stroke persists and survives reload", async ({ page }) => {
  await createReview(page);
  await page.keyboard.press("d");
  const a = await pointIn(page, ".grid", 0.2, 0.3);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 100, a.y + 50, { steps: 8 });
  await page.mouse.move(a.x + 200, a.y + 20, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator("[data-redline-draw-svg] path")).toHaveCount(1);
  await page.reload();
  await expect(page.locator("[data-redline-draw-svg] path")).toHaveCount(1, { timeout: 15000 });
});

test("full screen hides chrome; navigation inside the frame shows banner", async ({ page }) => {
  const frame = await createReview(page);
  await page.keyboard.press("v");
  await page.keyboard.press("f");
  await expect(page.locator("header")).toHaveCount(0);
  await expect(page.getByText("Exit")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("header")).toBeVisible();

  // click a link inside the page → proxied navigation + banner
  const link = await pointIn(page, 'a.btn[href$="/pricing.html"]', 0.5, 0.5);
  await page.mouse.click(link.x, link.y);
  await expect(page.getByText(/You.ve left the reviewed page/)).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(frame.locator("h1")).toHaveText("Ship better design reviews");
});

test("view-only link hides authoring tools", async ({ page }) => {
  await createReview(page);
  await page.goto(page.url() + "?mode=view");
  await expect(page.locator("nav").getByLabel(/Comment/)).toHaveCount(0);
  await expect(page.locator("nav").getByLabel(/Inspect/)).toBeVisible();
});

test("falls back to a static render when the site's scripts destroy the document", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder(/Paste a URL/).fill(FIXTURE.replace(/site\.html$/, "spa-crash.html"));
  await page.getByRole("button", { name: "Review" }).click();
  await page.waitForURL(/\/r\/[a-z0-9]+/);
  const frame = page.frameLocator('iframe[title="Page under review"]');
  // the bridge reports the crash, the stage reloads with js=0
  await expect(page.getByText(/scripts crashed inside the reviewer/)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('iframe[title="Page under review"]')).toHaveAttribute("src", /js=0/);
  await expect(frame.locator('[data-testid="spa-headline"]')).toHaveText("Server-rendered headline");
  await expect(frame.locator('[data-testid="noscript-note"]')).toBeVisible();
  await expect(frame.locator("html")).toHaveAttribute("data-redline-static", "1");
  // the crash screen never comes back
  await page.waitForTimeout(600);
  await expect(frame.locator("#__next_error__")).toHaveCount(0);
  // the toggle switches scripts back on (and the page crashes again → falls back again)
  await page.getByRole("button", { name: /Site scripts: off/ }).click();
  await expect(page.locator('iframe[title="Page under review"]')).not.toHaveAttribute("src", /js=0/);
});

test("client apps hydrate: relative fetch/XHR, dynamic chunks and module imports go through the proxy", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder(/Paste a URL/).fill(FIXTURE.replace(/site\.html$/, "spa.html"));
  await page.getByRole("button", { name: "Review" }).click();
  await page.waitForURL(/\/r\/[a-z0-9]+/);
  const frame = page.frameLocator('iframe[title="Page under review"]');
  await expect(frame.locator('[data-testid="wishlist"]')).toHaveText("Your wishlist is empty", { timeout: 15_000 });
  await expect(frame.locator('[data-testid="status"]')).toHaveText("hydrated");
  // ES module import of an absolute path resolved via the catch-all redirect
  const flags = await page.evaluate(() => {
    const w = document.querySelector<HTMLIFrameElement>('iframe[title="Page under review"]')!.contentWindow as Window & {
      __modLoaded?: boolean;
      __depLoaded?: boolean;
    };
    return { mod: w.__modLoaded, dep: w.__depLoaded };
  });
  expect(flags).toEqual({ mod: true, dep: true });
  // no fallback was triggered
  await expect(page.locator('iframe[title="Page under review"]')).not.toHaveAttribute("src", /js=0/);
  // bundler contract: the site's script keeps its literal root-relative src
  // (Turbopack registers chunks by it) yet loads same-origin via src/proxy.ts
  const bundler = await page.evaluate(() => {
    const w = document.querySelector<HTMLIFrameElement>('iframe[title="Page under review"]')!.contentWindow as Window & {
      __appSrcAttr?: string;
      __appStarted?: boolean;
    };
    return { attr: w.__appSrcAttr, started: w.__appStarted, base: w.document.baseURI };
  });
  expect(bundler.attr).toBe("/app.js");
  expect(bundler.started).toBe(true);
  expect(bundler.base).toContain("/api/proxy?url=");
  // images/links were made absolute to the site instead
  const img = await frame.locator("img").first().getAttribute("src");
  expect(img).toMatch(/^http:\/\/localhost:3999\//);
});
