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
  // titles read as sentences a developer and a layman both follow, quoting the copy they are about
  expect(all).toMatch(/The text “Contact Us” — font size should be 14px \(it is 16px\), font should be Mulish \(it is Arial\)/);
  expect(all).toMatch(/The horizontal space between the .* and the text “Contact Us” should be 8px — it is 12px right now/);
  expect(all).toMatch(/The horizontal space between the card starting with “The Diamond Basics” and the card starting with “All About Gemstones” should be 20px — it is 24px right now/);
  expect(all).toMatch(/The image next to the title “The Diamond Basics” should be 278×220px — it is 300×200px right now/);
  expect(all).toMatch(/text colour (of the paragraph starting “A diamond might catch your eye.*)?should be #000000 \(?(— )?it is #333333/);
  expect(all).toMatch(/“Learn About Gemstone” should read “Learn About Gemstones”/);
  expect(all).toMatch(/should end with a full stop like in the design/);
  expect(all).toMatch(/The text “Styled for Forever” is missing on the page/);
  expect(all).toMatch(/The background of the button “Book a Consultation” should be #690f24 — it is #85715d right now/);
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
  await aside.getByText(/The text “Contact Us” — font size should be 14px/).click();
  await expect(page.getByText("Developer comment", { exact: true })).toBeVisible();
  await expect(page.getByText(/font-size: 14px;/).last()).toBeVisible();
  await page.getByRole("button", { name: "Mark as resolved" }).click();

  // running again keeps the resolved one and adds nothing new
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+G");
  await page.getByRole("button", { name: /^Compare$/ }).click();
  await expect(page.getByText(/0 new developer comments/)).toBeVisible({ timeout: 30_000 });

  // Jira: developer findings carry their severity as Priority and the figma-diff label
  const id = page.url().match(/\/r\/([a-z0-9]+)/)![1];
  const csv = await (await page.request.get(`/api/reviews/${id}/export?format=jira`)).text();
  expect(csv).toMatch(/"The text “Contact Us” — font size should be 14px \(it is 16px\), font should be Mulish \(it is Arial\), line height should be 140% \(it is 125%\)","[^"]*",Task,High,Done,figma-diff,/);
  expect(csv).toMatch(/The text “Styled for Forever” is missing on the page,"[^"]*",Task,High,To Do,figma-diff,/);
  expect(csv).toContain("Figma compare");
});
