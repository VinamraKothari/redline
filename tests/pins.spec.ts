import { expect, test, type Locator, type Page } from "@playwright/test";
import { createReview, pointIn, settle } from "./helpers";
import { PIN_SIZE, pinCentre } from "../src/lib/pin";

/**
 * Comment pins sit on the point they were made at (a circle centred on the
 * anchor, not a teardrop floating above it), and dragging one moves it by
 * exactly what the pointer moves — grabbed anywhere on its body.
 */

async function centre(pin: Locator) {
  const b = (await pin.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** The stage zoom (CSS scale of the review iframe). */
async function zoom(page: Page) {
  return page.evaluate(() => {
    const f = document.querySelector<HTMLIFrameElement>('iframe[title="Page under review"]')!;
    return f.getBoundingClientRect().width / f.offsetWidth;
  });
}

const saved = (page: Page) => page.locator("[data-pin]:not([data-pin='draft'])");

test("pins: centred on the click, drag keeps the grab offset, the drop survives a reload", async ({ page }) => {
  await createReview(page);
  // the canvas is scaled to fit — the geometry must hold at a zoom other than 1
  expect(await zoom(page)).not.toBe(1);

  const pt = await pointIn(page, '[data-testid="headline"]', 0.3, 0.5);
  await page.mouse.click(pt.x, pt.y);
  const draft = page.locator("[data-pin='draft']");
  await expect(draft).toBeVisible();
  // after the pop-in, the draft marker's centre is the click
  await expect.poll(async () => Math.hypot((await centre(draft)).x - pt.x, (await centre(draft)).y - pt.y)).toBeLessThan(2);

  await page.getByPlaceholder(/Leave a comment/).fill("Pin sits right here.");
  await page.keyboard.press("Enter");
  await expect(page.locator("aside").getByText("Pin sits right here.")).toBeVisible();
  const pin = saved(page);
  await expect(pin).toHaveCount(1);
  let c = await centre(pin);
  expect(Math.abs(c.x - pt.x)).toBeLessThan(2);
  expect(Math.abs(c.y - pt.y)).toBeLessThan(2);
  // it scales around its centre: hovering it does not move it
  await page.mouse.move(c.x, c.y);
  await page.waitForTimeout(250);
  const hovered = await centre(pin);
  expect(Math.abs(hovered.x - c.x)).toBeLessThan(1);
  expect(Math.abs(hovered.y - c.y)).toBeLessThan(1);
  await expect(pin).toHaveCSS("cursor", "grab");

  // a click right on the pin opens its thread rather than starting a new comment
  await page.mouse.click(c.x, c.y);
  await expect(page.getByPlaceholder("Reply…")).toBeVisible();
  await expect(page.locator("[data-pin='draft']")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder("Reply…")).toHaveCount(0);

  const id = page.url().match(/\/r\/([a-z0-9]+)/)![1];
  const stored = async () => {
    const { comments } = await (await page.request.get(`/api/reviews/${id}/comments`)).json();
    return comments[0].anchor as { px: number; py: number };
  };
  const before = await stored();
  const z = await zoom(page);

  // drag it by its body (off-centre): it never snaps its centre to the pointer
  c = await centre(pin);
  const grab = { x: c.x + 7, y: c.y - 6 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  // under the 5px threshold nothing moves
  await page.mouse.move(grab.x + 3, grab.y + 2);
  let now = await centre(pin);
  expect(Math.abs(now.x - c.x)).toBeLessThan(0.5);
  expect(Math.abs(now.y - c.y)).toBeLessThan(0.5);
  // mid-drag the pin follows the pointer by exactly the pointer's travel
  await page.mouse.move(grab.x + 60, grab.y + 40, { steps: 6 });
  now = await centre(pin);
  expect(Math.abs(now.x - (c.x + 60))).toBeLessThan(2);
  expect(Math.abs(now.y - (c.y + 40))).toBeLessThan(2);
  await page.mouse.move(grab.x + 120, grab.y + 80, { steps: 6 });
  await page.mouse.up();
  const dropped = await centre(pin);
  expect(Math.abs(dropped.x - (c.x + 120))).toBeLessThan(2);
  expect(Math.abs(dropped.y - (c.y + 80))).toBeLessThan(2);
  // a drag is not a click: the thread stays closed
  await page.waitForTimeout(300);
  await expect(page.getByPlaceholder("Reply…")).toHaveCount(0);

  // the server stores the anchor moved by the pointer's travel in page pixels…
  await expect.poll(async () => Math.abs((await stored()).px - (before.px + 120 / z))).toBeLessThan(2);
  expect(Math.abs((await stored()).py - (before.py + 80 / z))).toBeLessThan(2);
  // …and the pin stays put once the server has answered, and after a reload
  const after = await centre(pin);
  expect(Math.abs(after.x - dropped.x)).toBeLessThan(2);
  expect(Math.abs(after.y - dropped.y)).toBeLessThan(2);
  await page.reload();
  await settle(page);
  await expect(saved(page)).toHaveCount(1);
  await expect.poll(async () => Math.hypot((await centre(saved(page))).x - dropped.x, (await centre(saved(page))).y - dropped.y)).toBeLessThan(2);
});

test("a pin nudged in from the page's edge drags with the pointer too", async ({ page }) => {
  await createReview(page);
  const z = await zoom(page);
  expect(z).not.toBe(1);
  // a comment 2px inside the page's left edge: the pin is drawn whole, a little to the right of the click
  const at = await page.evaluate(() => {
    const r = document.querySelector('iframe[title="Page under review"]')!.getBoundingClientRect();
    return { left: r.left, x: r.left + 2, y: r.top + 300 };
  });
  await page.mouse.click(at.x, at.y);
  await page.getByPlaceholder(/Leave a comment/).fill("On the edge.");
  await page.keyboard.press("Enter");
  await expect(page.locator("aside").getByText("On the edge.")).toBeVisible();
  const pin = saved(page);
  const c = await centre(pin);
  // ring included, the pin reaches 16 screen px from its centre
  expect(Math.abs(c.x - (at.left + 16))).toBeLessThan(2);
  expect(Math.abs(c.y - at.y)).toBeLessThan(2);

  // grabbed off-centre and dragged: it moves by exactly the pointer's travel, the grab point stays under the pointer
  const grab = { x: c.x + 5, y: c.y - 4 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 100, grab.y + 100, { steps: 8 });
  const mid = await centre(pin);
  expect(Math.abs(mid.x - (c.x + 100))).toBeLessThan(2);
  expect(Math.abs(mid.y - (c.y + 100))).toBeLessThan(2);
  await page.mouse.up();
  const dropped = await centre(pin);
  expect(Math.abs(dropped.x - (c.x + 100))).toBeLessThan(2);
  expect(Math.abs(dropped.y - (c.y + 100))).toBeLessThan(2);
});

test("pins on the page's edges are drawn whole; the anchor is not moved", () => {
  const reach = PIN_SIZE / 2 + 2; // ring included
  // left, top and right edge at 100% and at 50% zoom (inverse 2: twice the page pixels)
  expect(pinCentre(0, 0, 1, 1440)).toEqual({ x: reach, y: reach });
  expect(pinCentre(1440, 300, 1, 1440)).toEqual({ x: 1440 - reach, y: 300 });
  expect(pinCentre(3, 5, 2, 1440)).toEqual({ x: 2 * reach, y: 2 * reach });
  // anywhere else the centre is the anchor
  expect(pinCentre(700, 400, 1, 1440)).toEqual({ x: 700, y: 400 });
});
