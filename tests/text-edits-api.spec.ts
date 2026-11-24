import { promises as fs } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { FIXTURE, signIn } from "./helpers";
import type { TextEdit } from "../src/lib/types";
import { signUndo } from "../src/lib/text-edits/undo";

/**
 * The copy-edit API (/api/reviews/[id]/text-edits): one edit per block,
 * reset when the copy matches the original again, role checks, undo of
 * resets, server-side sanitizing, and the hand-offs (Jira CSV, Markdown,
 * agent API). Every test signs in fresh accounts (the Free plan allows one
 * project each).
 */

const RUN = Math.random().toString(36).slice(2, 7);

async function setup(page: Page, who: string) {
  const user = await signIn(page, `${who} ${RUN}`);
  const project = (await (await page.request.post("/api/projects", { data: { name: `Copy ${who}` } })).json()).project as { id: string };
  const res = await page.request.post("/api/reviews", { data: { project_id: project.id, url: FIXTURE, viewport: 1440 } });
  expect(res.ok()).toBeTruthy();
  const review = (await res.json()).review as { id: string };
  return { user, project, review, base: `/api/reviews/${review.id}/text-edits` };
}

const body = (over: Record<string, unknown> = {}) => ({
  selector: "main > h1",
  label: "the heading “Ship better design reviews”",
  before_html: "Ship better design reviews",
  after_html: "Ship <b>great</b> design reviews",
  viewport_width: 1440,
  ...over,
});

async function put(req: APIRequestContext, base: string, over: Record<string, unknown> = {}) {
  const res = await req.put(base, { data: body(over) });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as { edit?: TextEdit; deleted?: string | null };
}

async function list(req: APIRequestContext, base: string) {
  const res = await req.get(base);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { edits: TextEdit[] }).edits;
}

async function member(browser: Browser, owner: Page, projectId: string, who: string, role: "view" | "edit") {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const u = await signIn(page, `${who} ${RUN}`);
  const res = await owner.request.post(`/api/projects/${projectId}/members`, { data: { email: u.email, role } });
  expect(res.ok()).toBeTruthy();
  return { ctx, page, user: u };
}

test("saving a block creates one edit, later saves keep the original, and the original again resets it", async ({ page }) => {
  const { user, base } = await setup(page, "Cora Copy");
  expect(await list(page.request, base)).toEqual([]);

  const first = (await put(page.request, base, { before_html: 'Ship <span style="color:red">better</span>&nbsp;design reviews' })).edit!;
  expect(first).toMatchObject({
    selector: "main > h1",
    label: "the heading “Ship better design reviews”",
    before_html: "Ship better&nbsp;design reviews",
    before_text: "Ship better design reviews",
    after_html: "Ship <strong>great</strong> design reviews",
    after_text: "Ship great design reviews",
    viewport_width: 1440,
    status: "open",
    note: null,
    author_id: user.id,
    // (test accounts keep the name they were first created with: match the stem)
    author_name: expect.stringMatching(/^Cora Copy /),
  });
  expect(first.created_at).toBe(first.updated_at);

  // marked done with a note…
  const done = await page.request.patch(`${base}/${first.id}`, { data: { status: "done", note: "  Ship it  " } });
  expect((await done.json()).edit).toMatchObject({ status: "done", note: "Ship it" });

  // …then the block is edited again: same row, the first `before` stays, new copy reopens it
  await new Promise((r) => setTimeout(r, 15));
  const second = (await put(page.request, base, { before_html: "Ship great design reviews", after_html: "Ship <i>great</i> reviews", label: "the heading “Ship great design reviews”" })).edit!;
  expect(second.id).toBe(first.id);
  expect(second.before_html).toBe(first.before_html);
  expect(second.label).toBe(first.label);
  expect(second.after_html).toBe("Ship <em>great</em> reviews");
  expect(second.status).toBe("open");
  expect(second.note).toBe("Ship it");
  expect(second.updated_at > first.updated_at).toBeTruthy();
  expect(second.created_at).toBe(first.created_at);
  expect(await list(page.request, base)).toHaveLength(1);

  // PATCH can change the copy too, and clear the note
  const patched = (await (await page.request.patch(`${base}/${first.id}`, { data: { after_html: "Ship <u>great</u> reviews", note: "" } })).json()).edit as TextEdit;
  expect(patched).toMatchObject({ after_html: "Ship <u>great</u> reviews", after_text: "Ship great reviews", note: null });

  // another block is another edit
  await put(page.request, base, { selector: "main > p", before_html: "Old", after_html: "New" });
  expect((await list(page.request, base)).map((e) => e.selector)).toEqual(["main > h1", "main > p"]);

  // typing the original back (after cleaning) deletes the edit: that is a reset
  expect(await put(page.request, base, { after_html: "<span>Ship better</span>&nbsp;design reviews" })).toEqual({ deleted: first.id });
  expect((await list(page.request, base)).map((e) => e.selector)).toEqual(["main > p"]);
  // …and on a block without an edit it is a no-op
  expect(await put(page.request, base, { selector: "footer", before_html: "Same", after_html: "Same" })).toEqual({ deleted: null });
  // PATCHing the copy back to the original resets too
  const p = (await list(page.request, base))[0];
  expect(await (await page.request.patch(`${base}/${p.id}`, { data: { after_html: "Old" } })).json()).toEqual({ deleted: p.id });
  expect(await list(page.request, base)).toEqual([]);
});

test("rejects bad input", async ({ page }) => {
  const { base } = await setup(page, "Vale Valid");
  const bad = async (over: Record<string, unknown>) => (await page.request.put(base, { data: body(over) })).status();
  expect(await bad({ selector: "" })).toBe(400);
  expect(await bad({ selector: undefined })).toBe(400);
  expect(await bad({ selector: "x".repeat(1001) })).toBe(400);
  expect(await bad({ label: "x".repeat(141) })).toBe(400);
  expect(await bad({ after_html: "x".repeat(20_001) })).toBe(400);
  expect(await bad({ before_html: 42 })).toBe(400);
  expect(await bad({ note: "x".repeat(1001) })).toBe(400);
  expect(await bad({ viewport_width: 100 })).toBe(400);
  expect(await bad({ viewport_width: 5000 })).toBe(400);
  expect(await bad({ viewport_width: "wide" })).toBe(400);
  expect(await bad({ label: "x".repeat(140), note: "x".repeat(1000), after_html: "y".repeat(20_000) })).toBe(200);
  const e = (await list(page.request, base))[0];
  expect((await page.request.patch(`${base}/${e.id}`, { data: { status: "closed" } })).status()).toBe(400);
  expect((await page.request.patch(`${base}/${e.id}`, { data: {} })).status()).toBe(400);
});

test("viewers read but cannot write; another page's edits are not found; strangers see nothing", async ({ page, browser }) => {
  const { project, base } = await setup(page, "Owen Owner");
  const edit = (await put(page.request, base)).edit!;

  const viewer = await member(browser, page, project.id, "Vic Viewer", "view");
  expect((await list(viewer.page.request, base)).map((e) => e.id)).toEqual([edit.id]);
  expect((await viewer.page.request.put(base, { data: body({ after_html: "Hacked" }) })).status()).toBe(403);
  expect((await viewer.page.request.patch(`${base}/${edit.id}`, { data: { status: "done" } })).status()).toBe(403);
  expect((await viewer.page.request.delete(`${base}/${edit.id}`)).status()).toBe(403);
  expect((await viewer.page.request.delete(base)).status()).toBe(403);
  expect((await viewer.page.request.post(`${base}/restore`, { data: { tokens: [] } })).status()).toBe(403);

  // made an editor, the same person may handle edits someone else made
  expect((await page.request.post(`/api/projects/${project.id}/members`, { data: { email: viewer.user.email, role: "edit" } })).ok()).toBeTruthy();
  expect((await viewer.page.request.patch(`${base}/${edit.id}`, { data: { status: "done" } })).status()).toBe(200);
  await viewer.ctx.close();

  // an edit of another project's page, addressed through this page: 404, untouched
  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  const theirs = await setup(other, "Tess Theirs");
  const foreign = (await put(other.request, theirs.base)).edit!;
  expect((await page.request.patch(`${base}/${foreign.id}`, { data: { status: "done" } })).status()).toBe(404);
  expect((await page.request.delete(`${base}/${foreign.id}`)).status()).toBe(404);
  expect((await page.request.delete(`${base}/nosuchedit`)).status()).toBe(404);
  // nor can their undo token bring the row back into this page
  const token = (await (await other.request.delete(`${theirs.base}/${foreign.id}`)).json()).token as string;
  expect((await page.request.post(`${base}/restore`, { data: { tokens: [token] } })).status()).toBe(400);
  expect((await other.request.post(`${theirs.base}/restore`, { data: { tokens: [token] } })).status()).toBe(200);
  expect((await list(other.request, theirs.base)).map((e) => [e.id, e.status])).toEqual([[foreign.id, "open"]]);
  // a non-member can't even list them
  expect((await other.request.get(base)).status()).toBe(404);
  await otherCtx.close();
});

test("restore-all returns the rows with undo tokens, and only those tokens restore them", async ({ page }) => {
  const { review, base } = await setup(page, "Rhea Restore");
  const a = (await put(page.request, base)).edit!;
  const b = (await put(page.request, base, { selector: "main > p", before_html: "Old", after_html: "New", note: "why" })).edit!;
  await page.request.patch(`${base}/${b.id}`, { data: { status: "done" } });

  const removed = (await (await page.request.delete(base)).json()) as { ok: boolean; edits: TextEdit[]; tokens: string[] };
  expect(removed.ok).toBe(true);
  expect(removed.edits.map((e) => e.id)).toEqual([a.id, b.id]);
  expect(removed.tokens).toHaveLength(2);
  expect(await list(page.request, base)).toEqual([]);

  const restored = (await (await page.request.post(`${base}/restore`, { data: { tokens: removed.tokens } })).json()) as { edits: TextEdit[]; skipped: string[] };
  expect(restored.skipped).toEqual([]);
  const now = await list(page.request, base);
  expect(now.map((e) => [e.id, e.created_at, e.author_id, e.author_name, e.status, e.note, e.after_html])).toEqual([
    [a.id, a.created_at, a.author_id, a.author_name, "open", null, a.after_html],
    [b.id, b.created_at, b.author_id, b.author_name, "done", "why", "New"],
  ]);

  // one reset, undone
  const reset = (await (await page.request.delete(`${base}/${a.id}`)).json()) as { ok: boolean; edit: TextEdit; token: string };
  expect(reset.edit.id).toBe(a.id);
  expect((await list(page.request, base)).map((e) => e.id)).toEqual([b.id]);
  expect((await page.request.post(`${base}/restore`, { data: { tokens: [reset.token] } })).status()).toBe(200);
  expect((await list(page.request, base)).map((e) => e.id)).toEqual([a.id, b.id]);

  // a block that got a newer edit in the meantime keeps it; the old row is skipped
  const gone = (await (await page.request.delete(`${base}/${a.id}`)).json()) as { edit: TextEdit; token: string };
  const newer = (await put(page.request, base, { after_html: "Newer copy" })).edit!;
  const clash = (await (await page.request.post(`${base}/restore`, { data: { tokens: [gone.token] } })).json()) as { edits: TextEdit[]; skipped: string[] };
  expect(clash).toMatchObject({ edits: [], skipped: [a.id] });
  expect((await list(page.request, base)).find((e) => e.selector === "main > h1")!.id).toBe(newer.id);

  // nothing but an untouched, unexpired token of this page restores anything
  const status = async (tokens: unknown) => (await page.request.post(`${base}/restore`, { data: { tokens } })).status();
  const [payload, sig] = gone.token.split(".");
  const forgedRow = { ...gone.edit, id: `forged${RUN}`, selector: "aside", author_name: "The CEO", created_at: "2020-01-01T00:00:00.000Z" };
  expect(await status([`${Buffer.from(JSON.stringify({ v: 1, r: review.id, x: Date.now() + 1e7, e: forgedRow })).toString("base64url")}.${sig}`])).toBe(400);
  const flipped = payload.slice(0, -2) + (payload.at(-2) === "A" ? "B" : "A") + payload.at(-1);
  expect(await status([`${flipped}.${sig}`])).toBe(400);
  expect(await status([gone.token + "x"])).toBe(400);
  expect(await status(["nope"])).toBe(400);
  expect(await status([{ ...gone.edit }])).toBe(400);
  expect(await status("nope")).toBe(400);
  // signed with the server's key (the local development one here) but a day and more old
  expect(await status([signUndo(forgedRow, Date.now() - 25 * 3600 * 1000)])).toBe(400);
  // one bad token fails the whole request: nothing is restored
  expect(await status([signUndo({ ...forgedRow, selector: "header" }), "nope"])).toBe(400);
  expect((await list(page.request, base)).map((e) => e.selector).sort()).toEqual(["main > h1", "main > p"]);
  // at most 200 tokens, at most 2 MB
  expect(await status(Array.from({ length: 201 }, () => gone.token))).toBe(400);
  expect((await page.request.post(`${base}/restore`, { data: { tokens: ["x".repeat(2_200_000)] } })).status()).toBe(413);
});

test("spacing alone is no edit: &nbsp;, doubled and trailing spaces reset; a reset row is skipped on restore", async ({ page }) => {
  const { review, base } = await setup(page, "Sam Spacing");
  // contentEditable's &nbsp; for a space, a trailing space: no edit is stored
  expect(await put(page.request, base, { after_html: "Ship better&nbsp;design reviews" })).toEqual({ deleted: null });
  expect(await put(page.request, base, { after_html: "Ship better design reviews " })).toEqual({ deleted: null });
  expect(await put(page.request, base, { after_html: "Ship  better\n design reviews" })).toEqual({ deleted: null });
  expect(await list(page.request, base)).toEqual([]);
  // a real edit, then the original back with different spacing: a reset
  const e = (await put(page.request, base)).edit!;
  expect(await put(page.request, base, { after_html: " Ship better&nbsp;design reviews&nbsp;" })).toEqual({ deleted: e.id });
  // the same through PATCH
  const f = (await put(page.request, base)).edit!;
  expect(await (await page.request.patch(`${base}/${f.id}`, { data: { after_html: "Ship better design  reviews" } })).json()).toEqual({ deleted: f.id });
  // formatting alone is an edit
  expect((await put(page.request, base, { after_html: "<b>Ship</b> better design reviews" })).edit?.after_html).toBe("<strong>Ship</strong> better design reviews");

  // a row stored before this rule (only spacing differs) is not brought back by an undo
  const FILE = path.join(process.cwd(), ".data", "redline.json");
  const store = JSON.parse(await fs.readFile(FILE, "utf8")) as { textEdits: Record<string, TextEdit> };
  const old = (await list(page.request, base))[0];
  store.textEdits[old.id] = { ...old, after_html: "Ship better&nbsp;design reviews", after_text: "Ship better design reviews" };
  await fs.writeFile(FILE, JSON.stringify(store, null, 1), "utf8");
  const gone = (await (await page.request.delete(`${base}/${old.id}`)).json()) as { token: string };
  expect(await (await page.request.post(`/api/reviews/${review.id}/text-edits/restore`, { data: { tokens: [gone.token] } })).json()).toEqual({ edits: [], skipped: [old.id] });
});

test("PATCH with new copy reopens a done edit", async ({ page }) => {
  const { base } = await setup(page, "Rory Reopen");
  const e = (await put(page.request, base)).edit!;
  await page.request.patch(`${base}/${e.id}`, { data: { status: "done" } });
  const same = (await (await page.request.patch(`${base}/${e.id}`, { data: { after_html: e.after_html, note: "n" } })).json()).edit as TextEdit;
  expect(same.status).toBe("done");
  const changed = (await (await page.request.patch(`${base}/${e.id}`, { data: { after_html: "Ship <i>great</i> design reviews" } })).json()).edit as TextEdit;
  expect(changed.status).toBe("open");
  const both = (await (await page.request.patch(`${base}/${e.id}`, { data: { after_html: "Ship great reviews", status: "done" } })).json()).edit as TextEdit;
  expect(both.status).toBe("done");
});

test("long raw HTML is fine as long as the cleaned copy fits; hostile HTML can't stall the server", async ({ page }) => {
  const { base } = await setup(page, "Lena Long");
  // 4 000 characters of copy, each word in its own unstyled span (≈ 60 000 raw)
  const words = Array.from({ length: 700 }, (_, i) => `w${i}`);
  const wrapped = words.map((w) => `<span data-word="${w}" style="x">${w}</span>`).join(" ");
  expect(wrapped.length).toBeGreaterThan(20_000);
  const big = await page.request.put(base, { data: body({ after_html: wrapped }) });
  expect(big.status()).toBe(200);
  expect((await big.json()).edit.after_html).toBe(words.join(" "));
  // the cleaned copy itself must fit, and the raw input has a ceiling
  expect((await page.request.put(base, { data: body({ after_html: "x".repeat(20_001) }) })).status()).toBe(400);
  expect((await page.request.put(base, { data: body({ after_html: "<i>".repeat(66_667) + "x" }) })).status()).toBe(400);
  expect((await page.request.put(base, { data: body({ after_html: "<i></i>".repeat(28_000) + "ok" }) })).status()).toBe(200);
  // the worst case the review found took seconds; now it's quick
  const evil = " <br>".repeat(4000);
  const t = Date.now();
  expect((await page.request.put(base, { data: body({ selector: "p", before_html: evil, after_html: evil + "x" }) })).status()).toBe(200);
  expect(Date.now() - t).toBeLessThan(1000);
});

test("the site's classes are kept, nothing else", async ({ page }) => {
  const { base } = await setup(page, "Cleo Class");
  const e = (await put(page.request, base, {
    before_html: 'Ship <span class="text-brand md:text-[18px]" style="color:red" data-x="1">better</span> design reviews',
    after_html: 'Ship <span class="text-brand md:text-[18px]" id="z">great</span> <b class="font-black" onclick="x">design</b> <span class="a&quot; onclick=&quot;b">reviews</span>',
  })).edit!;
  expect(e.before_html).toBe('Ship <span class="text-brand md:text-[18px]">better</span> design reviews');
  expect(e.after_html).toBe('Ship <span class="text-brand md:text-[18px]">great</span> <strong class="font-black">design</strong> reviews');
});

test("the server stores sanitized copy, whatever the client sends", async ({ page }) => {
  const { base } = await setup(page, "Xena Xss");
  const payload =
    '<img src=x onerror="alert(1)"><a href="javascript:alert(1)">click</a><script>alert(2)</script> <b onclick="steal()">ok</b>' +
    '<a href=" jav&#x09;ascript:alert(3)">x</a><svg onload=alert(4)></svg><style>*{}</style><a href="https://ok.test/?a=1&b=2" target=_blank>fine</a>';
  const e = (await put(page.request, base, { before_html: '<span style="x">Before</span><iframe src="//evil"></iframe>', after_html: payload })).edit!;
  expect(e.before_html).toBe("Before");
  expect(e.after_html).toBe('click <strong>ok</strong>x<a href="https://ok.test/?a=1&amp;b=2">fine</a>');
  expect(e.after_text).toBe("click okxfine");
  const stored = (await list(page.request, base))[0];
  expect(stored.after_html).toBe(e.after_html);
  expect(JSON.stringify(stored)).not.toMatch(/script|onerror|onclick|javascript|svg|iframe|style/i);
});

test("Jira CSV and Markdown exports carry the copy edits", async ({ page }) => {
  const { review, base } = await setup(page, "Jo Jira");
  const e = (await put(page.request, base, { note: "Tone of voice" })).edit!;
  await page.request.post(`/api/reviews/${review.id}/comments`, {
    data: { body: "A comment", anchor: { selector: null, fx: 0, fy: 0, px: 10, py: 10 }, viewport_width: 1440 },
  });

  const csv = await (await page.request.get(`/api/reviews/${review.id}/export?format=jira`)).text();
  const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
  expect(lines).toHaveLength(3); // header, the comment, the copy edit
  const row = lines[2];
  expect(row.startsWith("Copy change: the heading “Ship better design reviews”,")).toBe(true);
  expect(row).toContain("*After:* Ship *great* design reviews");
  expect(row).toContain("*Before:* Ship better design reviews");
  expect(row).toContain("*Status:* Open");
  expect(row).toContain("*Note:* Tone of voice");
  expect(row).toContain(",Task,Medium,To Do,copy-change,");
  expect(row).toContain(`/r/${review.id}?copy=${e.id}`);

  // labels and names are typed by users: a cell that would be a formula is neutralized
  await put(page.request, base, { selector: "footer", label: '=HYPERLINK("http://evil.test","click")', after_html: "Other" });
  const csv2 = await (await page.request.get(`/api/reviews/${review.id}/export?format=jira`)).text();
  expect(csv2).toContain(`,"'=HYPERLINK(""http://evil.test"",""click"")",`);
  expect(csv2).not.toMatch(/(^|,)"?=HYPERLINK/m);

  const md = await (await page.request.get(`/api/reviews/${review.id}/export?format=md`)).text();
  expect(md).toContain("## Copy changes (2)");
  expect(md).toContain("After: Ship **great** design reviews");
});

test("the agent API lists copy edits made through the API", async ({ page }) => {
  const TOKEN = process.env.REDLINE_AGENT_TOKEN || "";
  const PROJECT = process.env.REDLINE_AGENT_PROJECT || "";
  test.skip(!TOKEN || !PROJECT, "agent API not configured (run through scripts/e2e.sh)");
  const user = await signIn(page, `Agnes Agent ${RUN}`);

  // the agent's project and a page in it, with this account as an editor (seeded like agent.spec.ts does)
  const FILE = path.join(process.cwd(), ".data", "redline.json");
  const store = JSON.parse(await fs.readFile(FILE, "utf8")) as Record<string, Record<string, unknown>>;
  const now = new Date().toISOString();
  for (const k of ["projects", "reviews", "members"]) store[k] = store[k] || {};
  store.projects[PROJECT] = store.projects[PROJECT] || { id: PROJECT, name: "Redline bugs", created_by: "u1", created_at: now, updated_at: now };
  store.reviews.agcopyrev = {
    id: "agcopyrev", project_id: PROJECT, folder_id: null, url: "https://example.test/copy", title: "Copy page", mode: "live", snapshot_path: null,
    default_viewport: 1440, created_by: "Agnes", created_by_id: null, owner_key: "k", thumbnail_url: null, thumbnail_at: null, created_at: now, updated_at: now,
  };
  store.members[`${PROJECT}/${user.id}`] = { project_id: PROJECT, user_id: user.id, role: "edit", created_at: now };
  await fs.writeFile(FILE, JSON.stringify(store, null, 1), "utf8");

  const base = "/api/reviews/agcopyrev/text-edits";
  const e = (await put(page.request, base, { after_html: 'Ship <b>great</b> <a href="javascript:x()">design</a> reviews' })).edit!;
  try {
    const auth = { authorization: `Bearer ${TOKEN}` };
    const all = await (await page.request.get("/api/agent/bugs?status=all&review=agcopyrev", { headers: auth })).json();
    expect(all.count).toBe(1);
    expect(all.threads[0]).toMatchObject({
      id: e.id,
      kind: "copy",
      status: "open",
      element: { selector: "main > h1" },
      copy: {
        selector: "main > h1",
        status: "open",
        before: { text: "Ship better design reviews", markdown: "Ship better design reviews" },
        after: { html: "Ship <strong>great</strong> design reviews", markdown: "Ship **great** design reviews", text: "Ship great design reviews" },
      },
    });
    const one = await (await page.request.get(`/api/agent/bugs/${e.id}`, { headers: auth })).json();
    expect(one.thread.copy.after.markdown).toBe("Ship **great** design reviews");
    // done = resolved for the agent
    await page.request.patch(`${base}/${e.id}`, { data: { status: "done" } });
    const open = await (await page.request.get("/api/agent/bugs?review=agcopyrev", { headers: auth })).json();
    expect(open.count).toBe(0);
  } finally {
    // leave the agent's project as agent.spec.ts expects it
    await page.request.delete(base);
  }
});
