import { expect, test, type Page } from "@playwright/test";
import { FIXTURE, createProject, settle, signIn } from "./helpers";

/**
 * Folders inside a project and the unresolved-comment badges on page cards.
 * Requires: fixture server on :3999 (also answering the fake Figma API) and the
 * app started with REDLINE_ALLOW_LOCAL=1, REDLINE_TEST_AUTH=1,
 * FIGMA_API_BASE=http://localhost:3999/figma.
 */

async function addPage(page: Page, projectId: string, url: string, extra: Record<string, unknown> = {}) {
  const res = await page.request.post("/api/reviews", { data: { project_id: projectId, url, viewport: 1440, ...extra } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).review as { id: string; title: string; folder_id?: string | null };
}

const anchor = { selector: "h1", fx: 0.5, fy: 0.5, px: 300, py: 120 };

test("badges: a page card counts its unresolved threads — red for people, violet for developer comments", async ({ page }) => {
  await signIn(page);
  const project = await createProject(page, "Badges");
  // page A: one open thread, one resolved thread, one reply (replies never count)
  const a = await addPage(page, project.id, FIXTURE);
  const open = await page.request.post(`/api/reviews/${a.id}/comments`, { data: { body: "Too heavy.", viewport_width: 1440, anchor } });
  expect(open.ok()).toBeTruthy();
  const openId = ((await open.json()).comment as { id: string }).id;
  expect((await page.request.post(`/api/reviews/${a.id}/comments`, { data: { parent_id: openId, body: "Agreed.", viewport_width: 1440 } })).ok()).toBeTruthy();
  const done = await page.request.post(`/api/reviews/${a.id}/comments`, { data: { body: "Fixed already.", viewport_width: 1440, anchor } });
  const doneId = ((await done.json()).comment as { id: string }).id;
  expect((await page.request.patch(`/api/comments/${doneId}`, { data: { action: "resolve", resolved: true } })).ok()).toBeTruthy();
  // page B: nothing open yet
  const b = await addPage(page, project.id, FIXTURE.replace(/site\.html$/, "pricing.html"));

  const tile = (id: string) => page.locator('[data-testid="page-tile"]').filter({ has: page.locator(`a[href="/r/${id}"]`) });
  await page.goto(`/p/${project.id}`);
  const tileA = tile(a.id);
  const tileB = tile(b.id);
  await expect(tileA.locator("[data-badge='open']")).toHaveText("1");
  await expect(tileA.locator("[data-badge='dev']")).toHaveCount(0);
  await expect(tileA.locator("[data-testid='thread-badges']")).toHaveAttribute("title", "1 unresolved comment");
  await expect(tileB.locator("[data-testid='thread-badges']")).toHaveCount(0);
  // the API carries the same numbers
  const loaded = await (await page.request.get(`/api/projects/${project.id}`)).json();
  expect(loaded.counts).toEqual({ [a.id]: { open: 1, dev: 0 } });

  // developer comments come from "Compare with Figma": run it on a third page against the fixture design
  await page.getByPlaceholder(/paste a URL/i).fill(FIXTURE.replace(/site\.html$/, "figma-site.html"));
  await page.getByRole("button", { name: "Review" }).click();
  await page.waitForURL(/\/r\/[a-z0-9]+/);
  const c = page.url().match(/\/r\/([a-z0-9]+)/)![1];
  await settle(page);
  await page.keyboard.press("Shift+G");
  await page.getByLabel("Figma link").fill("https://www.figma.com/design/TESTFILEKEY0000000000000/Fixture?node-id=9-1&t=abc");
  await page.getByRole("button", { name: /^Compare$/ }).click();
  await expect(page.getByText(/differences against “Fixture \/ Education”/)).toBeVisible({ timeout: 30_000 });
  const devCount = ((await (await page.request.get(`/api/projects/${project.id}`)).json()).counts as Record<string, { open: number; dev: number }>)[c];
  expect(devCount.dev).toBeGreaterThan(5);
  expect(devCount.open).toBe(0);

  await page.goto(`/p/${project.id}`);
  const tileC = tile(c);
  await expect(tileC.locator("[data-badge='dev']")).toHaveText(`</>${devCount.dev}`);
  await expect(tileC.locator("[data-badge='open']")).toHaveCount(0);
  await expect(tileC.locator("[data-testid='thread-badges']")).toHaveAttribute("title", `${devCount.dev} developer comments`);
  // the violet pill is the developer colour, the red one the redline
  expect(await tileC.locator("[data-badge='dev']").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(124, 58, 237)");
  expect(await tileA.locator("[data-badge='open']").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(226, 52, 43)");
});

test("folders: create, rename, move pages by dialog and by drag, open, delete — comments untouched; viewers can't", async ({ page, browser }) => {
  await signIn(page);
  const project = await createProject(page, "Folder project");
  const a = await addPage(page, project.id, FIXTURE, { title: "Home A" });
  const b = await addPage(page, project.id, FIXTURE.replace(/site\.html$/, "pricing.html"), { title: "Pricing B" });
  expect((await page.request.post(`/api/reviews/${a.id}/comments`, { data: { title: "Hero", body: "Tighten this line.", viewport_width: 1440, anchor } })).ok()).toBeTruthy();
  const commentsBefore = (await (await page.request.get(`/api/reviews/${a.id}`)).json()).comments;
  expect(commentsBefore).toHaveLength(1);

  await page.goto(`/p/${project.id}`);
  const tileA = page.locator('[data-testid="page-tile"]').filter({ has: page.locator(`a[href="/r/${a.id}"]`) });
  const tileB = page.locator('[data-testid="page-tile"]').filter({ has: page.locator(`a[href="/r/${b.id}"]`) });
  const folderTile = page.locator('[data-testid="folder-tile"]');
  await expect(tileA).toBeVisible();
  await expect(tileB).toBeVisible();
  // no folders yet → nothing to move into; the menu doesn't offer it
  await page.getByRole("button", { name: "Options for Home A" }).click();
  await expect(page.getByRole("menuitem", { name: /Move to folder/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // create a folder inline: button → name → Enter
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("New folder name").fill("Marketing");
  await page.keyboard.press("Enter");
  await expect(folderTile).toHaveCount(1);
  await expect(folderTile).toContainText("Marketing");
  await expect(folderTile).toContainText("0 pages");
  await expect(folderTile).toContainText("Empty folder");
  const fid = (await folderTile.locator("a").first().getAttribute("href"))!.split("/f/")[1];
  expect(fid).toBeTruthy();
  // folders come first in the grid
  expect(await page.getByTestId("tile-grid").locator("li").first().getAttribute("data-testid")).toBe("folder-tile");

  // rename from the tile menu: the input takes the focus (not the ⋯ button), so typing and Esc just work
  await page.getByRole("button", { name: "Options for folder Marketing" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await expect(page.getByLabel("Folder name")).toBeFocused();
  await page.keyboard.type("Marketing pages"); // the old name is selected, so typing replaces it
  await page.keyboard.press("Enter");
  await expect(folderTile).toContainText("Marketing pages");
  // …and the keyboard user is back on the ⋯ button, not dropped on <body>
  await expect(page.getByRole("button", { name: "Options for folder Marketing pages" })).toBeFocused();
  expect(((await (await page.request.get(`/api/projects/${project.id}`)).json()).folders as { name: string }[])[0].name).toBe("Marketing pages");

  // the same for a page's name: focused at once, Esc gives the old name back
  await page.getByRole("button", { name: "Options for Home A" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await expect(page.getByLabel("Page name")).toBeFocused();
  await page.keyboard.type("Draft");
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Page name")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Options for Home A" })).toBeFocused();
  await expect(tileA).toContainText("Home A");
  await expect(tileA).not.toContainText("Draft");

  // move A in through ⋯ → Move to folder…: the root is marked current and can't be picked
  await page.getByRole("button", { name: "Options for Home A" }).click();
  await page.getByRole("menuitem", { name: /Move to folder/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("radio", { name: /Project root/ })).toBeDisabled();
  await expect(dialog.getByText("current")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Move" })).toBeDisabled();
  await dialog.getByRole("radio", { name: /Marketing pages/ }).check();
  await dialog.getByRole("button", { name: "Move" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(tileA).toHaveCount(0);
  await expect(folderTile).toContainText("1 page");
  // the folder wears the sum of its pages' badges
  await expect(folderTile.locator("[data-badge='open']")).toHaveText("1");

  // open the folder: breadcrumb, only A inside, the add-page box targets the folder
  await folderTile.getByRole("link", { name: /Marketing pages/ }).click();
  await page.waitForURL(`**/p/${project.id}/f/${fid}`);
  const crumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumb).toContainText("Projects");
  await expect(crumb.getByRole("link", { name: "Folder project" })).toBeVisible();
  await expect(crumb).toContainText("Marketing pages");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Marketing pages");
  await expect(page.locator('[data-testid="page-tile"]')).toHaveCount(1);
  await expect(tileA).toBeVisible();
  await expect(page.getByPlaceholder(/Add a page to this folder/)).toBeVisible();
  await expect(page.getByRole("button", { name: "New folder" })).toHaveCount(0);
  // the browser's back button works — it was a plain navigation
  await page.goBack();
  await page.waitForURL(`**/p/${project.id}`);

  // drag B onto the folder tile
  await expect(tileB).toHaveAttribute("draggable", "true");
  await tileB.dragTo(folderTile);
  await expect(folderTile).toContainText("2 pages");
  await expect(page.locator('[data-testid="page-tile"]')).toHaveCount(0);
  await expect(folderTile.locator("img")).toHaveCount(0); // no previews yet — nobody opened the pages
  const after = await (await page.request.get(`/api/projects/${project.id}`)).json();
  expect(after.reviews.map((r: { id: string; folder_id: string | null }) => [r.id, r.folder_id]).sort()).toEqual([[a.id, fid], [b.id, fid]].sort());

  // inside the folder, move B back to the root through the dialog
  await page.goto(`/p/${project.id}/f/${fid}`);
  await expect(page.locator('[data-testid="page-tile"]')).toHaveCount(2);
  await page.getByRole("button", { name: "Options for Pricing B" }).click();
  await page.getByRole("menuitem", { name: /Move to folder/ }).click();
  await expect(page.getByRole("dialog").getByRole("radio", { name: /Marketing pages/ })).toBeDisabled();
  await page.getByRole("dialog").getByRole("radio", { name: /Project root/ }).check();
  await page.getByRole("dialog").getByRole("button", { name: "Move" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('[data-testid="page-tile"]')).toHaveCount(1);
  await expect(tileA).toBeVisible();
  // a page created inside the folder lands in it
  const inFolder = await addPage(page, project.id, FIXTURE.replace(/site\.html$/, "hover.html"), { title: "Hover C", folder_id: fid });
  expect(inFolder.folder_id).toBe(fid);
  await page.reload();
  await expect(page.locator('[data-testid="page-tile"]')).toHaveCount(2);
  // …and leaves again by dropping it on the project's name in the breadcrumb; the crumb's drop look ends with the drop
  const projectCrumb = page.getByTestId("project-crumb");
  await page.locator('[data-testid="page-tile"]').filter({ has: page.locator(`a[href="/r/${inFolder.id}"]`) }).dragTo(projectCrumb);
  await expect(page.locator('[data-testid="page-tile"]')).toHaveCount(1);
  await expect(projectCrumb).not.toHaveClass(/bg-blue-soft/);
  await expect(projectCrumb).not.toHaveAttribute("title", /Drop here/);
  expect((await (await page.request.get(`/api/reviews/${inFolder.id}`)).json()).review.folder_id).toBeNull();
  // an empty folder says so
  const emptyFolder = ((await (await page.request.post(`/api/projects/${project.id}/folders`, { data: { name: "  Later  " } })).json()) as { folder: { id: string; name: string } }).folder;
  expect(emptyFolder.name).toBe("Later");
  await page.goto(`/p/${project.id}/f/${emptyFolder.id}`);
  await expect(page.getByText(/This folder is empty — add a page above or drag pages here/)).toBeVisible();

  // delete the first folder: its pages come back to the root, comments intact
  await page.goto(`/p/${project.id}`);
  await expect(page.locator('[data-testid="page-tile"]')).toHaveCount(2); // B and C
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(/Pages in this project · 3 pages · 2 folders/);
  await page.getByRole("button", { name: "Options for folder Marketing pages" }).click();
  await page.getByRole("menuitem", { name: /Delete folder/ }).click();
  await expect(page.getByRole("dialog")).toContainText("The page inside moves back to the project — nothing is deleted.");
  await page.getByRole("dialog").getByRole("button", { name: "Delete folder" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('[data-testid="folder-tile"]')).toHaveCount(1); // "Later" stays
  await expect(page.locator('[data-testid="page-tile"]')).toHaveCount(3);
  await expect(tileA).toBeVisible();
  const reviewA = await (await page.request.get(`/api/reviews/${a.id}`)).json();
  expect(reviewA.review.folder_id).toBeNull();
  expect(reviewA.comments).toEqual(commentsBefore);
  expect((await page.request.get(`/p/${project.id}/f/${fid}`))?.status()).toBe(404);

  // validation: a folder of another project is refused, for moving and for creating
  const other = await createProject(page, "Other project");
  const foreign = ((await (await page.request.post(`/api/projects/${other.id}/folders`, { data: { name: "Elsewhere" } })).json()) as { folder: { id: string } }).folder;
  const refused = await page.request.patch(`/api/reviews/${a.id}`, { data: { folder_id: foreign.id } });
  expect(refused.status()).toBe(400);
  expect((await refused.json()).error).toBe("That folder is in another project.");
  const unknown = await page.request.patch(`/api/reviews/${a.id}`, { data: { folder_id: "nosuchfolder" } });
  expect(unknown.status()).toBe(400);
  expect((await unknown.json()).error).toBe("That folder doesn't exist in this project.");
  expect((await page.request.post("/api/reviews", { data: { project_id: project.id, url: FIXTURE, folder_id: foreign.id } })).status()).toBe(400);
  expect((await page.request.patch(`/api/projects/${project.id}/folders/${foreign.id}`, { data: { name: "x" } })).status()).toBe(404);
  expect((await page.request.post(`/api/projects/${project.id}/folders`, { data: { name: "   " } })).status()).toBe(400);
  // moving to another project drops the folder
  expect((await page.request.patch(`/api/reviews/${a.id}`, { data: { folder_id: emptyFolder.id } })).ok()).toBeTruthy();
  const moved = (await (await page.request.patch(`/api/reviews/${a.id}`, { data: { project_id: other.id } })).json()).review;
  expect(moved.project_id).toBe(other.id);
  expect(moved.folder_id).toBeNull();

  // a viewer sees folders but gets no "New folder", no menus and nothing to drag
  const viewerCtx = await browser.newContext();
  const vp = await viewerCtx.newPage();
  const viewer = await signIn(vp, "Vera Viewer");
  expect((await page.request.post(`/api/projects/${project.id}/members`, { data: { email: viewer.email, role: "view" } })).ok()).toBeTruthy();
  await vp.request.get("/api/me");
  await vp.goto(`/p/${project.id}`);
  await expect(vp.locator('[data-testid="folder-tile"]')).toHaveCount(1);
  await expect(vp.getByRole("button", { name: "New folder" })).toHaveCount(0);
  await expect(vp.locator("[draggable='true']")).toHaveCount(0);
  await expect(vp.getByRole("button", { name: /Options for/ })).toHaveCount(0);
  expect((await vp.request.post(`/api/projects/${project.id}/folders`, { data: { name: "Nope" } })).status()).toBe(403);
  expect((await vp.request.patch(`/api/reviews/${b.id}`, { data: { folder_id: emptyFolder.id } })).status()).toBe(403);
  await viewerCtx.close();
});
