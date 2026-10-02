import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * The admin area, admin/collaborator entitlements and redeemable codes,
 * against the test-mode fakes (REDLINE_TEST_AUTH + REDLINE_BILLING_FAKE). A
 * test user whose name contains "Admin" is made an admin on sign-in (see
 * /api/auth/test). Names carry a run stamp so the file can be run again
 * against a persisted .data; the stamp goes first because helpers.ts derives
 * the user id from the first hex-ish characters of the name.
 */
const RUN = Date.now().toString(16).split("").reverse().join("");

/** Test sign-in grants Team; these tests want ordinary people on Free first. */
async function goFree(page: Page) {
  await page.request.get("/api/billing/fake-checkout?plan=free");
  expect((await (await page.request.get("/api/billing/status")).json()).plan).toBe("free");
}

const status = async (page: Page) => (await (await page.request.get("/api/billing/status")).json()) as { plan: string; source: string; until: string | null; subscription: { source: string; until: string | null; paying: boolean } | null };

test("only admins get in: visitors are sent to sign in, members get a polite no, admins see the overview and the users", async ({ page, browser }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);

  const bea = await signIn(page, `Bea ${RUN}`);
  expect((await page.request.get("/api/admin/users")).status()).toBe(403);
  expect((await page.request.get("/api/admin/stats")).status()).toBe(403);
  expect((await page.request.post(`/api/admin/users/${bea.id}/plan`, { data: { plan: "team" } })).status()).toBe(403);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Not for you" })).toBeVisible();
  await expect(page.getByText(bea.email)).toBeVisible();
  // the account menu has no Admin entry for her
  const me = await (await page.request.get("/api/me")).json();
  expect(me.is_admin).toBe(false);

  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  const ada = await signIn(admin, `Admin ${RUN}`);
  expect((await (await admin.request.get("/api/me")).json()).is_admin).toBe(true);
  expect(await status(admin)).toMatchObject({ plan: "team", source: "admin", until: null });

  await admin.goto("/admin");
  await expect(admin.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(admin.getByText("Users", { exact: true }).first()).toBeVisible();
  await expect(admin.getByText("MRR")).toBeVisible();
  await expect(admin.getByText("Recent activity")).toBeVisible();

  // the account menu offers the admin area
  await admin.getByRole("button", { name: "Account" }).click();
  await expect(admin.getByRole("menuitem", { name: "Admin" })).toBeVisible();
  await expect(admin.getByRole("menuitem", { name: "Account" })).toBeVisible();
  await admin.keyboard.press("Escape");

  await admin.getByRole("link", { name: "Users" }).click();
  await expect(admin).toHaveURL(/\/admin\/users$/);
  await expect(admin.getByText(ada.email)).toBeVisible();
  await admin.getByLabel("Search users").fill(bea.email);
  await expect(admin.getByTestId("user-row")).toHaveCount(1);
  await expect(admin.getByTestId("user-row")).toContainText(bea.name);
  await adminCtx.close();
});

test("an admin grants Pro for three months with a note, the user's status follows, the grant is revoked, and the audit log remembers", async ({ page, browser }) => {
  const bea = await signIn(page, `Bea ${RUN}`);
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  const ada = await signIn(admin, `Admin ${RUN}`);

  // the fake sign-in put Bea on a Stripe-shaped Team row: the admin area refuses to touch it
  const refused = await admin.request.post(`/api/admin/users/${bea.id}/plan`, { data: { plan: "pro", months: 3, note: "nope" } });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).error).toContain("Managed by Stripe");
  await admin.goto(`/admin/users/${bea.id}`);
  await expect(admin.getByText("Managed by Stripe")).toBeVisible();
  await expect(admin.getByRole("link", { name: /Open customer in Stripe/ })).toBeVisible();

  await goFree(page);
  await admin.goto("/admin/users");
  await expect(admin.getByTestId("user-row").first()).toBeVisible(); // hydrated and loaded
  await admin.getByLabel("Search users").fill(bea.name);
  await expect(admin.getByTestId("user-row")).toHaveCount(1);
  await admin.getByTestId("user-row").click();
  await expect(admin).toHaveURL(new RegExp(`/admin/users/${bea.id}$`));
  await expect(admin.getByTestId("effective-plan")).toHaveText("Free");

  await admin.getByRole("button", { name: "Change plan" }).click();
  const dialog = admin.getByRole("dialog", { name: "Change plan" });
  await dialog.locator('[data-plan="pro"]').click();
  await dialog.getByLabel("Duration").selectOption("3");
  await dialog.getByLabel("Note", { exact: true }).fill("beta tester");
  await expect(dialog).toContainText("Pro for 3 months from today, until");
  await dialog.getByRole("button", { name: "Grant Pro" }).click();
  await expect(dialog).toBeHidden();
  await expect(admin.getByTestId("effective-plan")).toHaveText("Pro");
  await expect(admin.getByText("Manual", { exact: true }).first()).toBeVisible();
  await expect(admin.getByText("beta tester").first()).toBeVisible();

  const granted = await status(page);
  expect(granted).toMatchObject({ plan: "pro", source: "manual", subscription: { source: "manual", paying: false } });
  const months = (Date.parse(granted.until!) - Date.now()) / (1000 * 60 * 60 * 24 * 30);
  expect(months).toBeGreaterThan(2.8);
  expect(months).toBeLessThan(3.2);
  // the limit is lifted: a second project goes through
  await page.request.post("/api/projects", { data: { name: "One" } });
  expect((await page.request.post("/api/projects", { data: { name: "Two" } })).ok()).toBeTruthy();

  // extend: the dialog knows about the running grant and adds to its end date instead of starting over
  await admin.getByRole("button", { name: "Change plan" }).click();
  await expect(dialog).toContainText("Currently Pro until");
  await expect(dialog).toContainText("beta tester");
  await expect(dialog.getByLabel("How")).toHaveValue("extend");
  await dialog.getByLabel("Duration").selectOption("1");
  await expect(dialog).toContainText("Adds 1 month: Pro until");
  await dialog.getByRole("button", { name: "Extend Pro" }).click();
  await expect(dialog).toBeHidden();
  const extended = await status(page);
  expect(extended).toMatchObject({ plan: "pro", source: "manual" });
  expect(Date.parse(extended.until!) - Date.parse(granted.until!)).toBeGreaterThan(27 * 24 * 3600 * 1000);
  await expect(admin.getByText("beta tester").first()).toBeVisible(); // the note survived

  // revoke
  await admin.getByRole("button", { name: "Change plan" }).click();
  await dialog.locator('[data-plan="free"]').click();
  await expect(dialog).toContainText("Removes the Pro grant");
  await dialog.getByRole("button", { name: "Remove grant" }).click();
  await expect(dialog).toBeHidden();
  await expect(admin.getByTestId("effective-plan")).toHaveText("Free");
  expect(await status(page)).toMatchObject({ plan: "free", source: "free", until: null, subscription: null });
  expect((await page.request.post("/api/projects", { data: { name: "Three" } })).status()).toBe(402);
  // nothing left to remove: no silent no-op, no audit entry
  const nothing = await admin.request.post(`/api/admin/users/${bea.id}/plan`, { data: { plan: "free" } });
  expect(nothing.status()).toBe(409);
  await admin.getByRole("button", { name: "Change plan" }).click();
  await expect(dialog.locator('[data-plan="free"]')).toHaveCount(0); // Free isn't offered when there is no grant
  await admin.keyboard.press("Escape");

  // admin flag: never yourself
  const self = await admin.request.post(`/api/admin/users/${ada.id}/admin`, { data: { admin: false } });
  expect(self.status()).toBe(400);
  expect((await self.json()).error).toContain("own admin access");

  // the audit trail on the account and the log
  await expect(admin.getByText("Revoked grant").first()).toBeVisible();
  await admin.goto("/admin/audit");
  await expect(admin.getByRole("heading", { name: "Audit log" })).toBeVisible();
  const log = admin.locator("tbody");
  await expect(log).toContainText("Granted plan");
  await expect(log).toContainText("Pro for 3 months");
  await expect(log).toContainText("beta tester");
  await expect(log).toContainText("Extended grant");
  await expect(log).toContainText("Revoked grant");
  await expect(log.getByText(ada.name).first()).toBeVisible();
  await adminCtx.close();
});

test("codes: created in the admin area, redeemed once by a user, refused the second time and once disabled", async ({ page, browser }) => {
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await signIn(admin, `Admin ${RUN}`);
  await admin.goto("/admin/codes");
  await expect(admin.getByRole("heading", { name: "Codes" })).toBeVisible();
  // the fake billing mode has no Stripe: the coupon section says so instead of failing
  await expect(admin.getByText(/Stripe isn.t connected/)).toBeVisible();
  expect(await (await admin.request.get("/api/admin/stripe/coupons")).json()).toMatchObject({ available: false, promos: [] });

  await admin.getByRole("button", { name: "New code" }).click();
  const dialog = admin.getByRole("dialog", { name: "New code" });
  await dialog.getByLabel("Plan").selectOption("pro");
  await dialog.getByLabel("Months").fill("2");
  await dialog.getByLabel("Max uses").fill("2");
  await dialog.getByLabel("Note", { exact: true }).fill(`giveaway ${RUN}`);
  await dialog.getByRole("button", { name: "Create code" }).click();
  await expect(dialog).toBeHidden();
  const row = admin.getByTestId("code-row").filter({ hasText: `giveaway ${RUN}` });
  await expect(row).toContainText("0 / 2");
  const code = (await row.locator(".mono").first().textContent())!.trim();
  expect(code).toMatch(/^PRO-[2-9A-Z]{4}-[2-9A-Z]{2}$/);

  // Cora, on Free, redeems it
  const cora = await signIn(page, `Cora ${RUN}`);
  await goFree(page);
  const bad = await page.request.post("/api/billing/redeem", { data: { code: "NOPE-0000" } });
  expect(bad.status()).toBe(404);
  expect((await bad.json()).error).toContain("doesn't exist");
  const redeemed = await page.request.post("/api/billing/redeem", { data: { code: code.toLowerCase() } });
  expect(redeemed.ok()).toBeTruthy();
  expect(await redeemed.json()).toMatchObject({ plan: "pro", source: "code", subscription: { source: "code", plan: "pro", paying: false } });
  expect(await status(page)).toMatchObject({ plan: "pro", source: "code" });
  const twice = await page.request.post("/api/billing/redeem", { data: { code } });
  expect(twice.status()).toBe(409);
  expect((await twice.json()).error).toContain("already redeemed");
  await admin.reload();
  await expect(admin.getByTestId("code-row").filter({ hasText: `giveaway ${RUN}` })).toContainText("1 / 2");

  // someone who pays through Stripe can't stack a code on top
  const payerCtx = await browser.newContext();
  const payer = await payerCtx.newPage();
  await signIn(payer, `Eli ${RUN}`); // fake sign-in = Stripe-shaped Team row
  const paying = await payer.request.post("/api/billing/redeem", { data: { code } });
  expect(paying.status()).toBe(409);
  expect((await paying.json()).error).toContain("already pay for a plan");

  // disabled: nobody else gets in
  await admin.getByRole("switch", { name: `${code} active` }).click();
  await expect(admin.getByRole("switch", { name: `${code} active` })).toHaveAttribute("aria-checked", "false");
  await payer.request.get("/api/billing/fake-checkout?plan=free");
  const disabled = await payer.request.post("/api/billing/redeem", { data: { code } });
  expect(disabled.status()).toBe(410);
  expect((await disabled.json()).error).toContain("no longer active");
  await payerCtx.close();

  // the redemption shows up on Cora's account
  await admin.goto(`/admin/users/${cora.id}`);
  await expect(admin.getByTestId("effective-plan")).toHaveText("Pro");
  await expect(admin.getByText("Code", { exact: true }).first()).toBeVisible();
  await expect(admin.getByText("Redeemed code").first()).toBeVisible();
  await adminCtx.close();
});

test("whoever shares a project with an admin is on Team for free; a stranger on Free is not", async ({ page, browser }) => {
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await signIn(admin, `Admin ${RUN}`);
  const project = (await (await admin.request.post("/api/projects", { data: { name: `Admin's project ${RUN}` } })).json()).project as { id: string };

  // Dana is invited before she ever signs in; the invite is claimed on her first visit
  const danaName = `Dana ${RUN}`;
  const danaEmail = `${danaName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@example.test`;
  expect((await admin.request.post(`/api/projects/${project.id}/members`, { data: { email: danaEmail, role: "edit" } })).ok()).toBeTruthy();

  const dana = await signIn(page, danaName);
  expect(dana.email).toBe(danaEmail);
  await page.request.get("/api/billing/fake-checkout?plan=free"); // her own row says Free…
  expect(await status(page)).toMatchObject({ plan: "team", source: "collaborator", until: null, subscription: { source: "collaborator", paying: false } });
  // …yet she can own two projects, and pages in the admin's project are unlimited
  expect((await page.request.post("/api/projects", { data: { name: "Dana one" } })).ok()).toBeTruthy();
  expect((await page.request.post("/api/projects", { data: { name: "Dana two" } })).ok()).toBeTruthy();

  // the admin area shows why
  await admin.goto(`/admin/users/${dana.id}`);
  await expect(admin.getByTestId("effective-plan")).toHaveText("Team");
  await expect(admin.getByText("Complimentary").first()).toBeVisible();
  await expect(admin.getByText(`Admin's project ${RUN}`)).toBeVisible();

  // a stranger on Free hits the limit
  const strangerCtx = await browser.newContext();
  const stranger = await strangerCtx.newPage();
  await signIn(stranger, `Finn ${RUN}`);
  await goFree(stranger);
  expect(await status(stranger)).toMatchObject({ plan: "free", source: "free" });
  expect((await stranger.request.post("/api/projects", { data: { name: "Finn one" } })).ok()).toBeTruthy();
  expect((await stranger.request.post("/api/projects", { data: { name: "Finn two" } })).status()).toBe(402);
  await strangerCtx.close();
  await adminCtx.close();
});

test("a code with one use left goes to exactly one of four people who redeem it at the same moment; guessing is throttled", async ({ browser, page }) => {
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await signIn(admin, `Admin ${RUN}`);
  // custom codes need six letters or digits; spaces are not part of a code
  const short = await admin.request.post("/api/admin/codes", { data: { code: "AB-12", plan: "pro", months: 1, max_uses: 1 } });
  expect(short.status()).toBe(400);
  const made = await admin.request.post("/api/admin/codes", { data: { code: `race ${RUN.slice(0, 4)} x`, plan: "team", months: 1, max_uses: 1, note: "race" } });
  expect(made.ok()).toBeTruthy();
  const code = (await made.json()).code.code as string;
  expect(code).toBe(`RACE${RUN.slice(0, 4).toUpperCase()}X`);

  const racers = await Promise.all(
    ["Ace", "Bob", "Cab", "Deb"].map(async (n) => {
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      await signIn(p, `${n} ${RUN}`);
      await p.request.get("/api/billing/fake-checkout?plan=free");
      return { ctx, p };
    }),
  );
  const results = await Promise.all(racers.map(({ p }) => p.request.post("/api/billing/redeem", { data: { code } })));
  const statuses = results.map((r) => r.status());
  expect(statuses.filter((s) => s === 200)).toHaveLength(1);
  for (const r of results) if (r.status() !== 200) expect((await r.json()).error).toMatch(/used up/);
  const after = (await (await admin.request.get("/api/admin/codes")).json()).codes.find((c: { code: string }) => c.code === code);
  expect(after.uses).toBe(1);
  await Promise.all(racers.map(({ ctx }) => ctx.close()));

  // ten wrong guesses an hour, then a 429 — a right code afterwards is refused too, so the count can't be probed
  await signIn(page, `Gus ${RUN}`);
  for (let i = 0; i < 10; i++) expect((await page.request.post("/api/billing/redeem", { data: { code: `WRONG-${i}` } })).status()).toBe(404);
  const blocked = await page.request.post("/api/billing/redeem", { data: { code: "WRONG-10" } });
  expect(blocked.status()).toBe(429);
  expect((await blocked.json()).error).toContain("Too many tries");
  await adminCtx.close();
});
