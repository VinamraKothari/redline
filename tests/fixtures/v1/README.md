# Stripe mock

Static answers for the Stripe SDK when the app runs with
`STRIPE_API_BASE=http://localhost:<fixture port>` (tests only, never on
Vercel). `tests/billing.spec.ts` posts signed webhook events whose
subscriptions the server then re-fetches from here: one active Team
subscription, one cancelled, one past due. Period ends are far in the future.

Every mock subscription belongs to the same customer, `cus_billingtest`, and
the app maps a customer to one account. So only the fixed "Wendy Webhook"
test user may receive checkout events — a second account would steal the
customer and the next event would land on the wrong row.
