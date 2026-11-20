# Reviewing pages behind a login (site sessions)

A page that only appears after signing in — an account overview, a checkout,
an admin screen — can be reviewed like any other: open it, switch to **Browse
the page** (V), sign in on the page itself, and the frame moves on to the page
behind the login. Redline keeps that login for your account, so reloading the
review, opening another page of the same site or coming back tomorrow does
not ask again. The top bar shows **Signed in to <site>** while it does.

## How it works

Reviewed pages load through Redline's proxy (`/api/proxy`), which previously
forwarded no cookies and dropped every cookie a site set. It now keeps a
**cookie jar per (Redline account, site)**:

- Every `Set-Cookie` a site answers with — on any hop, including the `302`
  a login returns — goes into the jar. Redirects are followed by hand for
  that reason (`fetch`'s own follow mode discards them). Cookies set while
  answering a successful `POST`/`PUT` are marked as a login; that is what
  **Signed in to <site>** reports.
- Every request to the site carries the matching jar cookies as its `Cookie`
  header, following RFC 6265: host-only cookies for the exact host, domain
  cookies for the host and its subdomains, path prefixes, `Secure` only over
  https, expired cookies dropped. Cookies the page set itself with
  `document.cookie` are forwarded too (they arrive with the request); Redline's
  own cookies (`sb-*`, `redline_*`) never are.
- Writes (`POST`, `PUT`, …) carry `Origin` and `Referer` of the site, which
  is what CSRF checks and Next.js Server Actions compare against `Host`. The
  hop-by-hop `x-forwarded-*`, `x-real-ip` and `x-vercel-*` headers of the
  incoming request never go upstream (they name Redline's host and your IP,
  and a self-hosted Next.js would reject the Server Action).
- A request that reached `/api/proxy` from another site (`Sec-Fetch-Site:
  cross-site`, i.e. a link someone planted) is refused — it would ride on your
  Redline session and your jar. The frame, the bridge and the app itself are
  always same-origin.
- Anything fetched with cookies is answered `private, no-store`: a static
  asset served to one account's session is never cached at the edge for the
  next.
- Nothing a site sets ever reaches your browser: on Redline's origin it would
  be shared between every site anyone reviews.

When the site answers the reviewed page with its sign-in form (a redirect to
`/login`), the workspace says so — "The site sent you to its sign-in page.
Switch to Browse (V) and sign in" — with a Browse button, so the first click on
the password field doesn't drop a comment pin. The banner goes once the page
behind the login has landed.

The browser side (`public/bridge.js`, injected into every proxied page) was
changed so logins get through at all:

- Forms are observed in the bubble phase, after the page's own handler. A
  React/Vue form that calls `preventDefault()` and posts with `fetch()` is left
  alone (the proxy carries the request). A classic `<form method="post">` is
  submitted by the browser to the proxy, which follows the redirect and
  answers with the next page — also when a script calls `form.submit()`,
  which fires no submit event (the bridge wraps it). Before, every form was
  turned into a GET with its fields in the query string — including the
  password — or blocked.
- After a script-driven login, sites do `window.location.href = "https://site/account"`
  with their real, absolute URL. The bridge intercepts that with the
  Navigation API and asks the host to load it through the proxy, so the frame
  stays inside Redline and lands on the page behind the login. A browser
  without the Navigation API lets the frame leave; the host notices (the
  document becomes unreachable) and reloads the review with a note.

## What is stored, where, for whom

| | |
| --- | --- |
| What | the cookies the site set: name, value, domain, path, expiry, flags. Nothing else — no passwords, no form fields. |
| Keyed by | your Redline account **and** the site. A "site" is the registrable domain (`shop.example.com` and `www.example.com` share one jar: `example.com`; `example.co.uk` style domains count as one site too). On hosting platforms where every subdomain is somebody else's site (`vercel.app`, `netlify.app`, `github.io`, `pages.dev`, `herokuapp.com`, `web.app`, `firebaseapp.com`, `azurewebsites.net`, `cloudfront.net`, `amazonaws.com`) the full host is the site. |
| Where | `public.site_sessions` on Supabase (`supabase/migration-009-site-sessions.sql`: `user_id`, `site`, `cookies jsonb`, `updated_at`; RLS on, no policies — API only). The local JSON store keeps a `siteSessions` map. |
| Who sees it | only you. Teammates reviewing the same page sign in themselves; a shared review never shares a session. Deleting your account deletes your jars. |
| Limits | 150 cookies per site, 4 KB per cookie value. Expired cookies disappear on their own. |

Until migration 009 has run, reviews still load — signed out. The first
write logs one warning naming the migration.

### Encryption at rest

Set `REDLINE_SITE_SESSION_KEY` (any string of 32+ characters) in the hosting
environment and the cookie array is stored sealed: AES-256-GCM with a key
derived as `sha256(REDLINE_SITE_SESSION_KEY)`, a random 12-byte IV per write,
stored as `{ "enc": "<base64 iv‖ciphertext‖tag>" }`. Without the variable the
array is stored as plain JSON. A jar sealed under one key opens as empty under
another (or none): the review loads signed out, nothing fails. Rotating the key
therefore signs everyone out of every site once.

## "Forget login"

The **Signed in to <site>** pill in the top bar opens a menu with **Forget
login**: it deletes your jar for that site (`DELETE /api/proxy/session?url=…`)
and reloads the page, which now arrives signed out. The site's own session is
untouched — only Redline's copy of the cookies is gone.

When the jar holds cookies that no login set (a site that starts its session
on the first page load, consent or CSRF cookies — nearly every site), nothing
is announced in the top bar; the page menu (click the review title) ends with
**Forget session on <site>**, so what Redline keeps can always be dropped. The
pill is hidden on narrow screens, like the host link next to it.

## Previews

The project card's preview of a page behind a login is rendered with your
session on the site (the thumbnail route passes your jar to the capture
browser). When the site answers with its sign-in form instead of the page,
no preview is stored — the card keeps "Preview appears after the first visit"
until a real one can be taken.

## API

| Route | What |
| --- | --- |
| `GET /api/proxy/session?url=<page>` | `{ site, signedIn, kept, updated_at }` — `signedIn` is true when the jar for that site holds a live cookie that a *successful write* set (a login form or API call, including the redirects after it); cookies that plain GETs set — CSRF tokens, consent, analytics — don't count, so the pill doesn't claim a login on every site that sets a cookie. `kept` is true when the jar holds anything at all. Never returns cookie names or values. |
| `DELETE /api/proxy/session?url=<page>` | forgets the jar for that site |

Both require a signed-in Redline user and act on that user's jars only.

## Limits

- **OAuth / "Sign in with Google" inside the frame is not supported.** Those
  providers refuse to run in an iframe and redirect through origins the jar
  does not follow. Use a password login, or a test account on the site.
- Sites that pin their session to the browser (fingerprinting, `SameSite`
  checks against the original origin, bot protection) may still refuse.
  Upload the page as an HTML file in that case.
- A review frozen with ⇧F captures the signed-in page as everyone sees it from
  then on — freeze deliberately.
