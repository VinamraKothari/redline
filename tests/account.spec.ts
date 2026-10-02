import { expect, test, type Page } from "@playwright/test";
import Stripe from "stripe";
import { signIn } from "./helpers";

/**
 * The account hub at /account: profile edits, the plan line, redeeming a
 * code, projects (own and joined), leaving one, and deleting the account.
 * Names carry a run stamp so the file can be run again against a persisted
 * .data; helpers.ts derives the user id from the first hex-ish characters of
 * the name, so the fast-changing digits go first.
 */
const RUN = Date.now().toString(16).split("").reverse().join("");

test("/account needs a signed-in account", async ({ page }) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?next=%2Faccount$/);
});

test("profile: rename yourself and pick a colour; both stick across reloads and show in the account menu", async ({ page }) => {
  const me = await signIn(page, `Ola ${RUN}`);
  await page.goto("/account");
  await expect(page.getByTestId("profile-name")).toHaveText(me.name);
  await expect(page.getByText(me.email)).toBeVisible();
  await expect(page.getByText(/Member since/)).toBeVisible();

  // rename inline — Enter saves, the heading and the account menu follow at once
  await page.getByRole("button", { name: "Edit name" }).click();
  const field = page.getByLabel("Your name");
  await field.fill("  Ola   Nordmann  ");
  await field.press("Enter");
  await expect(page.getByTestId("profile-name")).toHaveText("Ola Nordmann");
  await expect(page.getByText("Saved")).toBeVisible();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(page.getByRole("menu")).toContainText("Ola Nordmann");
  await page.keyboard.press("Escape");

  // an empty name is refused before it reaches the server
  await page.getByRole("button", { name: "Edit name" }).click();
  await page.getByLabel("Your name").fill("   ");
  await page.getByLabel("Your name").press("Enter");
  await expect(page.getByText("Enter a name between 1 and 80 characters.")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  // a colour
  const swatch = page.locator('[data-color="#8b5cf6"]');
  await swatch.click();
  await expect(swatch).toHaveAttribute("aria-checked", "true");

  // the server kept both: a reload and the profile API agree (the Google name no longer wins)
  await page.reload();
  await expect(page.getByTestId("profile-name")).toHaveText("Ola Nordmann");
  await expect(page.locator('[data-color="#8b5cf6"]')).toHaveAttribute("aria-checked", "true");
  const profile = (await (await page.request.get("/api/me")).json()).user as { name: string; color: string; email: string };
  expect(profile).toMatchObject({ name: "Ola Nordmann", color: "#8b5cf6", email: me.email });
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(page.getByRole("menu")).toContainText("Ola Nordmann");
  await page.keyboard.press("Escape");

  // the API validates too
  const tooLong = await page.request.patch("/api/me", { data: { name: "x".repeat(81) } });
  expect(tooLong.status()).toBe(400);
  const badColour = await page.request.patch("/api/me", { data: { color: "#000000" } });
  expect(badColour.status()).toBe(400);
  expect((await badColour.json()).error).toContain("colours");
});

test("plan: the current plan with its reason, a way to the billing page, and a code box that explains a bad code", async ({ page }) => {
  await signIn(page, `Pia ${RUN}`);
  // test sign-in grants Team through the fake Stripe, so this reads as a paid plan
  await page.goto("/account");
  await expect(page.getByTestId("account-plan")).toHaveText("Team");
  await expect(page.getByTestId("plan-line")).toContainText(/Team · €49\/month, renews \d+ \w+ \d{4}/);
  await expect(page.getByRole("button", { name: "Manage billing" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Change plan/ })).toHaveAttribute("href", "/account/billing");

  // usage is the same grid the billing page shows
  await expect(page.getByText("Projects you own", { exact: true })).toBeVisible();
  await expect(page.getByText("Figma comparisons this month")).toBeVisible();

  // a code that doesn't exist (or a server without the redeem endpoint) says so in words, not a status code
  const code = page.getByRole("textbox", { name: "Code" });
  await expect(code).toBeVisible();
  await expect(page.getByRole("button", { name: "Redeem" })).toBeDisabled();
  await code.fill("nope-0000-xx");
  await expect(code).toHaveValue("NOPE-0000-XX");
  await page.getByRole("button", { name: "Redeem" }).click();
  const result = page.getByTestId("redeem-result");
  await expect(result).toBeVisible();
  await expect(result).not.toContainText(/^Request failed/);
  await expect(result).not.toContainText("enjoy");

  // on Free the call to action is an upgrade, and the plan line is plain
  await page.request.get("/api/billing/fake-checkout?plan=free");
  await page.goto("/account");
  await expect(page.getByTestId("account-plan")).toHaveText("Free");
  await expect(page.getByTestId("plan-line")).toContainText("upgrade when you need more");
  await expect(page.getByRole("link", { name: /Upgrade/ })).toHaveAttribute("href", "/account/billing");
  await expect(page.getByRole("button", { name: "Manage billing" })).toHaveCount(0);

  // the billing page links back here and spells out what the portal is for
  await page.goto("/account/billing");
  await expect(page.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");
  await page.request.get("/api/billing/fake-checkout?plan=pro&interval=month");
  await page.goto("/account/billing");
  await expect(page.getByText("Billing details")).toBeVisible();
  await expect(page.getByText("Cancel your plan (you keep it until the period ends)")).toBeVisible();
  await expect(page.getByText("Download your invoices and receipts")).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage billing" })).toHaveCount(1);
});

test("projects: owned and joined ones are listed with their role; members can leave, owners are told to delete instead", async ({ page, browser }) => {
  const me = await signIn(page, `Ria ${RUN}`);
  const own = (await (await page.request.post("/api/projects", { data: { name: "Ria's own" } })).json()).project as { id: string };

  // a second account invites Ria; since her profile exists she joins at once
  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  await signIn(bob, `Bob ${RUN}`);
  const shared = (await (await bob.request.post("/api/projects", { data: { name: "Bob's shared" } })).json()).project as { id: string };
  const invite = await bob.request.post(`/api/projects/${shared.id}/members`, { data: { email: me.email, role: "edit" } });
  expect(invite.ok()).toBeTruthy();
  await bobCtx.close();
  // pending invites are claimed when the invitee's profile syncs (same as after a sign-in)
  await page.request.get("/api/me");

  await page.goto("/account");
  const list = page.getByTestId("account-projects");
  const ownRow = list.locator(`[data-project="${own.id}"]`);
  const sharedRow = list.locator(`[data-project="${shared.id}"]`);
  await expect(ownRow).toContainText("Ria's own");
  await expect(ownRow).toContainText("Owner");
  await expect(ownRow.getByRole("button", { name: /Leave/ })).toHaveCount(0);
  await expect(sharedRow).toContainText("Bob's shared");
  await expect(sharedRow).toContainText("Can edit");
  await expect(ownRow.getByRole("link", { name: "Ria's own" })).toHaveAttribute("href", `/p/${own.id}`);

  // an owner can't leave through the API either
  const ownerLeave = await page.request.delete(`/api/projects/${own.id}/members/me`);
  expect(ownerLeave.status()).toBe(400);
  expect((await ownerLeave.json()).error).toContain("Delete it instead");

  // leaving asks first, then the row is gone and the project is out of reach
  await sharedRow.getByRole("button", { name: /Leave/ }).click();
  const dialog = page.getByRole("dialog", { name: /Leave “Bob's shared”/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Leave project" }).click();
  await expect(dialog).toBeHidden();
  await expect(sharedRow).toHaveCount(0);
  await expect(ownRow).toBeVisible();
  expect((await page.request.get(`/api/projects/${shared.id}`)).status()).toBe(404);
});

test("delete my account: typed confirmation, the session ends, the landing page says so, and the same login starts fresh", async ({ page }) => {
  const me = await signIn(page, `Dee ${RUN}`);
  await page.request.post("/api/projects", { data: { name: "Doomed project" } });
  await page.goto("/account");

  await page.getByRole("button", { name: "Delete my account…" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete your account?" });
  await expect(dialog).toContainText("1 project you own");
  const confirm = dialog.getByRole("button", { name: "Delete my account" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Type DELETE to confirm").fill("delete");
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Type DELETE to confirm").fill("DELETE");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  // signed out and told so
  await page.waitForURL(/\/\?deleted=1$/);
  await expect(page.getByRole("status")).toContainText("Your account was deleted");
  await expect(page.getByRole("button", { name: /Sign in/i }).first()).toBeVisible();
  expect((await page.request.get("/api/me")).status()).toBe(401);
  expect((await page.request.get("/account")).url()).toMatch(/\/login\?next=%2Faccount/);

  // the same Google account can come back — with nothing of the old account left
  const again = await signIn(page, me.name);
  expect(again.id).toBe(me.id);
  const projects = (await (await page.request.get("/api/projects")).json()).projects as unknown[];
  expect(projects).toEqual([]);
  const profile = (await (await page.request.get("/api/me")).json()).user as { name: string };
  expect(profile.name).toBe(me.name);
});

/**
 * Plan sources the fake Stripe can't produce (a paying customer who became
 * a collaborator, a cancellation in progress, a lapsed subscription) are
 * mocked at the status endpoint — the pages only ever read that shape.
 */
type MockStatus = {
  plan: "free" | "pro" | "team";
  source: "admin" | "collaborator" | "stripe" | "manual" | "code" | "free";
  until: string | null;
  subscription: { plan: "free" | "pro" | "team"; status: string; interval: "month" | "year" | null; current_period_end: string | null; cancel_at_period_end: boolean; paying: boolean } | null;
  usage: { projects: number; figmaRunsThisMonth: number };
  stripeEnabled: boolean;
};
const PERIOD_END = "2027-01-03T10:00:00.000Z";
async function mockStatus(page: Page, status: MockStatus) {
  await page.route("**/api/billing/status", (route) => route.fulfill({ json: status }));
}

test("a paying customer who became a collaborator keeps every portal entry point and is told the subscription is now optional", async ({ page }) => {
  await signIn(page, `Cal ${RUN}`);
  await mockStatus(page, {
    plan: "team",
    source: "collaborator",
    until: null,
    subscription: { plan: "pro", status: "active", interval: "month", current_period_end: PERIOD_END, cancel_at_period_end: false, paying: true },
    usage: { projects: 0, figmaRunsThisMonth: 0 },
    stripeEnabled: true,
  });

  await page.goto("/account");
  await expect(page.getByTestId("account-plan")).toHaveText("Team");
  await expect(page.getByTestId("plan-line")).toContainText("complimentary, because you share a project with a Redline admin");
  await expect(page.getByText("no payment needed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage billing" })).toBeVisible();
  await expect(page.getByTestId("also-paying")).toContainText("You're also paying for Pro — you don't need to while you work with an admin");
  await expect(page.getByRole("link", { name: /Upgrade|Change plan/ })).toHaveCount(0);
  // the delete dialog knows about the subscription even though the plan isn't Stripe's
  await page.getByRole("button", { name: "Delete my account…" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete your account?" });
  await expect(dialog).toContainText("cancelled at Stripe immediately");
  await expect(dialog.getByLabel("Type DELETE to confirm")).toBeFocused();
  await page.keyboard.press("Escape");

  await page.goto("/account/billing");
  await expect(page.getByTestId("current-plan")).toHaveText("Team");
  await expect(page.getByText("Billing details")).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage billing" })).toHaveCount(1);
  await expect(page.getByTestId("also-paying")).toContainText("You're also paying for Pro");
  await expect(page.getByText("You share a project with a Redline admin, so your account is on Team at no charge")).toBeVisible();
  await expect(page.getByRole("button", { name: /Upgrade to/ })).toHaveCount(0);

  // once that subscription is set to end there is one signal for it: no Reactivate row, nothing to cancel
  await page.unroute("**/api/billing/status");
  await mockStatus(page, {
    plan: "team",
    source: "collaborator",
    until: null,
    subscription: { plan: "pro", status: "active", interval: "month", current_period_end: PERIOD_END, cancel_at_period_end: true, paying: true },
    usage: { projects: 0, figmaRunsThisMonth: 0 },
    stripeEnabled: true,
  });
  await page.goto("/account/billing");
  await expect(page.getByTestId("also-paying")).toContainText("You're also paying for Pro until 3 Jan 2027, when it ends");
  await expect(page.getByRole("button", { name: "Reactivate" })).toHaveCount(0);
  await expect(page.getByText(/Your plan ends on/)).toHaveCount(0);
  await expect(page.getByText("Cancel your plan (you keep it until the period ends)")).toHaveCount(0);
  await expect(page.getByText("Download your invoices and receipts")).toBeVisible();
  await page.goto("/account");
  await expect(page.getByTestId("also-paying")).toContainText("until 3 Jan 2027, when it ends");
});

test("a cancellation in progress is explained once, with Reactivate; a lapsed subscription offers invoices but nothing to cancel", async ({ page }) => {
  await signIn(page, `Cay ${RUN}`);
  await mockStatus(page, {
    plan: "pro",
    source: "stripe",
    until: PERIOD_END,
    subscription: { plan: "pro", status: "active", interval: "year", current_period_end: PERIOD_END, cancel_at_period_end: true, paying: true },
    usage: { projects: 1, figmaRunsThisMonth: 0 },
    stripeEnabled: true,
  });
  await page.goto("/account/billing");
  await expect(page.getByText("cancels at period end")).toBeVisible();
  await expect(page.getByText("Cancels on 3 Jan 2027 — details and Reactivate below.")).toBeVisible();
  await expect(page.getByText(/Your plan ends on 3 Jan 2027 — you keep Pro until then/)).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Reactivate" })).toBeVisible();
  await expect(page.getByText("Cancel your plan (you keep it until the period ends)")).toBeVisible();
  await page.goto("/account");
  await expect(page.getByTestId("plan-line")).toContainText("€150/year, cancels 3 Jan 2027");

  await page.unroute("**/api/billing/status");
  await mockStatus(page, {
    plan: "free",
    source: "free",
    until: null,
    subscription: { plan: "pro", status: "canceled", interval: "month", current_period_end: "2026-09-01T10:00:00.000Z", cancel_at_period_end: false, paying: true },
    usage: { projects: 1, figmaRunsThisMonth: 0 },
    stripeEnabled: true,
  });
  await page.goto("/account");
  await expect(page.getByTestId("account-plan")).toHaveText("Free");
  await expect(page.getByTestId("plan-line")).toContainText("your subscription ended — upgrade again any time");
  await expect(page.getByRole("button", { name: "Manage billing" })).toBeVisible();
  await page.goto("/account/billing");
  await expect(page.getByText("Billing details")).toBeVisible();
  await expect(page.getByText("Download your invoices and receipts")).toBeVisible();
  await expect(page.getByText("Cancel your plan (you keep it until the period ends)")).toHaveCount(0);
  await expect(page.getByText("Your subscription has ended — you're on Free.")).toBeVisible();

  // an admin reads as an admin, once
  await page.unroute("**/api/billing/status");
  await mockStatus(page, { plan: "team", source: "admin", until: null, subscription: null, usage: { projects: 3, figmaRunsThisMonth: 2 }, stripeEnabled: true });
  await page.goto("/account");
  await expect(page.getByTestId("plan-line")).toContainText("you're a Redline admin");
  await expect(page.getByText("no payment needed")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Manage billing" })).toHaveCount(0);
});

test("when the status call fails the Plan and Usage sections say so and recover on Try again", async ({ page }) => {
  await signIn(page, `Eve ${RUN}`);
  let fail = true;
  await page.route("**/api/billing/status", (route) => (fail ? route.fulfill({ status: 500, json: { error: "Database hiccup." } }) : route.continue()));
  await page.goto("/account");
  const alerts = page.getByRole("alert").filter({ hasText: "Couldn't load this: Database hiccup." });
  await expect(alerts).toHaveCount(2);
  fail = false;
  await alerts.first().getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("account-plan")).toHaveText("Team");
  await expect(page.getByText("Projects you own", { exact: true })).toBeVisible();
  await expect(alerts).toHaveCount(0);
});

test("profile: arrow keys walk the colour swatches as one tab stop; invisible characters are stripped from the name", async ({ page }) => {
  await signIn(page, `Kai ${RUN}`);
  await page.goto("/account");
  const group = page.getByRole("radiogroup", { name: "Your colour" });
  await expect(group.getByRole("radio", { checked: true })).toHaveCount(1);
  await expect(group.locator('[tabindex="0"]')).toHaveCount(1);
  await group.getByRole("radio", { checked: true }).focus();
  await page.keyboard.press("Home");
  await expect(group.locator('[data-color="#e2342b"]')).toHaveAttribute("aria-checked", "true");
  await expect(group.locator('[data-color="#e2342b"]')).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(group.locator('[data-color="#2c6cf6"]')).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("ArrowLeft");
  // the keyboard path saves once the keys stop: the final colour is what reaches the server
  const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith("/api/me") && r.request().postDataJSON().color === "#4a5568");
  await page.keyboard.press("ArrowLeft");
  await expect(group.locator('[data-color="#4a5568"]')).toHaveAttribute("aria-checked", "true");
  expect((await saved).ok()).toBeTruthy();
  await page.reload();
  await expect(page.locator('[data-color="#4a5568"]')).toHaveAttribute("aria-checked", "true");

  const sneaky = await page.request.patch("/api/me", { data: { name: "Kai​ ‮Noor\u0007" } });
  expect(sneaky.ok()).toBeTruthy();
  expect((await sneaky.json()).user.name).toBe("Kai Noor");
  const onlyInvisible = await page.request.patch("/api/me", { data: { name: "​​" } });
  expect(onlyInvisible.status()).toBe(400);
});

/** The Stripe mock in tests/fixtures/v1, signed like billing.spec.ts does. */
async function signedEvent(page: Page, type: string, object: Record<string, unknown>) {
  const payload = JSON.stringify({ id: `evt_account_${Math.random().toString(36).slice(2)}`, object: "event", api_version: "2026-08-26.dahlia", created: Math.floor(Date.now() / 1000), livemode: false, pending_webhooks: 1, request: null, type, data: { object } });
  const signature = new Stripe("sk_test_dummy").webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
  return page.request.post("/api/billing/webhook", { data: payload, headers: { "content-type": "application/json", "stripe-signature": signature } });
}

test("a webhook for a deleted account is acknowledged and writes nothing, so Stripe doesn't retry it for days", async ({ page }) => {
  test.skip(!process.env.STRIPE_WEBHOOK_SECRET, "server not started with STRIPE_WEBHOOK_SECRET / STRIPE_API_BASE");
  // the id of someone who never had (or no longer has) a profile; a past-due Pro-yearly subscription at the mock
  const ghost = `00000000-0000-4000-8000-${RUN.replace(/[^0-9a-f]/g, "0").padEnd(12, "0").slice(0, 12)}`;
  const res = await signedEvent(page, "checkout.session.completed", { id: "cs_ghost", object: "checkout.session", mode: "subscription", subscription: "sub_billingtest_pastdue", client_reference_id: ghost, metadata: {} });
  expect(res.status()).toBe(200);
  // had the row been written, test sign-in would find it and leave it; instead the ghost starts on the usual fake Team grant
  await page.request.post("/api/auth/test", { data: { id: ghost, email: `ghost-${RUN}@example.test`, name: "Ghost" } });
  const status = await (await page.request.get("/api/billing/status")).json();
  expect(status.subscription).toMatchObject({ plan: "team", status: "active", interval: "month" });
});
