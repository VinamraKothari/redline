import { expect, test, type Page } from "@playwright/test";
import { FIXTURE, createProject, createReview, settle, signIn } from "./helpers";
import { CookieJar, parseSetCookie, siteKeyOf } from "../src/lib/proxy/cookies";

/**
 * Reviewing pages behind a login (docs/site-sessions.md). Needs the fixture
 * server from tests/fixtures/server.py on :3999 — it answers /account,
 * /login, /login-js, /api/login and /whoami on top of the static files.
 */
const SITE = new URL(FIXTURE).origin;
const sessionOf = async (page: Page) => (await page.request.get(`/api/proxy/session?url=${encodeURIComponent(SITE + "/account")}`)).json();
const whoami = async (page: Page) => (await page.request.get(`/api/proxy?url=${encodeURIComponent(SITE + "/whoami")}`)).json();

test("siteKeyOf and the cookie jar follow RFC 6265 — and keep hosting platforms apart", () => {
  expect(siteKeyOf("shop.example.com")).toBe("example.com");
  expect(siteKeyOf("www.example.co.uk")).toBe("example.co.uk");
  expect(siteKeyOf("example.com")).toBe("example.com");
  expect(siteKeyOf("example.co")).toBe("example.co");
  expect(siteKeyOf("gem-house-shop.vercel.app")).toBe("gem-house-shop.vercel.app");
  expect(siteKeyOf("docs.pages.dev")).toBe("docs.pages.dev");
  expect(siteKeyOf("localhost")).toBe("localhost");
  expect(siteKeyOf("127.0.0.1")).toBe("127.0.0.1");
  expect(siteKeyOf("Shop.EXAMPLE.com.")).toBe("example.com");

  const url = new URL("https://shop.example.com/account/overview");
  const now = Date.parse("2026-11-20T12:00:00Z");
  // host-only by default, default path from the request, Max-Age over Expires
  const a = parseSetCookie("sid=abc; Path=/; HttpOnly; Secure; Max-Age=3600; Expires=Thu, 01 Jan 1970 00:00:00 GMT", url, now)!;
  expect(a).toMatchObject({ name: "sid", value: "abc", domain: "shop.example.com", hostOnly: true, path: "/", secure: true, httpOnly: true, expires: now + 3_600_000 });
  expect(parseSetCookie("pref=1", url, now)).toMatchObject({ path: "/account", hostOnly: true, expires: null });
  // a Domain the host belongs to is a domain cookie; a foreign or public-suffix Domain is ignored
  expect(parseSetCookie("t=1; Domain=.example.com", url, now)).toMatchObject({ domain: "example.com", hostOnly: false });
  expect(parseSetCookie("t=1; Domain=other.com", url, now)).toBeNull();
  expect(parseSetCookie("t=1; Domain=vercel.app", new URL("https://x.vercel.app/"), now)).toBeNull();
  expect(parseSetCookie("=novalue", url, now)).toBeNull();
  expect(parseSetCookie("big=" + "x".repeat(5000), url, now)).toBeNull();

  const jar = new CookieJar([], now);
  const headers = new Headers();
  headers.append("set-cookie", "sid=abc; Path=/; Secure");
  headers.append("set-cookie", "wide=1; Domain=example.com; Path=/");
  headers.append("set-cookie", "deep=1; Path=/account");
  headers.append("set-cookie", "gone=1; Max-Age=0");
  jar.store(headers, url, true);
  expect(jar.size).toBe(3);
  expect(jar.signedIn).toBe(true);
  // exact host over https: everything that matches, most specific path first
  expect(jar.headerFor(new URL("https://shop.example.com/account/x"))).toBe("deep=1; sid=abc; wide=1");
  // another subdomain only gets the domain cookie; plain http drops Secure
  expect(jar.headerFor(new URL("https://www.example.com/account"))).toBe("wide=1");
  expect(jar.headerFor(new URL("http://shop.example.com/"))).toBe("wide=1");
  // a later empty value deletes
  const del = new Headers({ "set-cookie": "sid=; Path=/" });
  jar.store(del, url);
  expect(jar.headerFor(new URL("https://shop.example.com/"))).toBe("wide=1");
  // cookies that only GETs set (csrf, tracking) are not a login
  const anon = new CookieJar([], now);
  anon.store(new Headers({ "set-cookie": "csrf=1; Path=/" }), url);
  expect(anon.size).toBe(1);
  expect(anon.signedIn).toBe(false);
  // expired cookies vanish on read
  expect(new CookieJar([{ ...a, expires: now - 1 }], now).size).toBe(0);
});

test("native login form: sign in once in Browse mode, the session survives a reload, Forget login ends it", async ({ page }) => {
  // the jar outlives test runs (it is per account): start signed out
  await signIn(page);
  await page.request.delete(`/api/proxy/session?url=${encodeURIComponent(SITE + "/account")}`);
  const frame = await createReview(page, SITE + "/account");
  // the proxied redirect lands on the site's login form, inside the frame — and the workspace says so
  await expect(frame.locator("h1")).toHaveText("Sign in");
  await expect(page.getByRole("button", { name: /Signed in to/ })).toHaveCount(0);
  await expect(page.getByText("The site sent you to its sign-in page.")).toBeVisible();
  expect((await sessionOf(page)).signedIn).toBe(false);

  await page.getByRole("button", { name: "Browse", exact: true }).click(); // the banner's shortcut into Browse mode
  await expect(page.locator("nav").getByLabel("Browse the page")).toHaveClass(/bg-ink/); // the active tool
  await frame.locator('input[name="password"]').fill("secret");
  await frame.getByRole("button", { name: "Sign in" }).click();
  await expect(frame.getByTestId("welcome")).toHaveText("Welcome back, Priya");
  // the login redirected back to the reviewed page: no banners, comments stay
  await expect(page.getByText(/You.ve left the reviewed page/)).toHaveCount(0);
  await expect(page.getByText("The site sent you to its sign-in page.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Signed in to localhost" })).toBeVisible();
  expect((await sessionOf(page)).signedIn).toBe(true);
  expect((await whoami(page)).session).toBe(true);

  // the jar, not the browser, holds the session: a fresh page load is still signed in
  await page.reload();
  await expect(frame.getByTestId("welcome")).toHaveText("Welcome back, Priya");
  await settle(page);

  // Forget login → the site asks again
  await page.getByRole("button", { name: "Signed in to localhost" }).click();
  await page.getByRole("menuitem", { name: "Forget login" }).click();
  await expect(page.getByText("Signed out of localhost in Redline.")).toBeVisible();
  await expect(frame.locator("h1")).toHaveText("Sign in");
  await expect(page.getByRole("button", { name: /Signed in to/ })).toHaveCount(0);
  expect((await sessionOf(page)).signedIn).toBe(false);
  expect((await whoami(page)).session).toBe(false);
  // the login page set a csrf cookie again: kept, not a login — no pill, but the page menu can forget it
  expect((await sessionOf(page)).kept).toBe(true);
  await page.getByRole("button", { name: "Pages in this project" }).click();
  await page.getByRole("menuitem", { name: "Forget session on localhost" }).click();
  await expect(page.getByText("Forgot localhost's cookies in Redline.")).toBeVisible();
  // (the reload that follows loads the login page, which sets its csrf cookie again — kept, never signed in)
  await expect(frame.locator("h1")).toHaveText("Sign in");
  expect((await sessionOf(page)).signedIn).toBe(false);
});

test("the project-card preview of a page behind a login is the page, not the sign-in form", async ({ page }) => {
  await signIn(page);
  await page.request.delete(`/api/proxy/session?url=${encodeURIComponent(SITE + "/account")}`);
  const project = await createProject(page);
  const { review } = await (await page.request.post("/api/reviews", { data: { project_id: project.id, url: SITE + "/account", viewport: 1280 } })).json();
  // signed out: the site answers with its login form — no preview is stored
  let t = await (await page.request.post(`/api/reviews/${review.id}/thumbnail?force=1`)).json();
  expect(t).toMatchObject({ captured: false, loginForm: true });
  expect(t.review.thumbnail_url).toBeFalsy();
  // signed in through the proxy: the capture browser gets the session and sees the page
  const loginHtml = await (await page.request.get(`/api/proxy?url=${encodeURIComponent(SITE + "/login")}`)).text();
  const csrf = loginHtml.match(/name="csrf" value="([a-f0-9]+)"/)![1];
  await page.request.post(`/api/proxy?url=${encodeURIComponent(SITE + "/login")}`, { headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" }, data: `email=p&password=secret&csrf=${csrf}` });
  t = await (await page.request.post(`/api/reviews/${review.id}/thumbnail?force=1`)).json();
  expect(t.captured).toBe(true);
  expect(t.review.thumbnail_url).toMatch(/^\/api\/thumbnail\//);
});

test("the site never sees Redline's hop-by-hop headers or cookies; cross-site navigations to the proxy are refused", async ({ page }) => {
  await signIn(page);
  const seen = (await (await page.request.get(`/api/proxy?url=${encodeURIComponent(SITE + "/headers")}`, { headers: { "x-forwarded-host": "redline.example", "x-forwarded-for": "203.0.113.9", "x-real-ip": "203.0.113.9", "x-vercel-id": "abc", "x-requested-with": "XMLHttpRequest" } })).json()).headers as Record<string, string>;
  expect(Object.keys(seen).filter((k) => /^x-(forwarded-|real-ip|vercel-|redline)/.test(k))).toEqual([]);
  expect(seen["x-requested-with"]).toBe("XMLHttpRequest");
  expect(seen.cookie ?? "").not.toMatch(/redline_|sb-/);
  expect(seen.host).toBe(new URL(SITE).host);
  // a link on another site to /api/proxy?url=… would ride on the reviewer's session and jar: refused
  const crossSite = await page.request.get(`/api/proxy?url=${encodeURIComponent(SITE + "/whoami")}`, { headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", accept: "text/html" } });
  expect(crossSite.status()).toBe(403);
  expect(await crossSite.text()).toContain("only be opened from Redline");
  const sameOrigin = await page.request.get(`/api/proxy?url=${encodeURIComponent(SITE + "/whoami")}`, { headers: { "sec-fetch-site": "same-origin" } });
  expect(sameOrigin.status()).toBe(200);
});

test("script-driven login (fetch + absolute location.href) stays inside Redline and lands on the proxied page", async ({ page }) => {
  const frame = await createReview(page, SITE + "/login-js");
  await expect(frame.locator("h1")).toHaveText("Sign in");
  await page.keyboard.press("v");
  await frame.locator('input[name="password"]').fill("secret");
  await frame.getByRole("button", { name: "Sign in" }).click();
  // NextAuth-style `window.location.href = "http://site/account"` → caught by the bridge, loaded through the proxy
  await expect(frame.getByTestId("welcome")).toHaveText("Welcome back, Priya");
  await expect(page.locator('iframe[title="Page under review"]')).toHaveAttribute("src", /^\/api\/proxy\?url=/);
  const src = await page.locator('iframe[title="Page under review"]').getAttribute("src");
  expect(decodeURIComponent(src!)).toContain(SITE + "/account");
  // the banner names where the frame went
  await expect(page.getByText(/You.ve left the reviewed page/)).toBeVisible();
  await expect(page.getByText("localhost/account")).toBeVisible();
  await expect(page.getByRole("button", { name: "Signed in to localhost" })).toBeVisible();
  expect((await sessionOf(page)).signedIn).toBe(true);
});

test("without the Navigation API the frame leaves for the real site after a login — the host brings it back", async ({ page, context }) => {
  // Safari and friends: the bridge can't intercept `location.href = "http://site/account"`
  await context.addInitScript(() => Object.defineProperty(window, "navigation", { value: undefined, configurable: true }));
  const frame = await createReview(page, SITE + "/login-js");
  await expect(frame.locator("h1")).toHaveText("Sign in");
  await page.keyboard.press("v");
  await frame.locator('input[name="password"]').fill("secret");
  await frame.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("The page left Redline after signing in — reloaded it here.")).toBeVisible();
  await expect(page.locator('iframe[title="Page under review"]')).toHaveAttribute("src", /^\/api\/proxy\?url=/);
  await expect(frame.locator("h1")).toHaveText("Sign in");
  await expect(frame.locator("html")).toHaveAttribute("data-redline", "1");
  // the login itself went through the proxy, so the session is kept
  expect((await sessionOf(page)).signedIn).toBe(true);
});

test("a session belongs to one Redline account — a second user is not signed in", async ({ page, browser }) => {
  await signIn(page);
  await createProject(page);
  // sign in through the API the way the form does: csrf from GET /login, then the POST through the proxy
  const loginHtml = await (await page.request.get(`/api/proxy?url=${encodeURIComponent(SITE + "/login")}`)).text();
  const csrf = loginHtml.match(/name="csrf" value="([a-f0-9]+)"/)![1];
  const res = await page.request.post(`/api/proxy?url=${encodeURIComponent(SITE + "/login")}`, {
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
    data: `email=priya%40example.test&password=secret&csrf=${csrf}`,
  });
  expect(await res.text()).toContain("Welcome back, Priya");
  expect((await whoami(page)).session).toBe(true);
  expect((await sessionOf(page)).signedIn).toBe(true);

  const other = await browser.newContext();
  const op = await other.newPage();
  await signIn(op, "Sam Second");
  expect((await whoami(op)).session).toBe(false);
  expect((await sessionOf(op)).signedIn).toBe(false);
  // the second user's own review of the page shows the login form, not Priya's account
  const project = await createProject(op, "Sam's project");
  await op.goto(`/p/${project.id}`);
  await op.getByPlaceholder(/paste a URL/i).fill(SITE + "/account");
  await op.getByRole("button", { name: "Review" }).click();
  await op.waitForURL(/\/r\/[a-z0-9]+/);
  await expect(op.frameLocator('iframe[title="Page under review"]').locator("h1")).toHaveText("Sign in");
  await other.close();
  // and forgetting Sam's (empty) jar leaves Priya signed in
  expect((await whoami(page)).session).toBe(true);
});

test("a wrong password shows the site's own error inside the frame", async ({ page }) => {
  // the jar outlives tests (it is per account): start this one signed out
  await signIn(page);
  await page.request.delete(`/api/proxy/session?url=${encodeURIComponent(SITE + "/login")}`);
  const frame = await createReview(page, SITE + "/login");
  await page.keyboard.press("v");
  await frame.locator('input[name="password"]').fill("nope");
  await frame.getByRole("button", { name: "Sign in" }).click();
  await expect(frame.getByTestId("login-error")).toHaveText("Wrong password");
  await expect(frame.locator("html")).toHaveAttribute("data-redline", "1");
  await expect(frame.locator("html")).not.toHaveAttribute("data-redline-error", /./);
  expect((await sessionOf(page)).signedIn).toBe(false);
  // a second attempt with the right password works from the error page's form —
  // submitted the jQuery way, form.submit(), which fires no submit event
  await frame.locator('input[name="password"]').fill("secret");
  await frame.locator("form#login").evaluate((f) => (f as HTMLFormElement).submit());
  await expect(frame.getByTestId("welcome")).toHaveText("Welcome back, Priya");
  await expect(page.locator('iframe[title="Page under review"]')).toHaveAttribute("src", /^\/api\/proxy\?url=/);
  expect((await whoami(page)).session).toBe(true);
});

test("a form whose page handler calls preventDefault() is left to the page — the bridge does not navigate", async ({ page }) => {
  const frame = await createReview(page, SITE + "/prevent-default-form");
  await page.keyboard.press("v");
  await frame.getByRole("button", { name: "Go" }).click();
  await expect(frame.getByTestId("result")).toHaveText("handled by the page: hello");
  await page.waitForTimeout(500);
  // no GET navigation with the fields in the query, no banner
  const loc = await page.evaluate(() => {
    const f = document.querySelector<HTMLIFrameElement>('iframe[title="Page under review"]')!;
    return { src: f.getAttribute("src") || "", search: f.contentWindow!.location.search };
  });
  expect(loc.search).toBe("");
  expect(decodeURIComponent(loc.src)).not.toContain("q=hello");
  await expect(page.getByText(/You.ve left the reviewed page/)).toHaveCount(0);
});

test("a plain GET form still navigates with its fields in the query", async ({ page }) => {
  const frame = await createReview(page);
  await page.keyboard.press("v");
  await frame.locator('input[name="q"]').fill("rings");
  await frame.getByRole("button", { name: "Go" }).click();
  await expect(page.getByText(/You.ve left the reviewed page/)).toBeVisible();
  const src = await page.locator('iframe[title="Page under review"]').getAttribute("src");
  expect(decodeURIComponent(src!)).toContain("/search?q=rings");
});

test("a bare 401/403 explains how to sign in — and, once signed in, that the login didn't help", async ({ page }) => {
  await signIn(page);
  await page.request.delete(`/api/proxy/session?url=${encodeURIComponent(SITE + "/forbidden")}`);
  const frame = await createReview(page, SITE + "/forbidden");
  await expect(frame.locator("h1")).toHaveText("The site refused the request");
  await expect(frame.locator("body")).toContainText("It may be behind a login. Switch to Browse the page and sign in there — Redline keeps that session for you.");
  await expect(page.getByText("The site refused the request").first()).toBeVisible();
  // signed in (through the API, like the form does) and still refused: the copy doesn't contradict the pill
  const loginHtml = await (await page.request.get(`/api/proxy?url=${encodeURIComponent(SITE + "/login")}`)).text();
  const csrf = loginHtml.match(/name="csrf" value="([a-f0-9]+)"/)![1];
  await page.request.post(`/api/proxy?url=${encodeURIComponent(SITE + "/login")}`, { headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" }, data: `email=p&password=secret&csrf=${csrf}` });
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(frame.locator("body")).toContainText("You are signed in to localhost in Redline, but it still refused this page");
  await expect(page.getByRole("button", { name: "Signed in to localhost" })).toBeVisible();
});
