# The agent API

Read-only, token-protected access to one project's feedback threads and copy
edits, so a coding agent or script can read bug reports with full context
(page, element, viewports, screenshots, recordings, replies) and the exact
copy changes to make. Off unless configured; it cannot
change anything and sees one project only.

## Setup

On the deployment (then redeploy):

| Variable | Value |
|---|---|
| `REDLINE_AGENT_TOKEN` | random secret, 32+ characters (`openssl rand -hex 32`) |
| `REDLINE_AGENT_PROJECT` | id of the project to expose (from its URL, `/p/<id>`) |

On the calling machine, in `.env.local` (git-ignored): `REDLINE_AGENT_URL` and the same `REDLINE_AGENT_TOKEN`.

## Use

```bash
bash scripts/bugs.sh              # open threads (also: all, resolved)
bash scripts/bugs.sh <thread id>  # one thread (a reply's id works too) or one copy edit
```

| Endpoint | |
|---|---|
| `GET /api/agent/bugs?status=open\|resolved\|all&review=<id>` | `{ project, count, threads[] }`, oldest first |
| `GET /api/agent/bugs/:id` | `{ thread }` — a thread, a reply's thread, or a copy edit |

Send `Authorization: Bearer <token>`. 401 = bad token; 404 = API off, or not in the project.
Each thread has its text, status, kind (`comment` / `figma-diff` / `copy`),
page, element label and selector, viewport band, pin position and region,
Figma details, attachment URLs and replies — see `AgentThread` in
`src/lib/agent.ts`.

**Copy edits** (made with the Text tool, see [text-edits.md](text-edits.md))
come in the same list, in the same shape, with `kind: "copy"`: `title` is
`Copy change: <label>`, `body` says what to change, `element` holds the
label and selector, `status` is `resolved` once someone marked the edit done,
and `copy` carries the details — every other item has `copy: null`:

```json
"copy": {
  "label": "the heading “Login”",
  "selector": "main h1",
  "status": "open",
  "before": { "html": "Log in to view your orders", "markdown": "Log in to view your orders", "text": "Log in to view your orders" },
  "after":  { "html": "<strong>Sign in</strong> to view your orders", "markdown": "**Sign in** to view your orders", "text": "Sign in to view your orders" },
  "note": null
}
```

`html` is sanitized inline HTML (text, `<br>`, `<strong>`, `<em>`, `<u>`,
`<a href>`, `<span class>`, and the site's `class` on those); `text` is normalized (whitespace collapsed) — what to search the
codebase for. Only consumers that switch on `kind` need to know the new value;
the fields they already read are filled as before.
