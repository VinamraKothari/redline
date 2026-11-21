import { expect, test, type Locator, type Page } from "@playwright/test";
import { FIXTURE, createProject, signIn } from "./helpers";

/**
 * Selecting page cards on the project page the way a file manager does —
 * rubber band, Ctrl/Shift-click, Ctrl+A, Esc — and acting on the selection:
 * the floating bar, right-click menus, dragging several cards onto a folder,
 * bulk delete. Same setup as folders.spec.ts.
 */

async function addPage(page: Page, projectId: string, title: string, extra: Record<string, unknown> = {}) {
  const res = await page.request.post("/api/reviews", { data: { project_id: projectId, url: FIXTURE, viewport: 1440, title, ...extra } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).review as { id: string; title: string };
}

const tiles = (page: Page) => page.locator('[data-testid="page-tile"]');
const selectedTiles = (page: Page) => page.locator('[data-testid="page-tile"][aria-selected="true"]');
/** the preview: a click selects, a double-click opens */
const preview = (tile: Locator) => tile.locator('[title="Click to select · double-click to open"]');
const bar = (page: Page) => page.getByTestId("selection-bar");

async function boxOf(l: Locator) {
  const b = await l.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

async function folderOf(page: Page, reviewId: string): Promise<string | null> {
  return (await (await page.request.get(`/api/reviews/${reviewId}`)).json()).review.folder_id ?? null;
}

test("tiles: rubber band, Ctrl/Shift-click, Esc, Ctrl+A; right-click menus; multi-drag and bulk move/delete; viewers can't change anything", async ({ page, browser }) => {
  await signIn(page);
  const project = await createProject(page, "Tiles project");
  for (const t of ["One", "Two", "Three", "Four", "Five"]) await addPage(page, project.id, t);

  await page.goto(`/p/${project.id}`);
  await expect(tiles(page)).toHaveCount(5);
  // the grid's visual order is the order Shift-click and Ctrl+A go by
  const order = await tiles(page).evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.reviewId!));
  const tile = (i: number) => page.locator(`[data-testid="page-tile"][data-review-id="${order[i]}"]`);
  const grid = page.getByTestId("tile-grid");

  // ── rubber band: three columns, five cards → the sixth cell is empty grid background.
  // Drag from there up to the middle card of the first row: cards 2, 3 and 5 (indexes 1, 2, 4).
  const g = await boxOf(grid);
  const t5 = await boxOf(tile(4));
  const t2 = await boxOf(tile(1));
  const emptyCell = { x: g.x + g.width - 20, y: t5.y + t5.height - 20 };
  await page.mouse.move(emptyCell.x, emptyCell.y);
  await page.mouse.down();
  await page.mouse.move(emptyCell.x - 40, emptyCell.y - 40, { steps: 4 });
  await page.mouse.move(t2.x + t2.width / 2, t2.y + t2.height / 2, { steps: 8 });
  await expect(page.getByTestId("marquee")).toBeVisible();
  await page.mouse.up();
  await expect(page.getByTestId("marquee")).toHaveCount(0);
  await expect(selectedTiles(page)).toHaveCount(3);
  for (const i of [1, 2, 4]) await expect(tile(i)).toHaveAttribute("aria-selected", "true");
  await expect(tile(1).getByTestId("tile-check")).toBeVisible();
  await expect(bar(page)).toContainText("3 pages selected");
  // the band selected cards, not text
  expect(await page.evaluate(() => String(window.getSelection()))).toBe("");

  // Ctrl+click toggles one off
  await preview(tile(2)).click({ modifiers: ["ControlOrMeta"] });
  await expect(selectedTiles(page)).toHaveCount(2);
  await expect(tile(2)).toHaveAttribute("aria-selected", "false");
  await expect(bar(page)).toContainText("2 pages selected");

  // a plain click selects only that card; Shift+click selects the range from it
  await preview(tile(0)).click();
  await expect(selectedTiles(page)).toHaveCount(1);
  await preview(tile(3)).click({ modifiers: ["Shift"] });
  await expect(selectedTiles(page)).toHaveCount(4);
  await expect(tile(4)).toHaveAttribute("aria-selected", "false");

  // Esc clears, Ctrl+A selects everything in view, a click on the background clears
  await page.keyboard.press("Escape");
  await expect(selectedTiles(page)).toHaveCount(0);
  await expect(bar(page)).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+a");
  await expect(selectedTiles(page)).toHaveCount(5);
  await expect(bar(page)).toContainText("5 pages selected");
  await page.mouse.click(emptyCell.x, emptyCell.y);
  await expect(selectedTiles(page)).toHaveCount(0);

  // ── right-click a card: its own menu (and the card becomes the selection); no browser menu
  await preview(tile(0)).click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Delete page…" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Open in new tab" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Rename" })).toBeVisible();
  await expect(tile(0)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  // Esc in the menu only closed the menu
  await expect(selectedTiles(page)).toHaveCount(1);

  // the keyboard path to the same menu: Shift+F10 on a focused card
  await tile(2).getByRole("link").focus();
  await page.keyboard.press("Shift+F10");
  await expect(menu.getByRole("menuitem", { name: "Delete page…" })).toBeVisible();
  await expect(tile(2)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  // …and focus goes back to the card
  await expect(tile(2).getByRole("link")).toBeFocused();

  // right-click the background: New folder, Select all
  await page.mouse.click(emptyCell.x, emptyCell.y, { button: "right" });
  await expect(menu.getByRole("menuitem", { name: "Select all" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "New folder" }).click();
  await expect(page.getByLabel("New folder name")).toBeFocused();
  await page.keyboard.type("Archive");
  await page.keyboard.press("Enter");
  const folderTile = page.locator('[data-testid="folder-tile"]');
  await expect(folderTile).toContainText("Archive");
  const fid = (await folderTile.locator("a").first().getAttribute("href"))!.split("/f/")[1];

  // right-click inside a selection of two: the selection's menu
  await preview(tile(0)).click();
  await preview(tile(1)).click({ modifiers: ["ControlOrMeta"] });
  await preview(tile(1)).click({ button: "right" });
  await expect(menu.getByRole("menuitem", { name: "Delete 2 pages…" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Move 2 pages to folder…" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Open all in new tabs" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(selectedTiles(page)).toHaveCount(2);

  // ── drag one of the two onto the folder: both go
  await tile(1).dragTo(folderTile);
  await expect(folderTile).toContainText("2 pages");
  await expect(tiles(page)).toHaveCount(3);
  await expect.poll(() => folderOf(page, order[0])).toBe(fid);
  await expect.poll(() => folderOf(page, order[1])).toBe(fid);
  await expect(bar(page)).toHaveCount(0); // the moved pages left the view, and the selection with them

  // dragging a card that isn't selected takes only that card (and selects it)
  await preview(tile(2)).click();
  await tile(3).dragTo(folderTile);
  await expect(folderTile).toContainText("3 pages");
  await expect.poll(() => folderOf(page, order[3])).toBe(fid);
  await expect.poll(() => folderOf(page, order[2])).toBeNull();

  // ── the bar's "Move to folder…" moves the selection
  await page.keyboard.press("ControlOrMeta+a");
  await expect(bar(page)).toContainText("2 pages selected");
  await bar(page).getByRole("button", { name: "Move to folder…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Move 2 pages");
  await expect(dialog.getByRole("radio", { name: /Project root/ })).toBeDisabled();
  await dialog.getByRole("radio", { name: /Archive/ }).check();
  await dialog.getByRole("button", { name: "Move" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(folderTile).toContainText("5 pages");
  await expect(tiles(page)).toHaveCount(0);

  // ── inside the folder: the background menu leads back; select all → Delete → confirm
  await page.goto(`/p/${project.id}/f/${fid}`);
  await expect(tiles(page)).toHaveCount(5);
  const keep = order[4];
  await page.mouse.click(10, 500, { button: "right" });
  await expect(menu.getByRole("menuitem", { name: "Back to project" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "New folder" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+a");
  await preview(page.locator(`[data-testid="page-tile"][data-review-id="${keep}"]`)).click({ modifiers: ["ControlOrMeta"] });
  await expect(bar(page)).toContainText("4 pages selected");
  await page.keyboard.press("Delete");
  await expect(dialog).toContainText("Delete 4 pages and all their comments?");
  await expect(dialog).toContainText("This can't be undone.");
  await dialog.getByRole("button", { name: "Delete 4 pages" }).click();
  await expect(tiles(page)).toHaveCount(1);
  const remaining = async () => ((await (await page.request.get(`/api/projects/${project.id}`)).json()).reviews as { id: string }[]).map((r) => r.id);
  await expect.poll(remaining).toEqual([keep]);

  // ── an editor may only delete the pages they created: the dialog says so and deletes those
  const editorCtx = await browser.newContext();
  const ep = await editorCtx.newPage();
  const editor = await signIn(ep, "Eddie Editor");
  expect((await page.request.post(`/api/projects/${project.id}/members`, { data: { email: editor.email, role: "edit" } })).ok()).toBeTruthy();
  await ep.request.get("/api/me");
  const his = await addPage(ep, project.id, "Eddie's page", { folder_id: fid });
  await ep.goto(`/p/${project.id}/f/${fid}`);
  await expect(tiles(ep)).toHaveCount(2);
  await ep.keyboard.press("ControlOrMeta+a");
  await bar(ep).getByRole("button", { name: "Delete" }).click();
  await expect(ep.getByRole("dialog")).toContainText("1 of 2 can be deleted (you didn't create the others)");
  await ep.getByRole("dialog").getByRole("button", { name: "Delete page" }).click();
  await expect(tiles(ep)).toHaveCount(1);
  await expect.poll(async () => (await ep.request.get(`/api/reviews/${his.id}`)).ok()).toBe(false);
  expect((await ep.request.get(`/api/reviews/${keep}`)).ok()).toBeTruthy();
  await editorCtx.close();

  // ── a viewer can select, but the bar and the menus offer nothing that changes anything
  const viewerCtx = await browser.newContext();
  const vp = await viewerCtx.newPage();
  const viewer = await signIn(vp, "Vera Viewer");
  expect((await page.request.post(`/api/projects/${project.id}/members`, { data: { email: viewer.email, role: "view" } })).ok()).toBeTruthy();
  await vp.request.get("/api/me");
  await vp.goto(`/p/${project.id}/f/${fid}`);
  await expect(tiles(vp)).toHaveCount(1);
  await preview(tiles(vp).first()).click();
  await expect(bar(vp)).toContainText("1 page selected");
  await expect(bar(vp).getByRole("button", { name: /Move|Delete/ })).toHaveCount(0);
  await preview(tiles(vp).first()).click({ button: "right" });
  const vmenu = vp.getByRole("menu");
  await expect(vmenu.getByRole("menuitem", { name: "Open", exact: true })).toBeVisible();
  await expect(vmenu.getByRole("menuitem")).toHaveText(["Open", "Open in new tab"]);
  await vp.keyboard.press("Escape");
  await vp.goto(`/p/${project.id}`);
  await vp.mouse.click(10, 500, { button: "right" });
  await expect(vmenu.getByRole("menuitem", { name: "New folder" })).toHaveCount(0);
  await vp.keyboard.press("Escape");
  await vp.locator('[data-testid="folder-tile"]').click({ button: "right", position: { x: 40, y: 40 } });
  await expect(vmenu.getByRole("menuitem")).toHaveText(["Open"]);
  await viewerCtx.close();

  // the preview selects on a click and opens the page on a double-click; the title is still a plain link
  await page.goto(`/p/${project.id}/f/${fid}`);
  await preview(tiles(page).first()).dblclick();
  await page.waitForURL(`**/r/${keep}`);
});

test("tiles: on a touch screen a tap on the preview opens the page", async ({ browser }) => {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await signIn(page);
  const project = await createProject(page, "Touch project");
  const p = await addPage(page, project.id, "Tap me");
  await page.goto(`/p/${project.id}`);
  await preview(tiles(page).first()).tap();
  await page.waitForURL(`**/r/${p.id}`);
  await ctx.close();
});

test("tiles: the selection forgets pages that leave the view; right-click on the background lets go; bulk failures show by the bar; one page is deleted through the same dialog", async ({ page }) => {
  await signIn(page);
  const project = await createProject(page, "Pruning project");
  const a = await addPage(page, project.id, "Alpha");
  const b = await addPage(page, project.id, "Beta");
  const c = await addPage(page, project.id, "Gamma");
  expect((await page.request.post(`/api/projects/${project.id}/folders`, { data: { name: "Box" } })).ok()).toBeTruthy();
  await page.goto(`/p/${project.id}`);
  const tile = (id: string) => page.locator(`[data-testid="page-tile"][data-review-id="${id}"]`);
  const menu = page.getByRole("menu");
  const dialog = page.getByRole("dialog");

  // select Alpha, send it into the folder through its own menu, bring it back by deleting the folder: it comes back unselected
  await preview(tile(a.id)).click();
  await expect(bar(page)).toContainText("1 page selected");
  await page.getByRole("button", { name: "Options for Alpha" }).click();
  await page.getByRole("menuitem", { name: /Move to folder/ }).click();
  await dialog.getByRole("radio", { name: /Box/ }).check();
  await dialog.getByRole("button", { name: "Move" }).click();
  await expect(tile(a.id)).toHaveCount(0);
  await expect(bar(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Options for folder Box" }).click();
  await page.getByRole("menuitem", { name: /Delete folder/ }).click();
  await dialog.getByRole("button", { name: "Delete folder" }).click();
  await expect(tile(a.id)).toBeVisible();
  await expect(selectedTiles(page)).toHaveCount(0);
  await expect(bar(page)).toHaveCount(0);

  // a right-click on empty background clears the selection, and its menu is the project's
  await page.keyboard.press("ControlOrMeta+a");
  await expect(selectedTiles(page)).toHaveCount(3);
  await page.mouse.click(10, 500, { button: "right" });
  await expect(page.getByRole("menu", { name: "Project actions" })).toBeVisible();
  await expect(selectedTiles(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  // Beta disappears behind the page's back; deleting Alpha and Beta together reports the one failure next to the bar
  expect((await page.request.delete(`/api/reviews/${b.id}`)).ok()).toBeTruthy();
  await preview(tile(a.id)).click();
  await preview(tile(b.id)).click({ modifiers: ["ControlOrMeta"] });
  await page.keyboard.press("Delete");
  await dialog.getByRole("button", { name: "Delete 2 pages" }).click();
  await expect(page.getByTestId("bulk-notice")).toContainText("Couldn't delete 1 of 2 pages");
  await expect(tiles(page)).toHaveCount(1);
  await page.getByTestId("bulk-notice").getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByTestId("bulk-notice")).toHaveCount(0);

  // a single page: the menu item asks in the same dialog, not the browser's confirm()
  page.on("dialog", () => {
    throw new Error("no native confirm expected");
  });
  await preview(tile(c.id)).click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Delete page…" }).click();
  await expect(dialog).toContainText('Delete "Gamma" and all its comments?');
  await dialog.getByRole("button", { name: "Delete page" }).click();
  await expect(tiles(page)).toHaveCount(0);
  await expect.poll(async () => (await page.request.get(`/api/reviews/${c.id}`)).ok()).toBe(false);

  // Ctrl+A with nothing to select (only a folder at the root) doesn't select the page's text either
  await page.request.post(`/api/projects/${project.id}/folders`, { data: { name: "Empty" } });
  await page.reload();
  await expect(page.locator('[data-testid="folder-tile"]')).toHaveCount(1);
  await page.mouse.click(10, 500);
  await page.keyboard.press("ControlOrMeta+a");
  expect(await page.evaluate(() => String(window.getSelection()))).toBe("");
});
