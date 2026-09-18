import { expect, test } from "@playwright/test";
import { createReview, FIXTURE } from "./helpers";

/**
 * "Compare with Figma" against a fixture page and a fixture Figma REST answer
 * (FIGMA_API_BASE=http://localhost:3999/figma, FIGMA_TOKEN=test on the app).
 * The fixture page deviates from its design on purpose: wrong font size and
 * icon gap in the header, wrong card gap, image size, colour, a typo, a
 * missing full stop, a missing tagline and a wrong button colour.
 */
test("Compare with Figma: developer comments for copy, type, spacing, image, colour and missing pieces; toggle; Jira CSV", async ({ page }) => {
  await createReview(page, FIXTURE.replace(/site\.html$/, "figma-site.html"));
  await page.keyboard.press("Shift+G");
  await expect(page.getByRole("dialog", { name: "Compare with Figma" })).toBeVisible();
  await page.getByLabel("Figma link").fill("https://www.figma.com/design/TESTFILEKEY0000000000000/Fixture?node-id=9-1&t=abc");
  await page.getByRole("button", { name: /^Compare$/ }).click();
  await expect(page.getByText(/differences against “Fixture \/ Education”/)).toBeVisible({ timeout: 30_000 });

  const aside = page.locator("aside");
  // the panel switched to the Developer filter; findings are there with the Dev badge
  await expect(aside.getByText("Developer", { exact: true })).toBeVisible();
  await expect(aside.getByText("Dev", { exact: true }).first()).toBeVisible();
  const titles = await aside.locator(".line-clamp-1, .truncate.font-semibold").allTextContents();
  const all = (await aside.innerText()).replace(/\s+/g, " ");
  expect(all).toMatch(/Font size 16px → should be 14px/);
  expect(all).toMatch(/gap 12px → should be 8px/);
  expect(all).toMatch(/gap 24px → should be 20px/);
  expect(all).toMatch(/Image 300×200 → should be 278×220/);
  expect(all).toMatch(/Text colour #333333 → should be #000000/);
  expect(all).toMatch(/Copy differs: “Learn About Gemstone”/);
  expect(all).toMatch(/Missing “\.” at the end/);
  expect(all).toMatch(/Missing text: “Styled for Forever”/);
  expect(all).toMatch(/Button background #85715d → should be #690f24/);
  expect(titles.length).toBeGreaterThan(5);

  // violet pins on the canvas, hidden by the toggle
  await expect(page.locator("[data-pin='</>']").first()).toBeVisible();
  const before = await page.locator("[data-pin='</>']").count();
  expect(before).toBeGreaterThan(5);
  await aside.getByLabel(/Developer comments/).uncheck();
  await expect(page.locator("[data-pin='</>']")).toHaveCount(0);
  await aside.getByLabel(/Developer comments/).check();
  await expect(page.locator("[data-pin='</>']")).toHaveCount(before);

  // a developer thread explains itself and can be resolved by an editor
  await aside.getByText(/Font size 16px → should be 14px/).click();
  await expect(page.getByText("Developer comment", { exact: true })).toBeVisible();
  await expect(page.getByText(/Set font-size: 14px/).last()).toBeVisible();
  await page.getByRole("button", { name: "Mark as resolved" }).click();

  // running again keeps the resolved one and adds nothing new
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+G");
  await page.getByRole("button", { name: /^Compare$/ }).click();
  await expect(page.getByText(/0 new developer comments/)).toBeVisible({ timeout: 30_000 });

  // Jira: developer findings carry their severity as Priority and the figma-diff label
  const id = page.url().match(/\/r\/([a-z0-9]+)/)![1];
  const csv = await (await page.request.get(`/api/reviews/${id}/export?format=jira`)).text();
  expect(csv).toMatch(/Font size 16px → should be 14px,"[^"]*",Task,Medium,Done,figma-diff,/);
  expect(csv).toMatch(/Missing text: “Styled for Forever”,"[^"]*",Task,High,To Do,figma-diff,/);
  expect(csv).toContain("Figma compare");
});
