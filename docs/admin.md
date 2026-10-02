# The admin area

Open **Account menu → Admin** (or go to `/admin`). It is the back office for
whoever runs Redline: see everyone who signed in, which plan each person gets
and why, give plans away, make codes, manage Stripe discounts, and look back
at what changed. Only admins can open it; everybody else gets a short "Not for
you".

## How do I…

**…see what plan someone is on?** *Users*, type a name or e-mail in the search
box. The *Plan* column shows the plan they actually get, with a small label
saying why (see "The labels" below). Click the row for the whole picture.

**…give someone Pro or Team for free?** Open the user, press *Change plan*,
pick the plan, pick how long (1, 3, 6, 12 months or no end date), write a
short note saying why (it goes in the audit log), press *Grant*. The plan is
live at once; nothing is charged. If the person already has a grant running,
the dialog says so and offers to **extend** it (the months are added to the
current end date) — or to replace it, starting today.

**…take a grant away?** *Change plan → Free → Remove grant*. Only grants and
codes can be removed here. A plan the person *pays* for through Stripe shows
"Managed by Stripe" with a link to the customer in the Stripe dashboard —
change or cancel it there and it comes back here on its own.

**…make a code to hand out?** *Codes → New code*. Choose Pro or Team, how
many months it grants, how many *different* people may use it, an optional
last day, and a note about who it's for. Leave the code blank to get one like
`PRO-7K3M-QZ`, or type your own (six or more letters or digits; spaces are
dropped). The person enters it on their account page. Each person can use a
code once; switch a code off any time with the toggle, which leaves the people
who already used it untouched.

**…give a discount on a paid plan?** *Codes → Coupons → New coupon* (needs
Stripe to be connected). A coupon is a percentage or an amount off, on the
first payment, for some months, or forever; the customer types the code
(`LAUNCH20`) into the Stripe checkout and still pays the rest. This is
different from a code above, which gives the plan away.

**…add another admin?** Open the user and press *Make admin*. *Remove admin*
takes it back — never your own, never the last admin's. Admins listed in the
`REDLINE_ADMIN_EMAILS` setting (the owner, by default) are always admins and
can only be changed in that setting.

**…see what changed?** *Audit log*: every grant, extension, revoke, code,
coupon and admin change, with who did it, to whom and when. Redemptions by
users are listed too. Each user's page shows the entries about them.

## The labels

| Label | Plan | What it means |
|---|---|---|
| **Admin** | Team | The person is an admin. Admins always have everything. |
| **Complimentary** | Team | The person is a member of a project an admin owns. Anyone working with an admin gets Team for free, automatically, for as long as they share a project. |
| **Stripe** | Pro or Team | They pay for it. Managed in Stripe. |
| **Manual** | Pro or Team | An admin granted it, for a while or with no end date. |
| **Code** | Pro or Team | They redeemed a code, for the code's number of months. |
| *(none)* | Free | No paid plan. |

When more than one applies, the first in the table wins: an admin who also
pays shows as Admin. Limits are judged against the **project owner's** plan,
so a project owned by an admin is Team for everyone in it, and a
complimentary person's own projects are Team too.

## Three things that look alike

- **A manual grant** gives one person a plan. Done by an admin, on the user's
  page.
- **A redeemable code** gives a plan to whoever types it, up to N people. Made
  by an admin on the Codes page, redeemed by the user on their account page.
  No money involved either way.
- **A Stripe coupon** is a *discount* on a plan someone pays for. Made here,
  typed into Stripe's checkout, charged by Stripe.

---

## For developers

- **Who is admin** — `src/lib/admin/auth.ts`: an e-mail in `REDLINE_ADMIN_EMAILS`
  (comma-separated; defaults to the owner's address so the owner is admin on
  a fresh database and before migration 006 has run) or a row in `admins`.
  `requireAdmin()` guards every `/api/admin/*` route; the first time a listed
  admin opens `/admin` their `admins` row is written, which is what the
  `admin_collaborators` view (complimentary Team) is computed from. `/api/me`
  returns `is_admin` for the account menu.
- **Entitlements** — `effectivePlan(userId)` in `src/lib/billing/entitlements.ts`
  decides in the order of the table above: admin → collaborator → a Stripe
  subscription in good standing (active, trialing, past_due) → a manual grant
  or code while `expires_at` is empty or ahead → Free. `planForUser` /
  `planForProject` wrap it so every `assertCan…` gate uses it.
  `GET /api/billing/status` reports `plan`, `source` and `until`.
- **Grants and codes** — `src/lib/admin/grants.ts`. A grant is a
  `subscriptions` row with `source = 'manual'` (or `'code'`), `granted_by`,
  `note`, `expires_at`; the Stripe customer id is always kept so a later
  checkout reuses the customer (a revoke on such a row writes a plain Free row
  instead of deleting it). A row with a `stripe_subscription_id` in an
  entitled status is Stripe's and is never written from here (409 with
  `stripe_url`). Redeeming (`POST /api/billing/redeem { code }`) checks
  everything first, then the adapter counts the use **atomically**:
  on Supabase through `redeem_grant_code()` (migration 007; before it has
  run, a compare-and-set fallback), locally under the file lock — so a code
  with one use left goes to exactly one of several simultaneous redeemers.
  Ten refused attempts an hour per account give a 429.
- **Stripe coupons** — `src/lib/admin/stripe-promos.ts` creates a coupon plus
  a promotion code; checkout already has `allow_promotion_codes`. Needs
  `STRIPE_SECRET_KEY`; the test-mode fake answers with an empty list.
- **Audit** — `audit_log` rows: `plan.grant`, `plan.extend`, `plan.revoke`,
  `code.create/enable/disable/redeem`, `admin.grant/revoke`,
  `promo.create/enable/disable`.
- **Pages / API** — `/admin` (`GET /api/admin/stats`), `/admin/users`
  (`GET /api/admin/users?query=&offset=&limit=`), `/admin/users/[id]`
  (`GET /api/admin/users/[id]`, `POST …/plan { plan, months, note, mode }`,
  `POST …/admin { admin }`), `/admin/codes` (`GET/POST /api/admin/codes`,
  `POST /api/admin/codes/[code] { active }`, `GET/POST /api/admin/stripe/coupons`,
  `POST …/coupons/[id] { active }`), `/admin/audit` (`GET /api/admin/audit?target=&limit=`).
  Components in `src/components/admin/`, server reads in `src/lib/admin/queries.ts`.
- **Database** — `supabase/migration-006-admin.sql` (tables, view, columns)
  and `supabase/migration-007-grant-codes-atomic.sql` (the redemption
  function). Run both once, in order.
- **Environment** — `REDLINE_ADMIN_EMAILS` (optional), `STRIPE_SECRET_KEY`
  (coupons only).
- **e2e** — with `REDLINE_TEST_AUTH=1`, a test user whose *name* contains
  "Admin" is made an admin by `/api/auth/test`. `tests/admin.spec.ts` covers
  access, grants/extend/revoke through the UI, codes, concurrency and
  throttling, complimentary Team, and the audit log.
