import { expect, test } from "@playwright/test";
import { createReview, pointIn } from "./helpers";

/**
 * Headless Chromium in the sandbox cannot capture a tab or screen, so the
 * picker is stood in for by a canvas stream: everything after the pick —
 * MediaRecorder, the upload, the attachment, the thread, the CSV — is real.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const fake = async () => {
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 360;
      const ctx = c.getContext("2d")!;
      let t = 0;
      setInterval(() => {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, 640, 360);
        ctx.fillStyle = "#e2342b";
        ctx.fillRect((t++ * 7) % 600, 120, 60, 60);
      }, 33);
      return c.captureStream(30);
    };
    Object.defineProperty(navigator, "mediaDevices", { value: { getDisplayMedia: fake }, configurable: true });
  });
});

test("record the tab from a comment, attach the clip, see it in the thread and in the Jira CSV", async ({ page }) => {
  await createReview(page);
  const pt = await pointIn(page, '[data-testid="headline"]', 0.1, 0.5);
  await page.mouse.click(pt.x, pt.y);
  await page.getByPlaceholder(/Leave a comment/).fill("The hover animation stutters — see clip.");
  await page.getByRole("button", { name: "Record screen" }).click();
  // recording: the pill is up, the page is in browse mode and the markup stepped aside
  await expect(page.getByRole("status", { name: "Screen recording in progress" })).toBeVisible();
  await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("status", { name: "Screen recording in progress" })).toHaveCount(0);
  // the clip lands in the same composer, text intact
  await expect(page.getByText("Recording", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByPlaceholder(/Leave a comment/)).toHaveValue("The hover animation stutters — see clip.");
  await page.getByPlaceholder(/Leave a comment/).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("aside").getByText("The hover animation stutters")).toBeVisible();
  await page.locator("aside").getByText("The hover animation stutters").click();
  const video = page.locator("video");
  await expect(video).toBeVisible();
  const src = await video.getAttribute("src");
  expect(src).toMatch(/recordings\/.+\.(webm|mp4)$/);
  const file = await page.request.get(src!);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toMatch(/^video\//);
  expect(Number(file.headers()["content-length"] || (await file.body()).length)).toBeGreaterThan(1000);
  // Jira: the clip is an Attachment row and a clickable link in the description
  const id = page.url().match(/\/r\/([a-z0-9]+)/)![1];
  const csv = await (await page.request.get(`/api/reviews/${id}/export?format=jira`)).text();
  expect(csv).toMatch(/;Priya Test;recording-[\d-]+\.(webm|mp4);http/);
  expect(csv).toMatch(/\*Recording 1:\* \[0:0\d by Priya Test\|http[^\]]+\] — opens in the browser/);
});
