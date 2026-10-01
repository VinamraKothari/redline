import { expect, test, type Page } from "@playwright/test";
import { FIXTURE, createReview, signIn } from "./helpers";

const PAGES: { path: string; title: RegExp; h1: RegExp }[] = [
  { path: "/", title: /Redline/, h1: /Design feedback/ },
  { path: "/pricing", title: /^Pricing — Redline/, h1: /Free to start/ },
  { path: "/how-it-works", title: /^How it works — Redline/, h1: /From a URL/ },
  { path: "/changelog", title: /^Changelog — Redline/, h1: /What's new/ },
  { path: "/privacy", title: /^Privacy policy — Redline/, h1: /^Privacy policy$/ },
  { path: "/terms", title: /^Terms of service — Redline/, h1: /^Terms of service$/ },
  { path: "/imprint", title: /^Imprint — Redline/, h1: /^Imprint$/ },
];

/**
 * Nothing may be wider than the phone: the document, and the widest element
 * in it — except inside a container that scrolls sideways on purpose (the
 * comparison table on the pricing page, marked `data-scrolls`).
 */
async function expectNoOverflow(page: Page, width: number) {
  const measured = await page.evaluate(() => {
    const doc = document.documentElement;
    let widest = 0;
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (el.closest("[data-scrolls]")) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > widest) widest = r.right;
    }
    return { scrollWidth: doc.scrollWidth, widest: Math.round(widest) };
  });
  expect(measured.scrollWidth).toBeLessThanOrEqual(width);
  expect(measured.widest).toBeLessThanOrEqual(width);
}

for (const p of PAGES) {
  test(`marketing page ${p.path} renders with its title and heading`, async ({ page }) => {
    await page.goto(p.path);
    await expect(page).toHaveTitle(p.title);
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toContainText(p.h1);
    // the shared shell is there
    await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
    await expect(page.getByRole("contentinfo")).toContainText(/Made in Germany/);
    await expect(page.getByRole("contentinfo")).toContainText(new RegExp(`© ${new Date().getFullYear()} Redline`));
    // absolute canonical and Open Graph URLs
    const origin = (process.env.NEXT_PUBLIC_SITE_URL || "https://redline-wheat.vercel.app").replace(/\/$/, "");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", origin + (p.path === "/" ? "" : p.path));
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", origin + (p.path === "/" ? "" : p.path));
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Redline/);
  });
}

test("marketing pages stay Redline's own after a review has set the site cookie", async ({ page }) => {
  await createReview(page);
  expect((await page.context().cookies()).some((c) => c.name === "redline_site")).toBeTruthy();
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Free to start");
  await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "How it works" }).click();
  await expect(page).toHaveURL(/\/how-it-works$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("From a URL");
  await expect(page.getByText(/couldn.t load/)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 3, name: "Copy", exact: true })).toBeVisible();
  // a member gets one link to the projects instead of the sign-in buttons
  const banner = page.getByRole("banner");
  await expect(banner.getByRole("link", { name: "Your projects" })).toBeVisible();
  await expect(banner.getByRole("link", { name: "Product" })).toHaveAttribute("href", "/how-it-works");
  await expect(banner.getByRole("button", { name: /Sign in|Start free/ })).toHaveCount(0);
  await expect(banner.getByRole("link", { name: /Sign in|Start free/ })).toHaveCount(0);
  const robots = await page.request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain("Disallow: /r/");
});

test("nav links go to the right places, on desktop and through the phone menu", async ({ page }) => {
  await page.goto("/pricing");
  const nav = page.getByRole("navigation", { name: "Main" }).first();
  await expect(nav.getByRole("link", { name: "Pricing" })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: "How it works" }).click();
  await expect(page).toHaveURL(/\/how-it-works$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("From a URL");
  await nav.getByRole("link", { name: "Changelog" }).click();
  await expect(page).toHaveURL(/\/changelog$/);
  await nav.getByRole("link", { name: "Product" }).click();
  await expect(page).toHaveURL(/\/#product$/);
  await expect(page.locator("#product")).toBeVisible();
  await page.getByRole("banner").getByRole("link", { name: "Redline home" }).click();
  await expect(page).toHaveURL(/\/$/);

  // footer: legal pages
  const footer = page.getByRole("contentinfo");
  await footer.getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await footer.getByRole("link", { name: "Terms" }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await footer.getByRole("link", { name: "Imprint" }).click();
  await expect(page).toHaveURL(/\/imprint$/);
  await expect(page.getByText("Vinamra Kothari").first()).toBeVisible();

  // phone: the compact menu
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Pricing" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Free to start");
});

test("pricing: the toggle switches the shown price, the table lists the limits", async ({ page }) => {
  await page.goto("/pricing");
  const pro = page.getByTestId("price-pro");
  await expect(pro).toHaveText("€15");
  await expect(page.getByTestId("price-team")).toHaveText("€49");
  await page.getByRole("button", { name: "Yearly" }).click();
  await expect(pro).toHaveText("€12.50");
  await expect(page.getByTestId("price-team")).toHaveText("€40.83");
  await expect(page.getByText("€150 billed yearly")).toBeVisible();
  await expect(page.getByText("€490 billed yearly")).toBeVisible();
  await page.getByRole("button", { name: "Monthly" }).click();
  await expect(pro).toHaveText("€15");
  await expect(page.getByTestId("price-free")).toHaveText("€0");

  const table = page.getByRole("table");
  await expect(table.getByRole("rowheader", { name: /^Projects/ })).toBeVisible();
  await expect(table.getByRole("row", { name: /Figma comparisons/ })).toContainText("2 a month");
  await expect(table.getByRole("row", { name: /People per project/ })).toContainText("Unlimited");
  await expect(table.getByRole("row", { name: /Jira CSV export/ }).getByLabel("Included")).toHaveCount(3);
  await expect(table.getByRole("row", { name: /PNG export/ }).getByLabel("Not included")).toHaveCount(1);

  // signed out, the buttons lead through Google sign-in; signed in, straight to checkout on the billing page
  await expect(page.getByRole("main").getByRole("button", { name: "Start free" })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("button", { name: "Start free" })).toBeVisible();
  await signIn(page);
  await page.goto("/pricing");
  await expect(page.getByRole("button", { name: "Go to your projects" })).toBeVisible();
  await page.getByRole("button", { name: "Yearly" }).click();
  await page.getByRole("button", { name: "Choose Team" }).click();
  await expect(page).toHaveURL(/\/account\/billing\?plan=team&interval=year$/);
});

test("how it works: the shortcut table and the Figma categories come from the app's own definitions", async ({ page }) => {
  await page.goto("/how-it-works");
  await expect(page.getByRole("heading", { level: 2, name: "Compare with Figma" })).toBeVisible();
  for (const label of ["Copy", "Typography", "Spacing", "Images & icons", "Section size & background"]) {
    await expect(page.getByRole("heading", { level: 3, name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByText("Freeze this version")).toBeVisible();
  await expect(page.getByText("Compare with Figma", { exact: true }).first()).toBeVisible();
  await expect(page.locator("kbd", { hasText: "Esc" })).toBeVisible();
});

test("landing: the URL box still starts a review after the test sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Continue with Google/ })).toBeVisible();
  await page.getByLabel("Web address to review").fill(FIXTURE);
  await page.getByRole("button", { name: "Sign in as test user" }).click();
  await page.waitForURL(/\/start\?url=/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Start the review");
});

test("nothing overflows a 390px phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const p of PAGES) {
    await page.goto(p.path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoOverflow(page, 390);
  }
  // the open phone menu neither
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  await expectNoOverflow(page, 390);
});

test("robots and sitemap cover the marketing pages only", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toMatch(/Disallow: \/r\//);
  expect(robots).toMatch(/Disallow: \/p\//);
  expect(robots).toMatch(/Disallow: \/api\//);
  expect(robots).toMatch(/Disallow: \/account\//);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const p of ["/pricing", "/how-it-works", "/changelog", "/privacy", "/terms", "/imprint"]) expect(sitemap).toContain(`${p}</loc>`);
  expect(sitemap).not.toContain("/r/");
});
