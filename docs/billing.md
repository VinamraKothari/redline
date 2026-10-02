# Monetising Redline

Redline is free to run (Vercel hobby, Supabase free tier, Stripe pay-per-transaction),
so the plan is to charge for the things that only matter once someone uses it
seriously — not for trying it. This document is the plan, the reasoning behind the
limits, and the exact steps to switch payments on.

## Positioning

Redline sits between "screenshot + Slack thread" and heavyweight review suites.
Its buyers are designers and front-end developers who review live pages every
week, and agencies/product teams who do it with clients. The paid features are
the ones those people reach for once a review is real work: unlimited pages and
projects, more collaborators, screen recordings, frozen states, PNG hand-offs
and unlimited Figma comparisons. Everything needed to *evaluate* the tool — a
project, a few pages, comments, drawing, inspection, a Jira export — stays free
forever, because a Free reviewer inviting a colleague is the acquisition channel.

## The plans (`src/lib/billing/plans.ts` is the source of truth)

| | Free | Pro — €15/mo (€12.50 yearly) | Team — €49/mo (€40.83 yearly) |
|---|---|---|---|
| Projects owned | 1 | unlimited | unlimited |
| Pages per project | 3 | unlimited | unlimited |
| People per project | 2 | 5 | unlimited |
| Figma comparisons | 2 / month | unlimited | unlimited |
| Screen recordings | – | ✓ | ✓ |
| Frozen versions | – | ✓ | ✓ |
| PNG export | – | ✓ | ✓ |
| Jira CSV export | ✓ | ✓ | ✓ |

Yearly billing is ten months for the price of twelve. Prices are in euro; Stripe
Checkout collects VAT-relevant billing details, and Stripe Tax can be switched
on later (`STRIPE_AUTOMATIC_TAX=1`) once the account has it.

Why these limits:

- **1 project / 3 pages** is enough to review one real site end to end and see
  the value, but a second client or a redesign with a dozen pages is clearly
  professional use.
- **2 people** lets a Free user pull in one colleague — the invite is the growth
  loop — while a review with a client *and* a developer needs Pro.
- **2 Figma comparisons a month** shows off the flagship feature without letting
  it become the free tier's main use; it is also the only feature with a real
  per-run cost (Figma API + server time).
- **Recordings, frozen versions, PNG exports** are hand-off features: used when
  feedback goes to someone else to act on, i.e. by teams with budget.
- **Team** is priced for agencies: unlimited seats per project so a client
  review can include everybody, plus invoices with company details.

Limits are judged against the **project owner's** plan. One Pro seat covers the
whole project's members; they never need to pay to participate.

## How it works in the code

- `src/lib/billing/plans.ts` — plans, prices, limits, Stripe lookup keys.
- `src/lib/billing/entitlements.ts` — `planForUser`, `planForProject` and the
  `assertCan…` gates; a limit throws a `PaywallError` (HTTP 402 with
  `{ upgrade: true, plan, feature }`).
- `src/lib/api.ts` turns every 402 into a `redline:paywall` event;
  `src/components/billing/UpgradeDialog.tsx` (mounted in the root layout)
  opens with the message and the plan picker.
- `src/lib/billing/stripe.ts` — Checkout, Customer Portal, price creation
  from lookup keys, and `syncFromStripeSubscription`, which mirrors a Stripe
  subscription into the `subscriptions` table. `/api/billing/webhook` feeds it.
- `/account/billing` — current plan, usage, plan picker, "Manage billing".
- `src/lib/billing/fake.ts` — test-mode stand-in (`REDLINE_BILLING_FAKE=1`,
  never on Vercel): checkout is a local redirect that marks the account paid,
  and test sign-in (`/api/auth/test`) grants new accounts a plan —
  `REDLINE_BILLING_FAKE_PLAN`, default `team` — so the pre-billing e2e suite
  isn't gated; `tests/billing.spec.ts` puts its users on Free explicitly.
  `STRIPE_API_BASE` (tests only) points the SDK at the static mock in
  `tests/fixtures/v1` so signed webhook events can be exercised.
- Webhook events are never applied from their payload: the subscription is
  re-fetched from Stripe and the event's timestamp is kept in `updated_at`,
  so out-of-order deliveries can't bring back a cancelled plan.

Without `STRIPE_SECRET_KEY` the app runs with everyone on Free and the billing
page says payments aren't set up.

## Setting payments up (owner steps)

1. **Create the Stripe account** at https://dashboard.stripe.com/register
   (business details can be completed later; test mode works right away).
2. **Get the test secret key**: Developers → API keys → *Secret key*
   (`sk_test_…`). Keep it in test mode for now.
3. **Create the webhook endpoint**: Developers → Webhooks → *Add endpoint*
   - URL: `https://redline-wheat.vercel.app/api/billing/webhook`
   - API version: leave it on the **latest** (the code reads the current shape
     and falls back for the older `invoice.subscription` field, but don't pin
     it to something old on purpose)
   - Events: `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`,
     `invoice.payment_failed`
   - Copy the *Signing secret* (`whsec_…`).
4. **Customer portal**: Settings → Billing → Customer portal. Turn on
   "Update subscription" (switch plans) and add both products once they exist
   (they are created automatically the first time someone opens checkout — or
   run one test checkout first), plus "Cancel subscription" and invoice history.
   If you make a dedicated configuration, put its id in
   `STRIPE_PORTAL_CONFIGURATION`; otherwise the default one is used.
5. **Run the migration** `supabase/migration-005-settings-billing.sql` in the
   Supabase SQL editor (tables `user_settings`, `subscriptions`, `figma_runs`).
   Do this before the redeploy, or the first webhook has no table to write to.
6. **Vercel → Project → Settings → Environment variables** (Production, and
   Preview if you like):
   - `STRIPE_SECRET_KEY` = `sk_test_…`
   - `STRIPE_WEBHOOK_SECRET` = `whsec_…`
   - optional `STRIPE_PORTAL_CONFIGURATION` = `bpc_…`
   - optional `STRIPE_AUTOMATIC_TAX=1` once Stripe Tax is enabled
   - optional `APP_URL` = `https://redline-wheat.vercel.app` (otherwise the
     request origin is used for the return URLs)
   Then **redeploy**.
7. **Test**: sign in, open `/account/billing`, choose Pro, pay with card
   `4242 4242 4242 4242`, any future expiry, any CVC. You land back on the
   billing page as Pro within a couple of seconds (the webhook writes the row).
   Check Developers → Webhooks → the endpoint shows a 200 for each event.
   Try "Manage billing" → cancel → the page shows "cancels at period end".
8. **Go live**: complete the Stripe account activation, repeat steps 2–3 in
   live mode (live keys and a live webhook endpoint), swap the two Vercel
   variables, redeploy. Products and prices are created again automatically in
   live mode on the first checkout.

### Changing a price later

Stripe prices are immutable. To change what a plan costs: change the amount
*and* the lookup key in `plans.ts` (say `redline_pro_month` →
`redline_pro_month_v2`), deploy, and archive the old price in the Dashboard.
The next checkout creates the new price under the same product
(`transfer_lookup_key` is set, so re-using a key would move it, but a new key
keeps the old subscriptions readable). Existing subscribers stay on their old
price until you migrate them from the Dashboard.

## Granting a plan by hand (friends, testers, refunds)

Insert or update a row in `subscriptions`; the app trusts `status` and `plan`:

```sql
insert into public.subscriptions (user_id, plan, status)
values ('<auth user uuid>', 'pro', 'active')
on conflict (user_id) do update set plan = excluded.plan, status = excluded.status, updated_at = now();
```

Find the uuid in Supabase → Authentication → Users. To take a plan away, set
`status = 'canceled'`. The webhook only writes rows for subscriptions that went
through the app's checkout, so a manual grant stays until you change it (or the
person subscribes for real, which then takes over the row).

## What to measure

- Free → Pro conversion, and *which* limit triggered the upgrade dialog
  (`feature` in the 402 — log it, or count paywall events client-side).
- Pages per project and members per project at the moment of hitting a limit
  (are the Free limits too tight or too loose?).
- Figma comparisons per account per month, and how many accounts hit 2.
- Monthly vs yearly take-up; churn at the first renewal.
- Share of paid accounts that invited more than 5 people (Team demand).

## Later ideas

- **Seat-based Team pricing** (a base fee plus per-editor) once Team accounts
  are large enough that a flat €49 leaves money on the table.
- **Annual invoices / SEPA and bank transfer** for agencies that can't pay by
  card — Stripe supports both with a Checkout setting.
- **Usage-based Figma runs** as an add-on for Free/Pro (Stripe metered
  billing), rather than a hard cap.
- **Agency plan** with white-label review links and client-facing read-only
  reports.
- **Free for education and open source** — a manual grant (above) and a form.
- **Trials**: Stripe Checkout supports `trial_period_days`; a 14-day Pro trial
  without a card is a one-line change in `createCheckoutSession`.

## Plans that don't come from Stripe

Not every paid plan is paid for. `effectivePlan` (`src/lib/billing/entitlements.ts`)
puts admins and everyone who shares a project with an admin on Team, honours an
admin's manual grants and redeemed codes while they last, and only then reads
the Stripe subscription. `GET /api/billing/status` reports the `source`
(`admin`, `collaborator`, `stripe`, `manual`, `code`, `free`) and `until`.
Grants, codes, Stripe coupons and the admin area that manages them are
described in [`docs/admin.md`](./admin.md).

## Account self-service (`/account`)

Besides `/account/billing`, every account has a hub at `/account`: profile
(name and pin colour are editable — `PATCH /api/me`; e-mail and picture stay
Google's — and once a name is set here, `syncProfile` keeps it: a later rename
in the Google account no longer overrides it), the plan in one line with its source (Stripe / manual grant / code /
admin / collaborator) and a box to redeem a code, usage, the projects the
account owns or belongs to (members can leave — `DELETE
/api/projects/[id]/members/me`; owners delete from the project page), and
"Delete my account" (`DELETE /api/me`: cancels a Stripe subscription at once
via `cancelSubscriptionNow` — which first blanks the subscription's `user_id`
metadata, and `syncFromStripeSubscription` ignores events for a user without a
profile, so the cancellation's own webhooks can't fail on the deleted row —
then `deleteAccount` on the adapter, then clears the session cookies; the
landing page shows a notice at `/?deleted=1`).

Cards, invoices, cancellation and VAT numbers are all handled in the Stripe
customer portal ("Manage billing"); the billing page says so and lists those
four so people know what is behind the button. Receipts are Stripe's job too:

9. **Customer e-mails** (Settings → Business → Customer emails): switch on
   *Successful payments* (receipts) and *Failed payments* so people hear from
   Stripe when a card is charged or declined — Redline sends no e-mail of its
   own. In the same place, enable the *Invoices* e-mails if your Team
   customers expect a PDF invoice per period rather than fetching it from the
   portal.
