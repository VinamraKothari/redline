import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const RUN = Math.random().toString(36).slice(2, 7);

/**
 * Sharing a project link: a person who already uses Redline must get in the
 * moment they are invited — even with a tab already signed in — and a
 * stranger must be told it is an access problem, not a dead link. (Invites
 * for addresses that have never signed in are claimed at that sign-in; the
 * page itself claims them too, see projectRole.)
 */
test("an invited account that already exists joins at once, and strangers are told it is an access problem, not a dead link", async ({ page, browser }) => {
  // Ria is signed in first — her profile exists before anyone invites her
  const ria = await signIn(page, `Ria Link ${RUN}`);

  const smitCtx = await browser.newContext();
  const smit = await smitCtx.newPage();
  await signIn(smit, `Smit Share ${RUN}`);
  const project = (await (await smit.request.post("/api/projects", { data: { name: "Shopping pages" } })).json()).project as { id: string };

  // before the invite the link is a clear "no access" page, naming the signed-in account
  await page.goto(`/p/${project.id}`);
  await expect(page.getByRole("heading", { name: "You don't have access to this project" })).toBeVisible();
  await expect(page.getByText(ria.email)).toBeVisible();
  await expect(page.getByRole("button", { name: "Switch account" })).toBeVisible();

  // inviting an existing account makes them a member right away (no pending invite)
  const invited = (await (await smit.request.post(`/api/projects/${project.id}/members`, { data: { email: ria.email.toUpperCase(), role: "edit" } })).json()) as {
    member: { user_id: string; role: string } | null;
    invite: unknown;
  };
  expect(invited.invite).toBeNull();
  expect(invited.member?.user_id).toBe(ria.id);
  expect(invited.member?.role).toBe("edit");

  // …and the same tab, without any other request in between, now opens the project
  await page.goto(`/p/${project.id}`);
  await expect(page.getByRole("heading", { name: "Shopping pages" })).toBeVisible();

  // Dana signed in long ago and was never invited
  const danaCtx = await browser.newContext();
  const dana = await danaCtx.newPage();
  const danaUser = await signIn(dana, `Dana Later ${RUN}`);

  // Dana was never invited: the review link inside the project is refused with the same explanation
  const review = (await (await smit.request.post("/api/reviews", { data: { project_id: project.id, url: process.env.FIXTURE_URL || "http://localhost:3999/site.html", viewport: 1440 } })).json()).review as { id: string };
  await dana.goto(`/r/${review.id}`);
  await expect(dana.getByRole("heading", { name: "You don't have access to this review" })).toBeVisible();
  await expect(dana.getByText(danaUser.email)).toBeVisible();

  await smitCtx.close();
  await danaCtx.close();
});
