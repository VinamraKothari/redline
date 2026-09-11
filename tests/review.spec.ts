import { readFileSync } from "node:fs";
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

/** Test-mode sign-in (REDLINE_TEST_AUTH=1): a trusted cookie instead of Google. */
async function signIn(page: Page, name = "Priya Test") {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const id = `00000000-0000-4000-8000-${slug.replace(/[^0-9a-f]/g, "0").padEnd(12, "0").slice(0, 12)}`;
  const res = await page.request.post("/api/auth/test", { data: { id, email: `${slug}@example.test`, name } });
  expect(res.ok()).toBeTruthy();
  // creates the profile row and claims pending invites
  await page.request.get("/api/me");
  return { id, email: `${slug}@example.test`, name };
}

async function createProject(page: Page, name = "Acme redesign") {
  const res = await page.request.post("/api/projects", { data: { name } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).project as { id: string };
}

/** Signs in, creates a project and starts a review of the fixture page through the UI. */
async function createReview(page: Page, fixture = FIXTURE) {
  await signIn(page);
  const project = await createProject(page);
  await page.goto(`/p/${project.id}`);
  await page.getByPlaceholder(/paste a URL/i).fill(fixture);
  await page.getByRole("button", { name: "Review" }).click();
  await page.waitForURL(/\/r\/[a-z0-9]+/);
  const frame = page.frameLocator('iframe[title="Page under review"]');
  if (fixture === FIXTURE) await expect(frame.locator("h1")).toHaveText("Ship better design reviews");
  await settle(page);
  return frame;
}

/** Waits until the review iframe has stopped moving/resizing (layout settled after load). */
async function settle(page: Page) {
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        const el = document.querySelector('iframe[title="Page under review"]');
        if (!el) return resolve(false);
        const a = el.getBoundingClientRect();
        setTimeout(() => {
          const b = el.getBoundingClientRect();
          resolve(a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);
        }, 250);
      }),
    undefined,
    { timeout: 10_000, polling: 100 },
  );
}

test("landing page: hero + URL box for visitors, protected pages redirect, projects once signed in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Design feedback");
  await expect(page.getByRole("button", { name: /Continue with Google/ })).toBeVisible();
  // a protected page sends you to sign in and remembers where you were going
  await page.goto("/p/nope");
  await expect(page).toHaveURL(/\/login\?next=%2Fp%2Fnope/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Design feedback");

  // the URL box on the landing page: sign in (test mode) → /start → pick a project → review
  await page.goto("/");
  await page.getByLabel("Web address to review").fill(FIXTURE);
  await page.getByRole("button", { name: "Sign in as test user" }).click();
  await page.waitForURL(/\/start\?url=/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Start the review");
  await page.getByLabel("New project name").fill("First project");
  await page.getByRole("button", { name: /^Review/ }).click();
  await page.waitForURL(/\/r\/[a-z0-9]+/);
  await expect(page.frameLocator('iframe[title="Page under review"]').locator("h1")).toHaveText("Ship better design reviews");

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("projects");
  await expect(page.getByText("First project").first()).toBeVisible();
  await page.getByLabel("New project name").fill("Gem House");
  await page.getByRole("button", { name: /Create/ }).click();
  await page.waitForURL(/\/p\/[a-z0-9]+/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Gem House");
  await expect(page.getByText("You are an admin")).toBeVisible();
});

test("projects: invite by e-mail with a role, viewers can't edit, non-members can't open", async ({ page, browser }) => {
  await createReview(page);
  const url = page.url();
  const reviewId = url.match(/\/r\/([a-z0-9]+)/)![1];
  const review = await (await page.request.get(`/api/reviews/${reviewId}`)).json();
  const pid = review.review.project_id as string;

  // invite a viewer (who has never signed in) and an editor
  const inv = await page.request.post(`/api/projects/${pid}/members`, { data: { email: "sam-viewer@example.test", role: "view" } });
  expect(inv.ok()).toBeTruthy();
  expect((await inv.json()).invite).toBeTruthy();

  // the admin adds a second page to the same project
  const second = await page.request.post("/api/reviews", { data: { project_id: pid, url: FIXTURE.replace(/site\.html$/, "pricing.html"), viewport: 1024 } });
  expect(second.ok()).toBeTruthy();

  // the viewer signs in: the invite is claimed, the review opens read-only,
  // and the page switcher lists both pages of the project
  const viewerCtx = await browser.newContext();
  const vp = await viewerCtx.newPage();
  await signIn(vp, "Sam Viewer");
  const vp2 = vp;
  await vp.goto(url);
  await expect(vp.frameLocator('iframe[title="Page under review"]').locator("h1")).toHaveText("Ship better design reviews");
  await expect(vp.locator("nav").getByLabel(/Comment/)).toHaveCount(0);
  await vp.getByRole("button", { name: "Pages in this project" }).click();
  await expect(vp.locator('[role="menuitem"][href^="/r/"]')).toHaveCount(2);
  await expect(vp.getByRole("menuitem", { name: /Add a page/ })).toBeVisible();
  await vp.keyboard.press("Escape");
  const denied = await vp.request.post(`/api/reviews/${reviewId}/comments`, {
    data: { body: "nope", viewport_width: 1440, anchor: { selector: null, fx: 0, fy: 0, px: 1, py: 1 } },
  });
  expect(denied.status()).toBe(403);

  // a stranger gets a 404, not the page
  const strangerCtx = await browser.newContext();
  const sp = await strangerCtx.newPage();
  await signIn(sp, "Eve Stranger");
  const res = await sp.goto(url);
  expect(res?.status()).toBe(404);
  expect((await sp.request.get(`/api/reviews/${reviewId}`)).status()).toBe(404);
  await strangerCtx.close();

  // members dialog shows the viewer with their role
  await page.goto(`/p/${pid}`);
  await page.getByRole("button", { name: /member/ }).click();
  await expect(page.getByText("Sam Viewer")).toBeVisible();
  await expect(page.getByLabel("Role of Sam Viewer")).toHaveValue("view");
  await page.keyboard.press("Escape");

  // page management: rename from the tile menu, move to another project
  await page.getByRole("button", { name: "Options for Acme — Fixture page" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("Page name").fill("Homepage v2");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("link", { name: /Homepage v2/ }).first()).toBeVisible();
  // a viewer may neither rename nor move pages
  expect((await vp2.request.patch(`/api/reviews/${reviewId}`, { data: { title: "Nope" } })).status()).toBe(403);
  await viewerCtx.close();
  const otherName = `Other project ${Date.now().toString(36)}`;
  const other = await createProject(page, otherName);
  await page.getByRole("button", { name: "Options for Homepage v2" }).click();
  await page.getByRole("menuitem", { name: /Move to project/ }).click();
  await page.getByRole("dialog").getByRole("radio", { name: otherName }).click();
  await page.getByRole("button", { name: "Move" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Homepage v2/ })).toHaveCount(0);
  const moved = await (await page.request.get(`/api/projects/${other.id}`)).json();
  expect(moved.reviews.map((r: { id: string }) => r.id)).toContain(reviewId);
  // moving into a project you can't edit is refused
  expect((await page.request.patch(`/api/reviews/${reviewId}`, { data: { project_id: "nope" } })).status()).toBe(403);
});

test("creates a review, proxies the page, neutralises frame busting, captures a preview", async ({ page }) => {
  const frame = await createReview(page);
  // the page sees its own path, not /api/proxy?url=… (frameworks read window.location)
  expect(await page.evaluate(() => document.querySelector<HTMLIFrameElement>('iframe[title="Page under review"]')!.contentWindow!.location.pathname)).toBe("/site.html");
  // a preview of the page is captured a few seconds after load and shown on the project page
  const id = page.url().match(/\/r\/([a-z0-9]+)/)![1];
  await expect
    .poll(async () => ((await (await page.request.get(`/api/reviews/${id}`)).json()).review.thumbnail_url ? "yes" : "no"), { timeout: 20_000 })
    .toBe("yes");
  const thumb = await page.request.get((await (await page.request.get(`/api/reviews/${id}`)).json()).review.thumbnail_url);
  expect(thumb.status()).toBe(200);
  expect(thumb.headers()["content-type"]).toContain("image/jpeg");
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

  // composer opens with the signed-in identity — no name prompt
  await expect(page.getByPlaceholder(/Your name/)).toHaveCount(0);
  await page.getByLabel("Comment title").fill("Headline weight");
  await page.getByPlaceholder(/Leave a comment/).fill("The headline feels too heavy at this size.");
  await page.keyboard.press("Enter");

  // pin visible + tile in Pending, with the title
  await expect(page.locator("aside").getByText("The headline feels too heavy")).toBeVisible();
  await expect(page.locator("aside").getByText("Headline weight")).toBeVisible();
  await expect(page.locator("aside").getByText("Pending")).toBeVisible();
  // thread popover shows element label from the anchor
  await page.locator("aside").getByText("The headline feels too heavy").click();
  await expect(page.getByText(/h1/).first()).toBeVisible();

  // reply with an image
  await page.getByPlaceholder("Reply…").fill("Agreed — try 40px.");
  await page.getByPlaceholder("Reply…").evaluate((el) => {
    const dt = new DataTransfer();
    const png = atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==");
    const bytes = new Uint8Array(png.length);
    for (let i = 0; i < png.length; i++) bytes[i] = png.charCodeAt(i);
    dt.items.add(new File([bytes], "shot.png", { type: "image/png" }));
    el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('img[alt="shot.png"]').first()).toBeVisible();
  await page.getByPlaceholder("Reply…").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Agreed — try 40px.")).toBeVisible();

  // edit the title from the thread header
  await page.getByTitle("Edit title").click();
  await page.getByLabel("Thread title").fill("Headline is too heavy");
  await page.keyboard.press("Enter");
  await expect(page.locator("aside").getByText("Headline is too heavy")).toBeVisible();

  // resolve
  await page.getByRole("button", { name: "Mark as resolved" }).click();
  await expect(page.locator("aside").getByRole("button", { name: /^Resolved/ })).toBeVisible();

  // CSV export endpoint has the row in Jira shape: title as Summary, the reply as
  // Comment, the image as a public Attachment URL that Jira can download
  const id = page.url().match(/\/r\/([a-z0-9]+)/)![1];
  const res = await page.request.get(`/api/reviews/${id}/export?format=jira`);
  expect(res.status()).toBe(200);
  const csv = await res.text();
  expect(csv).toContain("Summary,Description,Issue Type,Priority,Status,Labels,Labels,Reporter,Created,Comment,Attachment");
  expect(csv).toMatch(/\r\nHeadline is too heavy,/);
  expect(csv).toContain("Done");
  expect(csv).toContain("Priya Test");
  expect(csv).toMatch(/\d{2}\/[A-Z][a-z]{2}\/\d{2} \d{1,2}:\d{2} [AP]M;Priya Test;Agreed — try 40px\./);
  const att = csv.match(/;Priya Test;shot\.png;(http[^,"\r\n]+)/);
  expect(att).toBeTruthy();
  const img = await page.request.get(att![1]);
  expect(img.status()).toBe(200);
  expect(img.headers()["content-type"]).toBe("image/png");
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
  const frame = await createReview(page, FIXTURE.replace(/site\.html$/, "spa-crash.html"));
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

test("a client re-render that swaps the <html> element is not treated as a crash", async ({ page }) => {
  const frame = await createReview(page, FIXTURE.replace(/site\.html$/, "spa-rehydrate.html"));
  await expect(frame.locator('[data-testid="spa-headline"]')).toHaveText("Client-rendered headline");
  await expect(frame.locator('[data-testid="price"]')).toHaveText("€1,123");
  await page.waitForTimeout(1500);
  await expect(page.locator('iframe[title="Page under review"]')).not.toHaveAttribute("src", /js=0/);
  await expect(page.getByText(/scripts crashed inside the reviewer/)).toHaveCount(0);
  // the new root is adopted so comments can still anchor to it
  await expect(frame.locator("html")).toHaveAttribute("data-redline", "1");
});

test("lock hover (H): CSS and JS hover menus stay open while the pointer is elsewhere", async ({ page }) => {
  const frame = await createReview(page, FIXTURE.replace(/site\.html$/, "hover.html"));
  await expect(frame.locator("#css-trigger")).toBeVisible();
  // hover the CSS menu inside the page (browse mode: the page gets the pointer)
  await page.keyboard.press("v");
  const t = await pointIn(page, "#css-trigger", 0.5, 0.5);
  await page.mouse.move(t.x, t.y);
  await expect(frame.locator("#css-panel")).toBeVisible();
  await page.keyboard.press("h");
  await expect(page.getByText(/Hover state locked/)).toBeVisible();
  // leave for the toolbar: the panel must stay
  await page.mouse.move(20, 20);
  await page.waitForTimeout(300);
  await expect(frame.locator("#css-panel")).toBeVisible();
  // comment on the pinned panel
  await page.keyboard.press("c");
  const panel = await pointIn(page, "#css-panel", 0.5, 0.5);
  await page.mouse.click(panel.x, panel.y);
  await expect(page.getByPlaceholder(/Leave a comment/)).toBeVisible();
  await page.keyboard.press("Escape");
  // release (pointer away from the menu)
  await page.keyboard.press("v");
  await page.mouse.move(20, 20);
  await page.keyboard.press("h");
  await expect(page.getByText(/Hover state locked/)).toHaveCount(0);
  await expect(frame.locator("#css-panel")).toBeHidden();

  // JS-driven menu (mouseenter / mouseleave with a close timer)
  const j = await pointIn(page, "#js-trigger", 0.5, 0.5);
  await page.mouse.move(j.x, j.y);
  await expect(frame.locator("#js-panel")).toBeVisible();
  await page.keyboard.press("h");
  await page.mouse.move(20, 20);
  await page.waitForTimeout(400);
  await expect(frame.locator("#js-panel")).toBeVisible();
  await page.keyboard.press("Escape"); // Esc releases the lock first
  await expect(page.getByText(/Hover state locked/)).toHaveCount(0);
  // the page's own scripts are back in charge: hover in and out closes it again
  await page.mouse.move(j.x, j.y);
  await page.mouse.move(20, 20);
  await expect(frame.locator("#js-panel")).toBeHidden();
});

test("exports: PNG sections and a Jira CSV with a rendered screenshot per comment", async ({ page }) => {
  await createReview(page);
  const id = page.url().match(/\/r\/([a-z0-9]+)/)![1];
  const c = await page.request.post(`/api/reviews/${id}/comments`, {
    data: { title: "Hero copy", body: "Tighten this line.", viewport_width: 1440, anchor: { selector: "h1", fx: 0.5, fy: 0.5, px: 300, py: 120 } },
  });
  expect(c.ok()).toBeTruthy();
  await page.reload();
  await expect(page.frameLocator('iframe[title="Page under review"]').locator("h1")).toHaveText("Ship better design reviews");
  await page.keyboard.press("Shift+S");
  await expect(page.getByText("Share this review")).toBeVisible();

  // Jira CSV: the render happens on the server; the row carries a public screenshot URL
  const csvDl = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: /Jira CSV/ }).click();
  const csv = await (await csvDl).path();
  const text = readFileSync(csv!, "utf8");
  expect(text).toMatch(/Attachment/);
  const m = text.match(/redline-1\.jpg;(\S+?)[",]/);
  expect(m).toBeTruthy();
  const shot = await page.request.get(m![1]);
  expect(shot.status()).toBe(200);
  expect(shot.headers()["content-type"]).toMatch(/image\/jpeg/);
  expect((await shot.body()).byteLength).toBeGreaterThan(5000);

  // PNG: a single section for this short page
  const pngDl = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: /^PNG/ }).click();
  const png = await (await pngDl).path();
  const bytes = readFileSync(png!);
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  expect(bytes.byteLength).toBeGreaterThan(20_000);
});

test("client apps hydrate: relative fetch/XHR, dynamic chunks and module imports go through the proxy", async ({ page }) => {
  const frame = await createReview(page, FIXTURE.replace(/site\.html$/, "spa.html"));
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
  // the document's own URL is the site's path on our origin (not /api/proxy?url=…)
  expect(bundler.base).toBe("http://localhost:3123/spa.html");
  // images/links were made absolute to the site instead
  const img = await frame.locator("img").first().getAttribute("src");
  expect(img).toMatch(/^http:\/\/localhost:3999\//);
});
