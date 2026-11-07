# The agent API

Read-only, token-protected access to one project's feedback threads, so a
coding agent or script can read bug reports with full context (page, element,
viewports, screenshots, recordings, replies). Off unless configured; it cannot
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
bash scripts/bugs.sh <thread id>  # one thread; a reply's id works too
```

| Endpoint | |
|---|---|
| `GET /api/agent/bugs?status=open\|resolved\|all&review=<id>` | `{ project, count, threads[] }`, oldest first |
| `GET /api/agent/bugs/:id` | `{ thread }` |

Send `Authorization: Bearer <token>`. 401 = bad token; 404 = API off, or not in the project.
Each thread has its text, status, kind (`comment` / `figma-diff`), page, element
label and selector, viewport band, pin position and region, Figma details,
attachment URLs and replies — see `AgentThread` in `src/lib/agent.ts`.
