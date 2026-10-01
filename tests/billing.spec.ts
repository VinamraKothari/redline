import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import Stripe from "stripe";
import { FIXTURE, signIn } from "./helpers";

/**
 * Plans and the payment gate, against the test-mode fake for Stripe
 * (REDLINE_BILLING_FAKE=1 on the app server). Test sign-in grants Team to
 * new accounts so the rest of the suite is not gated; these tests put their
 * user on Free explicitly first. Names carry a run stamp so the file can be
 * run again against a persisted .data.
 */
// helpers.ts derives the user id from the first twelve hex-ish characters of
// the name, so the fast-changing digits of the stamp go first
const RUN = Date.now().toString(16).split("").reverse().join("");

async function goFree(page: Page) {
  await page.request.get("/api/billing/fake-checkout?plan=free");
  const status = await (await page.request.get("/api/billing/status")).json();
  expect(status.plan).toBe("free");
  expect(status.stripeEnabled).toBe(true);
  expect(status.subscription).not.toHaveProperty("stripe_customer_id");
}

const PAGES_MESSAGE = "The Free plan includes 3 pages per project. Upgrade to Pro for unlimited pages.";

test("Free plan: limits open the upgrade dialog, the fake checkout upgrades to Pro, limits lift", async ({ page, browser }) => {
  const fred = await signIn(page, `Fred ${RUN}`);
  await goFree(page);

  // the first project is fine
  await page.goto("/");
  await page.getByLabel("New project name").fill("Only project");
  await page.getByRole("button", { name: /Create/ }).click();
  await page.waitForURL(/\/p\/[a-z0-9]+/);
  const pid = page.url().match(/\/p\/([a-z0-9]+)/)![1];

  // three pages fit, the fourth is met by the paywall
  for (let i = 0; i < 3; i++) {
    const res = await page.request.post("/api/reviews", { data: { project_id: pid, url: FIXTURE, viewport: 1024 } });
    expect(res.ok()).toBeTruthy();
  }
  await page.goto(`/p/${pid}`);
  await page.getByPlaceholder(/paste a URL/i).fill(FIXTURE);
  await page.getByRole("button", { name: "Review" }).click();
  const dialog = page.getByRole("dialog", { name: "Upgrade to Pro" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(PAGES_MESSAGE);
  await expect(dialog.locator('[data-plan="free"]')).toContainText("Current");
  await expect(dialog.getByText("Secure payment by Stripe")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // the API answers 402 with what the client needs to act on it
  const fourth = await page.request.post("/api/reviews", { data: { project_id: pid, url: FIXTURE, viewport: 1024 } });
  expect(fourth.status()).toBe(402);
  expect(await fourth.json()).toMatchObject({ error: PAGES_MESSAGE, upgrade: true, plan: "pro", feature: "pages", owner: true });

  // a second project is refused (through the UI and the API)
  await page.goto("/");
  await page.getByLabel("New project name").fill("Second project");
  await page.getByRole("button", { name: /Create/ }).click();
  await expect(page.getByRole("dialog", { name: "Upgrade to Pro" })).toContainText("The Free plan includes 1 project. Upgrade to Pro for unlimited projects.");
  await page.keyboard.press("Escape");
  const second = await page.request.post("/api/projects", { data: { name: "Second project" } });
  expect(second.status()).toBe(402);

  // seats: Free is two people per project, so one invite fits and the next doesn't
  const review = (await (await page.request.get(`/api/projects/${pid}`)).json()).reviews[0] as { id: string };
  const niaEmail = `nia-${RUN}@example.test`;
  const inviteOk = await page.request.post(`/api/projects/${pid}/members`, { data: { email: niaEmail, role: "edit" } });
  expect(inviteOk.ok()).toBeTruthy();
  const inviteAgain = await page.request.post(`/api/projects/${pid}/members`, { data: { email: niaEmail, role: "edit" } });
  expect(inviteAgain.ok()).toBeTruthy(); // re-inviting the same person takes no extra seat
  const inviteMore = await page.request.post(`/api/projects/${pid}/members`, { data: { email: `two-${RUN}@example.test`, role: "edit" } });
  expect(inviteMore.status()).toBe(402);
  expect((await inviteMore.json()).error).toContain("2 people per project");

  // paid-only features: recordings (checked before recording starts), frozen versions — as a copy,
  // in place, or by moving a frozen page in — and PNG export (the Jira crops stay free)
  const recPre = await page.request.get(`/api/reviews/${review.id}/recordings`);
  expect(recPre.status()).toBe(402);
  const rec = await page.request.post(`/api/reviews/${review.id}/recordings`, { data: { type: "video/webm", size: 1000 } });
  expect(rec.status()).toBe(402);
  const frozenCopy = await page.request.post("/api/reviews", { data: { project_id: pid, mode: "frozen", url: FIXTURE, html: "<html>".padEnd(200, "x") } });
  expect(frozenCopy.status()).toBe(402);
  expect((await frozenCopy.json()).error).toContain("Frozen versions are not included in the Free plan");
  const frozenInPlace = await page.request.post(`/api/reviews/${review.id}/freeze`, { data: { html: "<html>".padEnd(200, "x") } });
  expect(frozenInPlace.status()).toBe(402);
  const png = await page.request.post(`/api/reviews/${review.id}/render`, { data: { kind: "png", html: "<p>hi</p>", width: 800 } });
  expect(png.status()).toBe(402);
  expect((await png.json()).error).toBe("PNG exports are not included in the Free plan. Upgrade to Pro to use PNG exports.");

  // PNG export from the share dialog: the upgrade dialog opens, no error toast, the spinner stops
  await page.goto(`/r/${review.id}`);
  await expect(page.frameLocator('iframe[title="Page under review"]').locator("h1")).toHaveText("Ship better design reviews");
  await page.keyboard.press("Shift+S");
  await expect(page.getByText("Share this review")).toBeVisible();
  await page.getByRole("button", { name: /^PNG/ }).click();
  await expect(page.getByRole("dialog", { name: "Upgrade to Pro" })).toContainText("PNG exports are not included");
  await expect(page.getByText(/PNG export failed/)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByText(/Rendering on the server/)).toHaveCount(0);

  // a member of Fred's project (on Team herself) hits Fred's limit and is told so — not sold an upgrade
  const niaCtx = await browser.newContext();
  const nia = await niaCtx.newPage();
  await signIn(nia, `Nia ${RUN}`);
  expect((await (await nia.request.get("/api/billing/status")).json()).plan).toBe("team");
  const asMember = await nia.request.post("/api/reviews", { data: { project_id: pid, url: FIXTURE, viewport: 1024 } });
  expect(asMember.status()).toBe(402);
  expect(await asMember.json()).toMatchObject({ upgrade: true, owner: false, ownerName: fred.name });
  await nia.goto(`/p/${pid}`);
  await nia.getByPlaceholder(/paste a URL/i).fill(FIXTURE);
  await nia.getByRole("button", { name: "Review" }).click();
  const memberDialog = nia.getByRole("dialog", { name: "This project's plan doesn't include that" });
  await expect(memberDialog).toContainText(`This project belongs to ${fred.name}. The Free plan includes 3 pages per project.`);
  await expect(memberDialog).toContainText(`Ask ${fred.name} to upgrade to Pro`);
  await expect(memberDialog.getByRole("button", { name: /Upgrade to/ })).toHaveCount(0);
  await nia.keyboard.press("Escape");
  // …nor can she move a page of her own into it
  const own = await (await nia.request.post("/api/projects", { data: { name: "Nia's project" } })).json();
  const ownPage = await (await nia.request.post("/api/reviews", { data: { project_id: own.project.id, url: FIXTURE, viewport: 1024 } })).json();
  const moved = await nia.request.patch(`/api/reviews/${ownPage.review.id}`, { data: { project_id: pid } });
  expect(moved.status()).toBe(402);
  await niaCtx.close();

  // the billing page: Free, then Pro yearly through the fake checkout
  await page.goto("/account/billing");
  await expect(page.getByTestId("current-plan")).toHaveText("Free");
  await expect(page.getByText("1 of 1")).toBeVisible();
  await expect(page.getByText("resets on the 1st (UTC)")).toBeVisible();
  await page.getByRole("button", { name: "Yearly" }).click();
  await expect(page.locator('[data-plan="pro"]')).toContainText("€12.50");
  await expect(page.locator('[data-plan="pro"]')).toContainText("billed €150 a year");
  await page.locator('[data-plan="pro"]').getByRole("button", { name: "Upgrade to Pro" }).click();
  await page.waitForURL(/\/account\/billing\?checkout=success/);
  await expect(page.getByTestId("current-plan")).toHaveText("Pro");
  await expect(page.getByRole("status").first()).toContainText("you're on the Pro plan");
  await expect(page.getByText(/Renews on .+, billed yearly\./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage billing" })).toBeVisible();
  await expect(page.locator('[data-plan="pro"]')).toContainText("Current");
  await expect(page.locator('[data-plan="team"]').getByRole("button", { name: "Upgrade to Team" })).toBeEnabled();
  await expect(page.locator('[data-plan="free"]').getByRole("button")).toHaveCount(0);

  // the limits are gone
  const secondNow = await page.request.post("/api/projects", { data: { name: "Second project" } });
  expect(secondNow.ok()).toBeTruthy();
  const fourthNow = await page.request.post("/api/reviews", { data: { project_id: pid, url: FIXTURE, viewport: 1024 } });
  expect(fourthNow.ok()).toBeTruthy();
  const recNow = await page.request.post(`/api/reviews/${review.id}/recordings`, { data: { type: "video/webm", size: 1000 } });
  expect(recNow.ok()).toBeTruthy();

  // "Manage billing" goes to the (fake) portal, i.e. straight back here
  await page.getByRole("button", { name: "Manage billing" }).click();
  await page.waitForURL(/\/account\/billing$/);
});

test("a pricing-page link with ?plan&interval starts checkout at once; signed-out visitors go to sign in; Team is never offered a downgrade", async ({ page }) => {
  await page.goto("/account/billing");
  await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Fbilling/);

  await signIn(page, `Gina ${RUN}`);
  await goFree(page);
  await page.goto("/account/billing?plan=team&interval=month");
  await page.waitForURL(/\/account\/billing\?checkout=success/);
  await expect(page.getByTestId("current-plan")).toHaveText("Team");
  await expect(page.getByText(/Renews on .+, billed monthly\./)).toBeVisible();
  await expect(page.locator('[data-plan="pro"]').getByRole("button")).toHaveCount(0);
  await expect(page.locator('[data-plan="pro"]')).toContainText("Everything in Pro is included in your plan.");
  const status = await (await page.request.get("/api/billing/status")).json();
  expect(status.subscription).toMatchObject({ plan: "team", status: "active", interval: "month", paying: true });
});

test("the Stripe webhook rejects requests without a valid signature", async ({ request }) => {
  const unsigned = await request.post("/api/billing/webhook", { data: { type: "checkout.session.completed" } });
  expect(unsigned.status()).toBe(400);
  expect((await unsigned.json()).error).toContain("signature");
  // a forged signature is refused too (400 when Stripe is configured, 503 before the keys are set)
  const forged = await request.post("/api/billing/webhook", { data: "{}", headers: { "stripe-signature": "t=1,v1=nope" } });
  expect([400, 503]).toContain(forged.status());
});

/**
 * Signed webhook events against the Stripe mock in tests/fixtures/v1 (the
 * server runs with STRIPE_SECRET_KEY=sk_test_dummy, STRIPE_WEBHOOK_SECRET
 * and STRIPE_API_BASE=<fixture server>). Skipped when the server has no
 * webhook secret to sign against.
 */
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

async function sendEvent(request: APIRequestContext, type: string, object: Record<string, unknown>, createdOffsetSeconds: number) {
  const payload = JSON.stringify({
    id: `evt_${type.replace(/\./g, "_")}_${Math.random().toString(36).slice(2)}`,
    object: "event",
    api_version: "2026-08-26.dahlia",
    created: Math.floor(Date.now() / 1000) + createdOffsetSeconds,
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type,
    data: { object },
  });
  const signature = new Stripe("sk_test_dummy").webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET! });
  return request.post("/api/billing/webhook", { data: payload, headers: { "content-type": "application/json", "stripe-signature": signature } });
}

test("signed webhook events: the subscription is re-fetched, stale payloads and out-of-order deliveries don't win", async ({ page }) => {
  test.skip(!WEBHOOK_SECRET, "server not started with STRIPE_WEBHOOK_SECRET / STRIPE_API_BASE");
  // a fixed name: the mock's customer id is shared, so re-runs must land on the same account.
  // Event timestamps run forwards from "now": the Free row written here stamps `now`, and
  // the guard ignores events from before the row's last change (see syncFromStripeSubscription).
  const wendy = await signIn(page, "Wendy Webhook");
  await goFree(page);
  const status = async () => (await (await page.request.get("/api/billing/status")).json()) as { plan: string; subscription: { status: string; interval: string | null; paying: boolean } | null };

  // a checkout for a Team subscription: the account is found through client_reference_id
  const checkout = await sendEvent(page.request, "checkout.session.completed", { id: "cs_test_1", object: "checkout.session", mode: "subscription", subscription: "sub_billingtest_active", client_reference_id: wendy.id, metadata: {} }, 10);
  expect(checkout.status()).toBe(200);
  expect(await status()).toMatchObject({ plan: "team", subscription: { status: "active", interval: "month", paying: true } });

  // an "updated" event whose payload still says active, but Stripe (the mock) says cancelled: Stripe wins
  const cancelled = await sendEvent(page.request, "customer.subscription.updated", { id: "sub_billingtest_canceled", object: "subscription", status: "active", customer: "cus_billingtest" }, 30);
  expect(cancelled.status()).toBe(200);
  expect(await status()).toMatchObject({ plan: "free", subscription: { status: "canceled" } });

  // an older event (created before the cancellation) arriving late is ignored
  const late = await sendEvent(page.request, "customer.subscription.updated", { id: "sub_billingtest_active", object: "subscription", status: "active", customer: "cus_billingtest" }, 20);
  expect(late.status()).toBe(200);
  expect(await status()).toMatchObject({ plan: "free", subscription: { status: "canceled" } });

  // a failed payment: the subscription is past due — the plan stays (grace) and the billing page warns
  const failed = await sendEvent(page.request, "invoice.payment_failed", { id: "in_test_1", object: "invoice", customer: "cus_billingtest", parent: { type: "subscription_details", subscription_details: { subscription: "sub_billingtest_pastdue", metadata: {} } } }, 40);
  expect(failed.status()).toBe(200);
  expect(await status()).toMatchObject({ plan: "pro", subscription: { status: "past_due", interval: "year" } });
  await page.goto("/account/billing");
  await expect(page.getByTestId("current-plan")).toHaveText("Pro");
  await expect(page.getByText("Your last payment failed.")).toBeVisible();
  await expect(page.getByText("past due")).toBeVisible();

  // …and the deletion that follows takes it away
  const deleted = await sendEvent(page.request, "customer.subscription.deleted", { id: "sub_billingtest_canceled", object: "subscription", status: "canceled", customer: "cus_billingtest" }, 50);
  expect(deleted.status()).toBe(200);
  expect(await status()).toMatchObject({ plan: "free", subscription: { status: "canceled" } });

  // an event we don't handle is acknowledged, not retried
  const ignored = await sendEvent(page.request, "customer.updated", { id: "cus_billingtest", object: "customer" }, 60);
  expect(ignored.status()).toBe(200);
  // a tampered body fails the signature check
  const tampered = await page.request.post("/api/billing/webhook", { data: "{}", headers: { "content-type": "application/json", "stripe-signature": new Stripe("sk_test_dummy").webhooks.generateTestHeaderString({ payload: "{\"a\":1}", secret: WEBHOOK_SECRET! }) } });
  expect(tampered.status()).toBe(400);
});
