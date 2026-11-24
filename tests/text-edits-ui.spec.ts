import { expect, test, type Browser, type FrameLocator, type Page } from "@playwright/test";
import { FIXTURE, pointIn, signIn } from "./helpers";
import type { TextEdit } from "../src/lib/types";

/**
 * The Text tool and the Copy tab: editing copy in place (caret, typing,
 * bold/italic/underline/links, undo inside the session, Enter / Esc / Shift+
 * Enter, plain-text paste), the three views, page-level undo, statuses,
 * realtime, roles, and that nothing hostile ever runs. Every test signs in
 * fresh accounts (the Free plan allows one project each).
 */

const RUN = Math.random().toString(36).slice(2, 7);
const H1 = 'h1[data-testid="headline"]';

async function setup(page: Page, who: string) {
  const user = await signIn(page, `${who} ${RUN}`);
  const project = (await (await page.request.post("/api/projects", { data: { name: `Copy UI ${who}` } })).json()).project as { id: string };
  const res = await page.request.post("/api/reviews", { data: { project_id: project.id, url: FIXTURE, viewport: 1440 } });
  expect(res.ok()).toBeTruthy();
  const review = (await res.json()).review as { id: string };
  return { user, project, review, base: `/api/reviews/${review.id}/text-edits` };
}

async function open(page: Page, reviewId: string, query = "") {
  await page.goto(`/r/${reviewId}${query}`);
  const frame = page.frameLocator('iframe[title="Page under review"]');
  await expect(frame.locator(H1)).toBeVisible();
  // the frame is wired up (overlays mount once it is ready)
  await expect(page.locator('iframe[title="Page under review"]')).toBeVisible();
  await page.waitForTimeout(300);
  return frame;
}

async function edits(page: Page, base: string): Promise<TextEdit[]> {
  const res = await page.request.get(base);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { edits: TextEdit[] }).edits;
}

async function putEdit(page: Page, base: string, over: Partial<{ selector: string; label: string; before_html: string; after_html: string }>) {
  const res = await page.request.put(base, {
    data: { selector: H1, label: "the heading “Ship better design reviews”", before_html: "Ship better design reviews", after_html: "Ship <b>great</b> design reviews", viewport_width: 1440, ...over },
  });
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { edit: TextEdit }).edit;
}

const html = (frame: FrameLocator, sel: string) => frame.locator(sel).evaluate((el) => el.innerHTML);

/** Select `word` inside the element (in the frame) as a user would by dragging over it. */
async function selectWord(frame: FrameLocator, sel: string, word: string) {
  await frame.locator(sel).evaluate((el, w) => {
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n as Text).data.indexOf(w);
      if (i === -1) continue;
      const r = el.ownerDocument.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + w.length);
      const s = el.ownerDocument.getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
      return;
    }
    throw new Error(`"${w}" not found`);
  }, word);
}

const TYPO = ["fontFamily", "fontSize", "letterSpacing", "lineHeight", "textTransform", "wordSpacing", "fontStyle"] as const;
async function typography(frame: FrameLocator, sel: string) {
  return frame.locator(sel).first().evaluate((el, props) => {
    const cs = getComputedStyle(el);
    return Object.fromEntries(props.map((p) => [p, cs[p as keyof CSSStyleDeclaration] as string]));
  }, TYPO as unknown as string[]);
}

async function enterTextTool(page: Page) {
  await page.keyboard.press("t");
  await expect(page.getByRole("button", { name: "Edit text — click any text to change it" })).toHaveClass(/bg-ink/);
}

async function clickIn(page: Page, sel: string, dx = 0.02, dy = 0.5) {
  const p = await pointIn(page, sel, dx, dy);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
}

test("the Text tool edits a heading in place: caret, typing, bold, undo/redo in the session, Enter saves clean HTML, typography stays", async ({ page }) => {
  const { review, base } = await setup(page, "Tess Type");
  const frame = await open(page, review.id);
  const typoBefore = await typography(frame, H1);
  const heightBefore = await frame.locator(H1).evaluate((el) => el.getBoundingClientRect().height);

  await enterTextTool(page);
  // the view switch appears with the tool, on Changes
  await expect(page.locator("[data-text-view]")).toHaveAttribute("data-text-view", "changes");

  // hover → dotted outline with a hint
  const p = await pointIn(page, H1, 0.1, 0.5);
  await page.mouse.move(p.x, p.y);
  await expect(page.locator("[data-text-hover]")).toBeVisible();
  await expect(page.getByText("Click to edit", { exact: true })).toBeVisible();

  // click → editable, focused, caret inside
  await page.mouse.click(p.x, p.y);
  await expect(frame.locator(H1)).toHaveAttribute("contenteditable", "true");
  expect(await frame.locator(H1).evaluate((el) => el.ownerDocument.activeElement === el && el.contains(el.ownerDocument.getSelection()!.anchorNode))).toBe(true);
  await expect(page.getByRole("toolbar", { name: "Text formatting" })).toBeVisible();

  // typing reflows the page live
  await page.keyboard.press("End");
  await page.keyboard.type(" for every team, today and tomorrow, wherever they are");
  await expect(frame.locator(H1)).toHaveText("Ship better design reviews for every team, today and tomorrow, wherever they are");
  expect(await frame.locator(H1).evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(heightBefore);

  // ⌘/Ctrl+B on a selected word → <strong>
  await selectWord(frame, H1, "today");
  await page.keyboard.press("ControlOrMeta+b");
  await expect(frame.locator(`${H1} strong`)).toHaveText("today");
  await expect(page.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");

  // undo / redo inside the session
  await page.keyboard.press("ControlOrMeta+z");
  await expect(frame.locator(`${H1} strong`)).toHaveCount(0);
  await expect(frame.locator(H1)).toContainText("today and tomorrow");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(frame.locator(H1)).toHaveText("Ship better design reviews");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(frame.locator(H1)).toContainText("wherever they are");
  await page.keyboard.press("Control+y");
  await expect(frame.locator(`${H1} strong`)).toHaveText("today");

  // italic and underline with the toolbar, on another word
  await selectWord(frame, H1, "team");
  await page.getByRole("button", { name: "Italic" }).click();
  await expect(frame.locator(`${H1} em`)).toHaveText("team");
  await selectWord(frame, H1, "every");
  await page.keyboard.press("ControlOrMeta+u");
  await expect(frame.locator(`${H1} u`)).toHaveText("every");

  // Enter saves
  await page.keyboard.press("Enter");
  await expect(frame.locator(H1)).not.toHaveAttribute("contenteditable", "true");
  await expect.poll(async () => (await edits(page, base)).length).toBe(1);
  const [saved] = await edits(page, base);
  expect(saved.after_html).toBe("Ship better design reviews for <u>every</u> <em>team</em>, <strong>today</strong> and tomorrow, wherever they are");
  expect(saved.after_html).not.toMatch(/style=|<span|<div|<font|<b>|<i>/);
  expect(saved.before_html).toBe("Ship better design reviews");
  expect(saved.selector).toBe(H1);
  expect(saved.label).toBe("the heading “Ship better design reviews”");

  // Changes view (the tool's default): the new words are marked
  await expect(frame.locator(`${H1} ins[data-rl-ins]`).first()).toBeVisible();
  await expect(frame.locator("style[data-redline-text]")).toHaveCount(1);
  await expect(page.locator(`[data-copy-outline="${saved.id}"]`)).toBeVisible();

  // Edited: exactly the new copy, no marks, no injected styles, nothing drawn over it
  await page.locator("[data-text-view]").getByRole("button", { name: "Edited" }).click();
  expect(await html(frame, H1)).toBe(saved.after_html);
  await expect(frame.locator("ins[data-rl-ins], del[data-rl-del], span[data-rl-fmt]")).toHaveCount(0);
  await expect(frame.locator("style[data-redline-text]")).toHaveCount(0);
  await expect(page.locator("[data-copy-outline]")).toHaveCount(0);

  // typography identical to the original (and inside the new <strong>, all but the weight)
  expect(await typography(frame, H1)).toEqual(typoBefore);
  const strongTypo = await typography(frame, `${H1} strong`);
  expect(strongTypo).toEqual(typoBefore);

  // Original: the page's own copy
  await page.locator("[data-text-view]").getByRole("button", { name: "Original" }).click();
  expect(await html(frame, H1)).toBe("Ship better design reviews");
  await expect(page.locator("[data-text-view]")).toHaveAttribute("data-text-view", "original");

  // Shift+T cycles back round to Edited
  await page.keyboard.press("Shift+T");
  await expect(page.locator("[data-text-view]")).toHaveAttribute("data-text-view", "edited");
  await expect(frame.locator(H1)).toHaveText(saved.after_text);
});

test("Esc discards, Shift+Enter breaks a line, paste is plain text, links come from the toolbar, a click elsewhere saves", async ({ page }) => {
  const { review, base } = await setup(page, "Pia Paste");
  const frame = await open(page, review.id);
  const P = "#hero > p";
  const original = await html(frame, P);
  await enterTextTool(page);

  // Shift+Enter → <br>; Esc → everything back, nothing saved
  await clickIn(page, P, 0.05);
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("Second line");
  expect(await html(frame, P)).toContain("<br>Second line");
  await page.keyboard.press("Escape");
  await expect(frame.locator(P)).not.toHaveAttribute("contenteditable", "true");
  expect(await html(frame, P)).toBe(original);
  // still in the Text tool (Esc only left the block)…
  await expect(page.getByRole("button", { name: "Edit text — click any text to change it" })).toHaveClass(/bg-ink/);
  await page.waitForTimeout(300);
  expect(await edits(page, base)).toEqual([]);

  // paste of rich HTML → plain text only
  await clickIn(page, P, 0.05);
  await frame.locator(P).evaluate((el) => {
    const s = el.ownerDocument.getSelection()!;
    s.selectAllChildren(el);
    const dt = new DataTransfer();
    dt.setData("text/html", '<b style="color:red">Rich</b> <img src=x onerror="window.__pasted=1"> words');
    dt.setData("text/plain", "Plain pasted words");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  expect(await html(frame, P)).toBe("Plain pasted words");

  // a link from the toolbar: unsafe addresses are refused, a bare domain gets https://
  await selectWord(frame, P, "pasted");
  await page.getByRole("button", { name: "Link", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Link address" });
  await expect(input).toBeFocused();
  await input.fill("javascript:alert(1)");
  await input.press("Enter");
  await expect(page.getByText(/Use a web address/)).toBeVisible();
  await input.fill("example.com/docs");
  await input.press("Enter");
  expect(await html(frame, P)).toBe('Plain <a href="https://example.com/docs">pasted</a> words');

  // a click on the link while editing doesn't navigate
  await clickIn(page, `${P} a`, 0.5);
  await expect(frame.locator(P)).toHaveAttribute("contenteditable", "true");
  expect(await frame.locator("body").evaluate((b) => b.ownerDocument.location.pathname)).toContain("site.html");

  // a click elsewhere on the page saves (and starts editing what was clicked)
  await clickIn(page, "section.grid .card:nth-of-type(1) h3", 0.3);
  await expect.poll(async () => (await edits(page, base)).map((e) => e.after_html)).toEqual(['Plain <a href="https://example.com/docs">pasted</a> words']);
  await expect(frame.locator("section.grid .card:nth-of-type(1) h3")).toHaveAttribute("contenteditable", "true");
  // … and a click in Redline's own UI saves too (nothing changed here: nothing more is saved)
  await page.getByRole("button", { name: "Browse the page" }).click();
  await expect(frame.locator("[contenteditable]")).toHaveCount(0);
  expect((await edits(page, base)).length).toBe(1);
  await expect.poll(() => frame.locator("body").evaluate(() => (window as unknown as { __pasted?: number }).__pasted)).toBeUndefined();
});

test("the Copy tab lists changes in page order; Copy, Done, Reset with page-level undo, Restore all with undo, and a reload re-applies", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { review, base } = await setup(page, "Cody Copy");
  const CARD = "section.grid > div:nth-of-type(2) > h3";
  // made in this order, listed in page order
  const card = await putEdit(page, base, { selector: CARD, label: "the heading “Drawing”", before_html: "Drawing", after_html: "Sketching" });
  const head = await putEdit(page, base, {});
  const frame = await open(page, review.id);

  // pages with edits open in the Edited view
  await expect(page.locator("[data-text-view]")).toHaveAttribute("data-text-view", "edited");
  await expect(page.locator("[data-text-view]")).toContainText("2 copy changes");
  await expect(frame.locator(H1)).toHaveText("Ship great design reviews");
  await expect(frame.locator(CARD)).toHaveText("Sketching");

  await page.getByRole("button", { name: /^Copy\s*2$/ }).click();
  const rows = page.locator("[data-copy-row]");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute("data-copy-row", head.id);
  await expect(rows.nth(1)).toHaveAttribute("data-copy-row", card.id);
  await expect(rows.nth(0)).toContainText("Open");
  await expect(rows.nth(0).locator("del")).toHaveText("better");
  await expect(rows.nth(0).locator("ins")).toHaveText("great");

  // Copy → Markdown for a developer
  await rows.nth(0).getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.getByText("Copied the change.")).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain("Where: the heading “Ship better design reviews” (selector: `h1[data-testid=\"headline\"]`)");
  expect(clip).toContain("Before: Ship better design reviews");
  expect(clip).toContain("After: Ship **great** design reviews");
  expect(clip).toContain("Status: Open");

  // Copy all
  await page.getByRole("button", { name: "Copy all" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("Copy changes: 2");

  // Mark done
  await rows.nth(1).getByRole("button", { name: "Mark done" }).click();
  await expect(rows.nth(1)).toHaveAttribute("data-status", "done");
  await expect.poll(async () => (await edits(page, base)).find((e) => e.id === card.id)?.status).toBe("done");

  // a note
  await rows.nth(1).getByRole("button", { name: "Add a note" }).click();
  await page.getByRole("textbox", { name: "Note" }).fill("Matches the brand voice doc");
  await page.getByRole("textbox", { name: "Note" }).blur();
  await expect.poll(async () => (await edits(page, base)).find((e) => e.id === card.id)?.note).toBe("Matches the brand voice doc");

  // Reset to original: the page's own text, the row goes; page-level ⌘Z in the Text tool brings it back
  await rows.nth(0).getByRole("button", { name: "Reset to original" }).click();
  await expect(frame.locator(H1)).toHaveText("Ship better design reviews");
  await expect(rows).toHaveCount(1);
  await expect.poll(async () => (await edits(page, base)).length).toBe(1);
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await enterTextTool(page);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByText(/^Undone: reset of the heading/)).toBeVisible();
  await expect(rows).toHaveCount(2);
  await expect.poll(async () => (await edits(page, base)).map((e) => e.id).sort()).toEqual([card.id, head.id].sort());
  await expect(frame.locator(`${H1} ins`)).toHaveText("great"); // the tool shows Changes
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.getByText(/^Redone: reset of the heading/)).toBeVisible();
  await expect(rows).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(rows).toHaveCount(2);

  // Restore all (confirmed), then Undo from the toast
  await page.getByRole("button", { name: "Restore all on this page" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Restore all" }).click();
  await expect(rows).toHaveCount(0);
  await expect(page.getByText("No copy changes yet.")).toBeVisible();
  await expect(frame.locator(H1)).toHaveText("Ship better design reviews");
  await expect(frame.locator(CARD)).toHaveText("Drawing");
  await expect.poll(async () => (await edits(page, base)).length).toBe(0);
  // (the newest toast's Undo)
  await page.getByRole("button", { name: "Undo" }).last().click();
  await expect(rows).toHaveCount(2);
  await expect.poll(async () => (await edits(page, base)).length).toBe(2);

  // leaving the tool goes back to the view from before; a reload re-applies the edits
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-text-view]")).toHaveAttribute("data-text-view", "edited");
  await page.reload();
  await expect(frame.locator(H1)).toHaveText("Ship great design reviews");
  await expect(frame.locator(CARD)).toHaveText("Sketching");
  await expect(frame.locator("ins, del")).toHaveCount(0);
});

test("statuses: live on the site, out of date, not found; a ?copy= link opens the tab and points at the edit", async ({ page }) => {
  const { review, base } = await setup(page, "Stella Status");
  const head = await putEdit(page, base, {});
  // the site already says "Drawing": the change has shipped
  const live = await putEdit(page, base, { selector: "section.grid > div:nth-of-type(2) > h3", label: "the heading “Sketching”", before_html: "Sketching", after_html: "Drawing" });
  // the page's text is neither the before nor the after
  const outdated = await putEdit(page, base, { selector: "#hero > p", label: "the paragraph “Old intro”", before_html: "Old intro", after_html: "New intro" });
  const missing = await putEdit(page, base, { selector: "#nowhere > p", label: "the paragraph “Gone”", before_html: "Gone", after_html: "Back" });

  const frame = await open(page, review.id, `?copy=${head.id}`);
  await expect(page.locator(`[data-copy-row="${head.id}"]`)).toBeVisible();
  await expect(page.locator(`[data-copy-flash="${head.id}"]`)).toBeAttached();
  expect(new URL(page.url()).searchParams.get("copy")).toBeNull();

  await expect(page.locator(`[data-copy-row="${head.id}"]`)).toHaveAttribute("data-status", "open");
  await expect(page.locator(`[data-copy-row="${live.id}"]`)).toHaveAttribute("data-status", "live");
  await expect(page.locator(`[data-copy-row="${live.id}"]`)).toContainText("Live on the site");
  await expect(page.locator(`[data-copy-row="${outdated.id}"]`)).toHaveAttribute("data-status", "outdated");
  await expect(page.locator(`[data-copy-row="${outdated.id}"]`)).toContainText("Old intro");
  await expect(page.locator(`[data-copy-row="${outdated.id}"]`)).toContainText("New intro");
  await expect(page.locator(`[data-copy-row="${missing.id}"]`)).toHaveAttribute("data-status", "missing");
  await expect(page.locator(`[data-copy-row="${missing.id}"]`)).toContainText("Not found");
  // not-found goes last
  await expect(page.locator("[data-copy-row]").last()).toHaveAttribute("data-copy-row", missing.id);

  // only the applicable edit is applied; the others leave the page as it is
  await expect(frame.locator(H1)).toHaveText("Ship great design reviews");
  await expect(frame.locator("section.grid > div:nth-of-type(2) > h3")).toHaveText("Drawing");
  await expect(frame.locator("#hero > p")).toContainText("Load any page");

  // new copy for a block whose edit is already live starts a fresh edit from today's text
  await enterTextTool(page);
  await clickIn(page, "section.grid > div:nth-of-type(2) > h3", 0.05);
  await page.keyboard.press("End");
  await page.keyboard.type(" tools");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await edits(page, base)).filter((e) => e.selector === live.selector).map((e) => [e.before_text, e.after_text, e.id === live.id])).toEqual([["Drawing", "Drawing tools", false]]);
  await expect(frame.locator("section.grid > div:nth-of-type(2) > h3 ins")).toHaveText(/tools/);
  const fresh = (await edits(page, base)).find((e) => e.selector === live.selector)!;
  await expect(page.locator(`[data-copy-row="${fresh.id}"]`)).toHaveAttribute("data-status", "open");
  // one ⌘Z puts the old edit back
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await edits(page, base)).filter((e) => e.selector === live.selector).map((e) => e.id)).toEqual([live.id]);
  await expect(frame.locator("section.grid > div:nth-of-type(2) > h3")).toHaveText("Drawing");
});

async function member(browser: Browser, owner: Page, projectId: string, who: string, role: "view" | "edit") {
  const ctx = await browser.newContext();
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await ctx.newPage();
  const u = await signIn(page, `${who} ${RUN}`);
  const res = await owner.request.post(`/api/projects/${projectId}/members`, { data: { email: u.email, role } });
  expect(res.ok()).toBeTruthy();
  return { ctx, page };
}

test("a teammate sees a saved edit without reloading; a viewer can switch views and copy, but not edit", async ({ page, browser }) => {
  const { review, project } = await setup(page, "Owen Owner");
  const frame = await open(page, review.id);
  const mate = await member(browser, page, project.id, "Mia Mate", "edit");
  const viewer = await member(browser, page, project.id, "Vic Viewer", "view");
  const mateFrame = await open(mate.page, review.id);

  await enterTextTool(page);
  await clickIn(page, H1, 0.05);
  await page.keyboard.press("End");
  await page.keyboard.type(" together");
  await page.keyboard.press("Enter");
  await expect(frame.locator(`${H1} ins`)).toHaveText(/together/);
  // the teammate's page follows (realtime, or polling without Supabase)
  await expect(mateFrame.locator(H1)).toHaveText("Ship better design reviews together", { timeout: 20_000 });

  const vFrame = await open(viewer.page, review.id);
  await expect(vFrame.locator(H1)).toHaveText("Ship better design reviews together");
  await expect(viewer.page.getByRole("button", { name: "Edit text — click any text to change it" })).toHaveCount(0);
  await viewer.page.keyboard.press("t");
  await expect(viewer.page.getByRole("toolbar", { name: "Text formatting" })).toHaveCount(0);
  // views work for viewers
  await viewer.page.locator("[data-text-view]").getByRole("button", { name: "Original" }).click();
  await expect(vFrame.locator(H1)).toHaveText("Ship better design reviews");
  await viewer.page.keyboard.press("Shift+T");
  await expect(vFrame.locator(H1)).toHaveText("Ship better design reviews together");
  // the Copy tab: read and copy only
  await viewer.page.getByRole("button", { name: /^Copy\s*1$/ }).click();
  const row = viewer.page.locator("[data-copy-row]");
  await expect(row).toHaveCount(1);
  await expect(row.getByRole("button", { name: "Reset to original" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Mark done" })).toHaveCount(0);
  await expect(viewer.page.getByRole("button", { name: "Restore all on this page" })).toHaveCount(0);
  await row.getByRole("button", { name: "Copy", exact: true }).click();
  await expect.poll(() => viewer.page.evaluate(() => navigator.clipboard.readText())).toContain("After: Ship better design reviews together");

  await mate.ctx.close();
  await viewer.ctx.close();
});

test("hostile copy never runs in any view, and a pin on an edited heading stays attached", async ({ page }) => {
  const { review, base } = await setup(page, "Xavier Xss");
  await putEdit(page, base, {
    after_html: 'Ship <img src=x onerror="window.__xss=1"><script>window.__xss=2</script><a href="javascript:window.__xss=3" onclick="window.__xss=4">safe</a> <svg onload="window.__xss=5"></svg>reviews',
  });
  const comment = await page.request.post(`/api/reviews/${review.id}/comments`, {
    data: { body: "Is this the final headline?", viewport_width: 1440, anchor: { selector: H1, fx: 0.2, fy: 0.5, px: 200, py: 100, region: null, element_label: "h1" } },
  });
  expect(comment.ok()).toBeTruthy();

  const frame = await open(page, review.id);
  for (const view of ["Changes", "Original", "Edited"]) {
    await page.locator("[data-text-view]").getByRole("button", { name: view }).click();
    await page.waitForTimeout(200);
    expect(await frame.locator(`${H1} img, ${H1} script, ${H1} svg, ${H1} [onclick]`).count()).toBe(0);
  }
  // the last view clicked is Edited: the cleaned copy, the unsafe link reduced to its text
  expect(await html(frame, H1)).toBe((await edits(page, base))[0].after_html);
  expect(await html(frame, H1)).not.toMatch(/javascript:|onerror|onclick|<img|<script/);
  expect(await frame.locator("body").evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

  // the pin resolves against the edited heading (its selector is untouched)
  const pin = page.locator("[data-pin]").first();
  await expect(pin).toBeVisible();
  await expect(pin).not.toHaveAttribute("title", /no longer on the page/);
});

/* ─── a Next/Tailwind-style page (tests/fixtures/copy-next.html) ───────── */

const NEXT = FIXTURE.replace(/[^/]*$/, "copy-next.html");
const STYLE_PROPS = ["color", "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "textTransform", "textDecorationLine", "textDecorationThickness", "textDecorationColor", "textUnderlineOffset", "wordSpacing"];
const INLINE_SELS = ["#sub", "#sub span.text-indigo-600", "#sub a", "#sub .italic-serif", "#cta .label", "nav a", "#feat li:nth-child(3) strong", "#dark-h"];

async function setupNext(page: Page, who: string) {
  const s = await setup(page, who);
  const res = await page.request.post("/api/reviews", { data: { project_id: s.project.id, url: NEXT, viewport: 1440 } });
  expect(res.ok()).toBeTruthy();
  const review = (await res.json()).review as { id: string };
  return { ...s, review, base: `/api/reviews/${review.id}/text-edits` };
}

async function openNext(page: Page, reviewId: string) {
  await page.goto(`/r/${reviewId}`);
  const frame = page.frameLocator('iframe[title="Page under review"]');
  await expect(frame.locator("#hero")).toBeVisible();
  await page.waitForTimeout(600);
  return frame;
}

async function styles(frame: FrameLocator) {
  const out: Record<string, Record<string, string>> = {};
  for (const sel of INLINE_SELS) {
    out[sel] = await frame.locator(sel).first().evaluate((el, props) => {
      const cs = getComputedStyle(el);
      return Object.fromEntries(props.map((p) => [p, cs[p as keyof CSSStyleDeclaration] as string]));
    }, STYLE_PROPS);
  }
  return out;
}

const win = (frame: FrameLocator, key: string) => frame.locator("body").evaluate((_, k) => (window as unknown as Record<string, unknown>)[k], key);

test("on a Tailwind-style page the site's styled spans and links survive typing and formatting; links in a nav stay separate; icon buttons edit around the icon", async ({ page }) => {
  const { review, base } = await setupNext(page, "Nia Next");
  const frame = await openNext(page, review.id);
  const live = await styles(frame);
  await enterTextTool(page);

  // a word typed in the paragraph, bold elsewhere in it
  await clickIn(page, "#sub", 0.02);
  await selectWord(frame, "#sub", "faster");
  await page.keyboard.type("quicker");
  await selectWord(frame, "#sub", "team");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await edits(page, base)).length).toBe(1);
  const [sub] = await edits(page, base);
  expect(sub.selector).toBe("#sub");
  expect(sub.before_html).toContain('href="/guide"');
  expect(sub.after_html).toBe(
    // the site's own link as the site writes it (the proxy made it absolute in the page)
    'Ship quicker with <span class="text-indigo-600 font-semibold">50% fewer bugs</span> and a <a href="/guide" class="text-sky-600 underline decoration-2 underline-offset-4">step-by-step guide</a> that works for <span class="italic-serif">every</span> <strong>team</strong>.',
  );

  // Changes: a hair of space between what went and what came
  await expect(frame.locator("#sub del[data-rl-del] + ins[data-rl-ins]")).toHaveCount(1);
  expect(parseFloat(await frame.locator("#sub del + ins").evaluate((el) => getComputedStyle(el).marginLeft))).toBeGreaterThan(0);

  // Edited: every inline element looks exactly as on the live page
  await page.locator("[data-text-view]").getByRole("button", { name: "Edited" }).click();
  await expect(frame.locator("#sub")).toContainText("Ship quicker with");
  expect(await styles(frame)).toEqual(live);

  // a nav is a set of links, each its own block — never one block that flattens them
  const gap = await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="Page under review"]')!;
    const fr = iframe.getBoundingClientRect();
    const zoom = fr.width / iframe.offsetWidth;
    const [a, b] = Array.from(iframe.contentDocument!.querySelectorAll("nav a")).map((x) => x.getBoundingClientRect());
    return { x: fr.left + ((a.right + b.left) / 2) * zoom, y: fr.top + (a.top + a.height / 2) * zoom };
  });
  await page.mouse.move(gap.x, gap.y);
  await expect(page.locator("[data-text-hover]")).toHaveCount(0);
  await clickIn(page, "nav a:nth-of-type(2)", 0.3);
  await expect(frame.locator("nav a:nth-of-type(2)")).toHaveAttribute("contenteditable", "true");
  await expect(frame.locator("nav")).not.toHaveAttribute("contenteditable", "true");
  await page.keyboard.press("Escape");

  // an icon button: the label is edited, the icon stays — even after select-all and typing
  await clickIn(page, "#b1", 0.6);
  await expect(frame.locator("#b1")).toHaveAttribute("contenteditable", "true");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Save draft");
  await expect(frame.locator("#b1 > svg")).toHaveCount(1);
  await page.keyboard.press("Enter");
  // a link with an icon: same
  await clickIn(page, "#l1", 0.8);
  await page.keyboard.press("End");
  await page.keyboard.type(" first");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await edits(page, base)).map((e) => [e.selector, e.after_html]).sort()).toEqual(
    [
      ["#b1", "Save draft"],
      ["#l1", " Read the docs firs"],
      ["#sub", sub.after_html],
    ].sort(),
  );
  await page.locator("[data-text-view]").getByRole("button", { name: "Edited" }).click();
  expect(await html(frame, "#b1")).toMatch(/^<svg[^>]*>.*<\/svg>Save draft$/);
  expect(await html(frame, "#l1")).toMatch(/^<svg[^>]*>.*<\/svg> Read the docs firs$/);
  await page.locator("[data-text-view]").getByRole("button", { name: "Original" }).click();
  expect(await html(frame, "#b1")).toMatch(/^<svg[^>]*>.*<\/svg>Save changes$/);

  // copy that can't be written back as it is (an image between its words) says so, and doesn't open
  await clickIn(page, "#hero", 0.1); // (anything, to leave the last block)
  await page.keyboard.press("Escape");
  const p1 = await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="Page under review"]')!;
    const fr = iframe.getBoundingClientRect();
    const zoom = fr.width / iframe.offsetWidth;
    const doc = iframe.contentDocument!;
    const r = doc.createRange();
    const text = doc.querySelector("#p1")!.firstChild!;
    r.setStart(text, 1);
    r.setEnd(text, 2);
    const b = r.getBoundingClientRect();
    return { x: fr.left + (b.left + b.width / 2) * zoom, y: fr.top + (b.top + b.height / 2) * zoom };
  });
  await page.mouse.move(p1.x, p1.y);
  await expect(page.locator('[data-text-hover="refused"]')).toBeVisible();
  await expect(page.getByText("This text can't be edited here")).toBeVisible();
  await page.mouse.click(p1.x, p1.y);
  await expect(frame.locator("[contenteditable]")).toHaveCount(0);

  // the page's own handlers never fire: no navigation, no form submit, no button handler, no site shortcut
  await clickIn(page, "#cta .label", 0.5);
  await page.keyboard.press("Escape");
  await clickIn(page, "nav a:nth-of-type(1)", 0.5);
  await page.keyboard.press("Escape");
  // focus is in the page now: a site shortcut stays quiet, Redline's still work
  await page.keyboard.press("/");
  const view = await page.locator("[data-text-view]").getAttribute("data-text-view");
  await page.keyboard.press("Shift+T");
  await expect(page.locator("[data-text-view]")).not.toHaveAttribute("data-text-view", view!);
  expect([await win(frame, "__nav"), await win(frame, "__submits"), await win(frame, "__btn"), await win(frame, "__shortcut"), await win(frame, "__docClicks")]).toEqual([0, 0, 0, 0, 0]);

  // a phone-sized window: the view switch folds into a menu, the panel lies over the page
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: /^Copy view: / })).toBeVisible();
  await expect(page.locator('[data-text-view] [role="group"]')).toBeHidden();
  const panel = await page.locator("aside").boundingBox();
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(390);
});

test("edits never touch what isn't copy, a page that keeps replacing a block is given up on, and the page keeps syncing while it ticks", async ({ page, browser }) => {
  const { review, base, project } = await setupNext(page, "Rhea Refuse");
  await putEdit(page, base, { selector: "title", label: "the title", before_html: "Acme — Next-like", after_html: "Hacked" });
  await putEdit(page, base, { selector: "#signup", label: "the form", before_html: "", after_html: "Gone" });
  await putEdit(page, base, { selector: "#feat", label: "the list", before_html: "Unlimited projects for small teams Realtime collaboration with comments Export to Jira and Linear", after_html: "Flattened" });
  const fight = await putEdit(page, base, { selector: "#rerender", label: "the paragraph “Rendered by the client”", before_html: "Rendered by the client", after_html: "Rendered on the server" });
  const frame = await openNext(page, review.id);

  await page.getByRole("button", { name: /^Copy\s*4$/ }).click();
  for (const e of await edits(page, base)) {
    if (e.id === fight.id) continue;
    await expect(page.locator(`[data-copy-row="${e.id}"]`)).toHaveAttribute("data-status", "missing");
  }
  expect(await frame.locator("body").evaluate((b) => b.ownerDocument.title)).toBe("Acme — Next-like");
  await expect(frame.locator("#signup input[name=email]")).toHaveCount(1);
  await expect(frame.locator("#feat li")).toHaveCount(3);

  // a framework re-rendering the block over and over: Redline stops after a while and says so
  await expect(frame.locator("#rerender")).toHaveText("Rendered on the server");
  await frame.locator("body").evaluate(() => {
    let n = 0;
    const t = setInterval(() => {
      document.getElementById("rerender")!.textContent = "Rendered by the client";
      if (++n > 40) clearInterval(t);
    }, 160);
  });
  await expect(page.locator(`[data-copy-row="${fight.id}"]`)).toHaveAttribute("data-status", "unstable", { timeout: 15_000 });
  await expect(page.locator(`[data-copy-row="${fight.id}"]`)).toContainText("Page keeps replacing it");

  // with the page mutating every second, a teammate's new edit still arrives (the sync timers keep running)
  const mate = await member(browser, page, project.id, "Teo Tick", "edit");
  await putEdit(mate.page, base, { selector: "#dark-p", label: "the paragraph", before_html: "From startups to the enterprise, everyone reviews in one place.", after_html: "Every team reviews in one place." });
  await expect(frame.locator("#dark-p")).toHaveText("Every team reviews in one place.", { timeout: 20_000 });
  await mate.ctx.close();
});

test("captures keep the page's own copy and none of the Text tool's traces; ⌘Z undoes a reset from the Copy tab in any tool; unsaved copy asks before leaving", async ({ page }) => {
  const { review, base } = await setup(page, "Fred Freeze");
  const head = await putEdit(page, base, {});
  const frame = await open(page, review.id);

  // Freeze while a block is being edited in the Text tool
  await enterTextTool(page);
  await clickIn(page, "section.grid > div:nth-of-type(1) > h3", 0.2);
  await expect(frame.locator("section.grid > div:nth-of-type(1) > h3")).toHaveAttribute("contenteditable", "true");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("redline:freeze")));
  await expect(page.getByText("Frozen. Everyone now sees this exact version.")).toBeVisible({ timeout: 30_000 });
  const snap = await (await page.request.get(`/api/snapshot/${review.id}`)).text();
  expect(snap).not.toMatch(/data-redline-text|contenteditable|data-rl-/);
  expect(snap).toContain("Ship better design reviews");
  // (freezing in place leaves the frame on its snapshot URL — the "left the page" banner predates copy edits): reload
  await page.reload();
  await expect(frame.locator(H1)).toBeVisible();
  await page.waitForTimeout(300);

  // Reset from the Copy tab, then ⌘Z outside the Text tool brings it back (not a drawing undo), and its toast goes
  await page.getByRole("button", { name: /^Copy\s*1$/ }).click();
  await page.locator(`[data-copy-row="${head.id}"]`).getByRole("button", { name: "Reset to original" }).click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect.poll(async () => (await edits(page, base)).length).toBe(0);
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await edits(page, base)).map((e) => e.id)).toEqual([head.id]);
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(page.locator(`[data-copy-row="${head.id}"]`)).toBeVisible();

  // unsaved copy: leaving the page asks first
  await enterTextTool(page);
  await clickIn(page, "#hero > p", 0.05);
  await page.keyboard.type("Unsaved ");
  const dialog = new Promise<string>((resolve) => page.once("dialog", (d) => (resolve(d.type()), void d.dismiss())));
  await page.close({ runBeforeUnload: true });
  expect(await dialog).toBe("beforeunload");
});

/** Client point of the `at`-th character of `word` in `sel` (in the frame), skipping text inside deletions. */
async function wordPoint(page: Page, sel: string, word: string, at = 0, end = false) {
  return page.evaluate(
    ({ sel, word, at, end }) => {
      const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="Page under review"]')!;
      const fr = iframe.getBoundingClientRect();
      const zoom = fr.width / iframe.offsetWidth;
      const doc = iframe.contentDocument!;
      const w = doc.createTreeWalker(doc.querySelector(sel)!, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
        if (n.parentElement?.closest("del")) continue;
        const i = n.data.indexOf(word);
        if (i < 0) continue;
        const r = doc.createRange();
        r.setStart(n, i + at);
        r.setEnd(n, i + at + 1);
        const b = r.getBoundingClientRect();
        return { x: fr.left + (end ? b.right - 1 : b.left + b.width / 2) * zoom, y: fr.top + (b.top + b.height / 2) * zoom };
      }
      throw new Error(`no ${word}`);
    },
    { sel, word, at, end },
  );
}

const selection = (frame: FrameLocator) => frame.locator("body").evaluate((b) => b.ownerDocument.getSelection()!.toString());

test("on a changed block in the Changes view, a double-click or a drag selects what was under the pointer; emptying a block asks first", async ({ page }) => {
  const { review, base } = await setupNext(page, "Gus Gesture");
  const DARK = "#dark-p";
  await putEdit(page, base, { selector: DARK, label: "the paragraph", before_html: "From startups to the enterprise, everyone reviews in one place.", after_html: "From startups to the enterprise, every team reviews here." });
  const frame = await openNext(page, review.id);
  await enterTextTool(page);
  await expect(frame.locator(`${DARK} del`).first()).toBeVisible();

  // a real double-click on "reviews" as Changes shows it: that word, and ⌘B bolds exactly it
  const r = await wordPoint(page, DARK, "reviews", 2);
  await page.mouse.dblclick(r.x, r.y);
  await expect(frame.locator(DARK)).toHaveAttribute("contenteditable", "true");
  expect(await selection(frame)).toBe("reviews");
  await page.keyboard.press("ControlOrMeta+b");
  await expect(frame.locator(`${DARK} strong`)).toHaveText("reviews");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await edits(page, base))[0].after_html).toBe("From startups to the enterprise, every team <strong>reviews</strong> here.");

  // a drag from "every" to "team", read on the Changes rendering
  const a = await wordPoint(page, DARK, "every", 0);
  const b = await wordPoint(page, DARK, "team", 3, true);
  await page.mouse.move(a.x - 1, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, b.y, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  expect(await selection(frame)).toBe("every team");
  await page.keyboard.press("ControlOrMeta+i");
  await expect(frame.locator(`${DARK} em`)).toHaveText("every team");
  await page.keyboard.press("Escape");

  // a triple-click selects all of the copy
  const t = await wordPoint(page, DARK, "startups", 1);
  await page.mouse.click(t.x, t.y, { clickCount: 1 });
  await page.keyboard.press("Escape");
  await page.mouse.click(t.x, t.y, { clickCount: 3, delay: 20 });
  await expect.poll(() => selection(frame)).toBe("From startups to the enterprise, every team reviews here.");

  // emptying the block: Enter asks in the toolbar; Keep editing goes back, Remove saves it
  await page.keyboard.press("Backspace");
  await expect(frame.locator(DARK)).toHaveText("");
  await page.keyboard.press("Enter");
  const ask = page.getByRole("alertdialog", { name: "Remove all of this text?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Keep editing" }).click();
  await expect(ask).toHaveCount(0);
  await expect(frame.locator(DARK)).toHaveAttribute("contenteditable", "true");
  // a click elsewhere doesn't save an empty block: the text comes back
  await clickIn(page, "#hero", 0.1);
  await expect(page.getByText(/The emptied text wasn't saved/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(frame.locator(DARK)).toContainText("reviews");
  expect((await edits(page, base))[0].after_text).toBe("From startups to the enterprise, every team reviews here.");
  // … and confirmed, it is saved empty
  await clickIn(page, DARK, 0.05);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  await page.getByRole("alertdialog", { name: "Remove all of this text?" }).getByRole("button", { name: "Remove" }).click();
  await expect.poll(async () => (await edits(page, base))[0].after_html).toBe("");
});
