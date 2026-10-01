import { expect, test } from "@playwright/test";
import { createReview, FIXTURE, signIn } from "./helpers";

/**
 * "Compare with Figma" against a fixture page and a fixture Figma REST answer
 * (FIGMA_API_BASE=http://localhost:3999/figma, FIGMA_TOKEN=test on the app).
 * The fixture page deviates from its design on purpose: wrong font size and
 * icon gap in the header, wrong card gap, image size, colour, a typo, a
 * missing full stop, a missing tagline and a wrong button colour.
 */
test("Compare with Figma: developer comments for copy, type, spacing, image, colour and missing pieces; toggle; Jira CSV", async ({ page }) => {
  // the test account keeps its settings between runs — start from "show everything"
  await signIn(page);
  expect((await page.request.put("/api/me/settings", { data: {} })).ok()).toBeTruthy();
  await createReview(page, FIXTURE.replace(/site\.html$/, "figma-site.html"));
  await page.keyboard.press("Shift+G");
  await expect(page.getByRole("dialog", { name: "Compare with Figma" })).toBeVisible();
  await page.getByLabel("Figma link").fill("https://www.figma.com/design/TESTFILEKEY0000000000000/Fixture?node-id=9-1&t=abc");
  await page.getByRole("button", { name: /^Compare$/ }).click();
  await expect(page.getByText(/differences against “Fixture \/ Education”/)).toBeVisible({ timeout: 30_000 });

  const aside = page.locator("aside");
  // the panel switched to the Developer filter; findings are there, each wearing its category
  await expect(aside.getByText("Developer", { exact: true })).toBeVisible();
  await expect(aside.locator("[data-dev-category='typography']").first()).toHaveText("Typography");
  await expect(aside.locator("[data-dev-category='spacing']").first()).toHaveText("Spacing");
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

  // a developer thread explains itself (category · severity in its header) and can be resolved by an editor
  await aside.getByText(/The text “Contact Us” — font size should be 14px/).click();
  const devHeader = page.locator("[data-dev-thread]");
  await expect(devHeader).toHaveAttribute("data-dev-thread", "typography");
  await expect(devHeader).toContainText("Typography");
  await expect(devHeader).toContainText("high");
  await expect(devHeader).toHaveAttribute("title", /rule: text-style/);
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

  // Settings: choose which categories of developer comments to see
  const pinsAll = await page.locator("[data-pin='</>']").count();
  const typographyThreads = await aside.locator("[data-dev-category='typography']").count();
  expect(typographyThreads).toBeGreaterThan(0);
  const devToggle = aside.locator("label", { hasText: "Developer comments" });
  await expect(devToggle).not.toContainText(" of ");
  await aside.getByRole("button", { name: "Which developer comments to show" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Priya Test")).toBeVisible();
  await expect(dialog.getByRole("link", { name: /Billing & plan/ })).toHaveAttribute("href", "/account/billing");

  // unticking Typography hides those threads from the list and their pins from the canvas
  await dialog.getByRole("checkbox", { name: /^Typography/ }).uncheck();
  await expect(dialog.getByText("Saved")).toBeVisible();
  await expect(aside.locator("[data-dev-category='typography']")).toHaveCount(0);
  await expect(aside.locator("[data-dev-category='spacing']").first()).toBeVisible();
  // (the resolved "Contact Us" thread has no pin on the canvas, so count what is left rather than subtracting)
  await expect.poll(() => page.locator("[data-pin='</>']").count()).toBeLessThan(pinsAll);
  await expect(devToggle).toContainText(/\(\d+ of \d+\)/);

  // Unselect all hides every developer thread; Select all brings them back
  await dialog.getByRole("button", { name: "Unselect all" }).click();
  await expect(aside.locator("[data-dev-category]")).toHaveCount(0);
  await expect(page.locator("[data-pin='</>']")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Unselect all" })).toBeDisabled();
  await expect(aside.getByText(/All \d+ developer comments are hidden by your settings/)).toBeVisible();
  await expect(devToggle).toContainText(/\(0 of \d+\)/);
  await dialog.getByRole("button", { name: "Select all", exact: true }).click();
  await expect(page.locator("[data-pin='</>']")).toHaveCount(pinsAll);
  await expect(aside.locator("[data-dev-category='typography']")).toHaveCount(typographyThreads);
  await expect(devToggle).not.toContainText(" of ");

  // the choice is stored with the account: it survives a reload without the browser cache
  await dialog.getByRole("checkbox", { name: /^Typography/ }).uncheck();
  await expect(dialog.getByText("Saved")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.evaluate(() => localStorage.removeItem("redline:settings"));
  await page.reload();
  await expect(aside.locator("[data-dev-category='spacing']").first()).toBeVisible();
  await expect(aside.locator("[data-dev-category='typography']")).toHaveCount(0);
  await expect.poll(() => page.locator("[data-pin='</>']").count()).toBeGreaterThan(0);
  await expect.poll(() => page.locator("[data-pin='</>']").count()).toBeLessThan(pinsAll);

  // the comma opens Settings too; everything back on
  await page.keyboard.press(",");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Select all", exact: true }).click();
  await expect(dialog.getByText("Saved")).toBeVisible();
  await expect(aside.locator("[data-dev-category='typography']")).toHaveCount(typographyThreads);

  // …and in full-screen mode, where the top bar and its account menu are gone
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.keyboard.press("f");
  await expect(page.locator("header")).toHaveCount(0);
  await page.keyboard.press(",");
  await expect(dialog).toBeVisible();
});

/**
 * The Settings shortcut (",") must not fire while typing into the reviewed
 * page's own fields, and a settings answer that was in flight when the user
 * changed something must not undo that change.
 */
test("Settings: typing a comma into the reviewed page is not a shortcut; a slow settings load can't undo a save", async ({ page }) => {
  await signIn(page);
  expect((await page.request.put("/api/me/settings", { data: {} })).ok()).toBeTruthy();
  // the settings GET is answered only after the save below, with what the server said *before* it
  let releaseGet = () => {};
  const gate = new Promise<void>((r) => (releaseGet = r));
  await page.route("**/api/me/settings", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    const body = await res.text();
    await gate;
    await route.fulfill({ response: res, body });
  });
  await createReview(page);
  await page.keyboard.press("v");
  const frame = page.frameLocator('iframe[title="Page under review"]');
  await frame.locator('input[name="q"]').click();
  await page.keyboard.type("red, blue");
  await expect(frame.locator('input[name="q"]')).toHaveValue("red, blue");
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeHidden();
  // Escape leaves the field instead of acting on Redline
  await page.keyboard.press("Escape");
  await expect(frame.locator('input[name="q"]')).not.toBeFocused();

  // focus back in Redline itself: now the comma is the shortcut
  await page.locator("aside").click({ position: { x: 160, y: 300 } });
  await page.keyboard.press(",");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("checkbox", { name: "Low" }).uncheck();
  await expect(dialog.getByText("Saved")).toBeVisible();
  // the stale answer (still "everything") arrives now — and changes nothing
  const stale = page.waitForResponse((r) => r.url().includes("/api/me/settings") && r.request().method() === "GET");
  releaseGet();
  expect(await (await stale).text()).toBe('{"settings":{}}');
  await page.waitForTimeout(300);
  await expect(dialog.getByRole("checkbox", { name: "Low" })).not.toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem("redline:settings"))).toContain('"devSeverities":["high","medium"]');
  await page.unroute("**/api/me/settings");
  expect((await page.request.put("/api/me/settings", { data: {} })).ok()).toBeTruthy();
});
