import { expect, type Page } from "@playwright/test";

/**
 * End-to-end smoke test of the review flow against the local fixture site.
 * Requires: fixture server on :3999 and the app started with REDLINE_ALLOW_LOCAL=1.
 */
export const FIXTURE = process.env.FIXTURE_URL || "http://localhost:3999/site.html";

/** Client-space point for an element inside the (CSS-scaled) review iframe. */
export async function pointIn(page: Page, selector: string, dx = 0.3, dy = 0.5) {
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
export async function signIn(page: Page, name = "Priya Test") {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const id = `00000000-0000-4000-8000-${slug.replace(/[^0-9a-f]/g, "0").padEnd(12, "0").slice(0, 12)}`;
  const res = await page.request.post("/api/auth/test", { data: { id, email: `${slug}@example.test`, name } });
  expect(res.ok()).toBeTruthy();
  // creates the profile row and claims pending invites
  await page.request.get("/api/me");
  return { id, email: `${slug}@example.test`, name };
}

export async function createProject(page: Page, name = "Acme redesign") {
  const res = await page.request.post("/api/projects", { data: { name } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).project as { id: string };
}

/** Signs in, creates a project and starts a review of the fixture page through the UI. */
export async function createReview(page: Page, fixture = FIXTURE) {
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
export async function settle(page: Page) {
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

