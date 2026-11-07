import { promises as fs } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * The read-only agent API (/api/agent/bugs). scripts/e2e.sh starts the server
 * with REDLINE_AGENT_TOKEN / REDLINE_AGENT_PROJECT; this spec seeds that
 * project straight into the local store (.data/redline.json, re-read by the
 * server on every request) so its id is known in advance.
 */

const TOKEN = process.env.REDLINE_AGENT_TOKEN || "";
const PROJECT = process.env.REDLINE_AGENT_PROJECT || "";
const FILE = path.join(process.cwd(), ".data", "redline.json");
const auth = { authorization: `Bearer ${TOKEN}` };

const now = "2026-11-01T10:00:00.000Z";
const later = "2026-11-01T11:00:00.000Z";
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function review(id: string, project_id: string, folder_id: string | null = null) {
  return {
    id, project_id, folder_id, url: `https://example.test/${id}`, title: `Page ${id}`, mode: "live", snapshot_path: null,
    default_viewport: 1440, created_by: "Priya", created_by_id: null, owner_key: "secret-owner-key", thumbnail_url: null,
    thumbnail_at: null, created_at: now, updated_at: now,
  };
}

function comment(id: string, review_id: string, extra: Record<string, unknown> = {}) {
  return {
    id, review_id, parent_id: null, author_id: "u1", author_name: "Priya", author_color: "#e2342b", title: null,
    body: "Something is off", anchor: null, viewport_width: 1440, resolved: false, reactions: {}, attachments: [],
    edited_at: null, created_at: now, ...extra,
  };
}

test.beforeAll(async () => {
  test.skip(!TOKEN || !PROJECT, "agent API not configured (run through scripts/e2e.sh)");
  let store: Record<string, Record<string, unknown>> = {};
  try {
    store = JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    /* fresh run */
  }
  for (const k of ["projects", "folders", "reviews", "comments"]) store[k] = store[k] || {};
  store.projects[PROJECT] = { id: PROJECT, name: "Redline bugs", created_by: "u1", created_at: now, updated_at: now };
  store.projects.otherproj = { id: "otherproj", name: "Someone else", created_by: "u2", created_at: now, updated_at: now };
  store.folders.agfolder1 = { id: "agfolder1", project_id: PROJECT, name: "Checkout", position: 0, created_by: "u1", created_at: now, updated_at: now };
  store.reviews.agpage001 = review("agpage001", PROJECT, "agfolder1");
  store.reviews.agpage002 = review("agpage002", PROJECT);
  store.reviews.agother01 = review("agother01", "otherproj");
  store.comments.agthread1 = comment("agthread1", "agpage001", {
    title: "Button overlaps price",
    body: "On phones the button covers the price, ask @[Sam]",
    viewport_width: 390,
    anchor: {
      selector: "main > section.hero > button", fx: 0.5, fy: 0.5, px: 120, py: 640,
      region: { x: 100, y: 600, w: 200, h: 80 }, element_label: "main › section.hero › button",
      viewports: { min: 0, max: 699 },
    },
    attachments: [{ id: "att1", name: "shot.png", url: PIXEL, w: 1, h: 1 }],
  });
  store.comments.agreply01 = comment("agreply01", "agpage001", { parent_id: "agthread1", body: "Same on tablet", author_name: "Sam", created_at: later });
  store.comments.agthread2 = comment("agthread2", "agpage002", { body: "Fixed already", resolved: true, created_at: later });
  store.comments.agthread3 = comment("agthread3", "agother01", { body: "Not for the agent" });
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(store, null, 1), "utf8");
});

test("rejects requests without the right token", async ({ request }) => {
  expect((await request.get("/api/agent/bugs")).status()).toBe(401);
  expect((await request.get("/api/agent/bugs", { headers: { authorization: `Bearer ${TOKEN}x` } })).status()).toBe(401);
  expect((await request.get("/api/agent/bugs", { headers: { authorization: TOKEN } })).status()).toBe(401);
  expect((await request.get("/api/agent/bugs/agthread1")).status()).toBe(401);
});

test("lists open threads of the configured project with full context", async ({ request }) => {
  const res = await request.get("/api/agent/bugs", { headers: auth });
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toContain("no-store");
  const body = await res.json();
  expect(body.project).toEqual({ id: PROJECT, name: "Redline bugs" });
  expect(body.count).toBe(1);
  const t = body.threads[0];
  expect(t).toMatchObject({
    id: "agthread1",
    status: "open",
    kind: "comment",
    title: "Button overlaps price",
    body: "On phones the button covers the price, ask @Sam",
    page: { review_id: "agpage001", url: "https://example.test/agpage001", folder: "Checkout" },
    viewport: { written_at: 390, range: { min: 0, max: 699 } },
    element: { label: "main › section.hero › button", selector: "main > section.hero > button" },
    region: { x: 100, y: 600, w: 200, h: 80 },
    replies: [{ id: "agreply01", author: "Sam", body: "Same on tablet" }],
  });
  expect(t.link).toMatch(/\/r\/agpage001\?c=agthread1$/);
  // inline images come back as a downloadable URL, never as a data: blob
  expect(t.attachments[0].url).toMatch(/\/api\/attachments\/agthread1\/att1$/);
  expect(JSON.stringify(body)).not.toContain("data:image");
  expect(JSON.stringify(body)).not.toContain("secret-owner-key");
  // the image itself downloads
  expect((await request.get(new URL(t.attachments[0].url).pathname)).headers()["content-type"]).toBe("image/png");
});

test("filters by status and page, and never leaves the project", async ({ request }) => {
  const all = await (await request.get("/api/agent/bugs?status=all", { headers: auth })).json();
  expect(all.threads.map((t: { id: string }) => t.id)).toEqual(["agthread1", "agthread2"]);
  const resolved = await (await request.get("/api/agent/bugs?status=resolved", { headers: auth })).json();
  expect(resolved.threads.map((t: { id: string }) => t.id)).toEqual(["agthread2"]);
  const page = await (await request.get("/api/agent/bugs?status=all&review=agpage002", { headers: auth })).json();
  expect(page.count).toBe(1);
  expect((await request.get("/api/agent/bugs?review=agother01", { headers: auth })).status()).toBe(404);
  expect((await request.get("/api/agent/bugs?status=nope", { headers: auth })).status()).toBe(400);
});

test("returns one thread by its id or a reply's id", async ({ request }) => {
  const byRoot = await (await request.get("/api/agent/bugs/agthread1", { headers: auth })).json();
  expect(byRoot.thread.id).toBe("agthread1");
  const byReply = await (await request.get("/api/agent/bugs/agreply01", { headers: auth })).json();
  expect(byReply.thread.id).toBe("agthread1");
  // threads in other projects look exactly like missing ones
  expect((await request.get("/api/agent/bugs/agthread3", { headers: auth })).status()).toBe(404);
  expect((await request.get("/api/agent/bugs/nosuchid", { headers: auth })).status()).toBe(404);
});
