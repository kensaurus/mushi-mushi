# Local Stripe sandbox testing

End-to-end guide for testing the paid-plan flow against a local admin without touching live Stripe or real money. Covers checkout → subscription → quota → payment failure → dunning recovery → Sentry alerts.

## Prerequisites

1. [Stripe CLI](https://stripe.com/docs/stripe-cli) installed (`brew install stripe/stripe-cli/stripe` or via binary release).
2. A Stripe **test-mode** account — the [test dashboard](https://dashboard.stripe.com/test/apikeys) is your friend. Never run this against live keys.
3. The Supabase Edge Functions running locally (`pnpm -F @mushi-mushi/server supabase:functions:serve` or equivalent).
4. The admin dev server running (`pnpm -F @mushi-mushi/admin dev`).
5. `.env` populated with the STRIPE_* values from `.env.example` — bootstrap with:

   ```bash
   STRIPE_SECRET_KEY=sk_test_… node scripts/stripe-bootstrap.mjs
   ```

   This creates the meters, products, and prices in your test-mode Stripe account and writes the IDs back to your env.

## 1 · Authenticate the CLI

```bash
stripe login
```

This opens a browser to authorize the CLI against your test-mode account. It writes a session key to `~/.config/stripe/config.toml`.

## 2 · Forward webhooks to your local Edge Function

```bash
stripe listen \
  --forward-to http://localhost:54321/functions/v1/stripe-webhooks \
  --events customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,customer.subscription.paused,customer.subscription.resumed,customer.updated,invoice.payment_failed,invoice.payment_succeeded,checkout.session.completed,checkout.session.async_payment_failed
```

The CLI prints a signing secret — `whsec_…` — copy it into `STRIPE_WEBHOOK_SECRET` in your `.env` and restart the Edge Functions. Each forwarded event runs through the real `stripe-webhooks/index.ts` handler, hits your local Postgres, and surfaces in Sentry if `SENTRY_DSN_SERVER` is configured.

Leave `stripe listen` running in its own terminal for the rest of this guide.

## 3 · Happy path — subscribe, provision, ingest

1. In the admin, sign in and create a project. Grab its API key from `/onboarding`.
2. Navigate to `/billing` and click **Upgrade to Starter**. The admin POSTs to `/v1/admin/stripe/checkout`, which returns a hosted Stripe URL; you'll be redirected to `checkout.stripe.com`.
3. Fill the form with test data:

   | Field | Value |
   |-------|-------|
   | Card | `4242 4242 4242 4242` |
   | Expiry | any future `MM/YY` |
   | CVC | any 3 digits |
   | ZIP | any 5 digits |

4. On submit, Stripe fires `checkout.session.completed` → forwarded to your webhook → handler flips `billing_subscriptions.status = 'active'` and writes `billing_customers`.
5. The admin redirects to `STRIPE_SUCCESS_URL` (`/billing?success=1`). Refresh `/billing` and confirm the plan badge now reads **Starter** with a green `active` status.
6. Send a test report with your SDK key. It should ingest with HTTP 200. Watch `processing_queue` drain through fast-filter → classify-report → `classified`.

## 4 · Payment failure → Sentry alert

Trigger a failure mid-subscription using the `4000 0000 0000 0341` card (which initially succeeds, then fails on the next invoice). The fast path is to replay a signed event directly:

```bash
stripe trigger invoice.payment_failed
```

Expected:

- Admin `/billing` shows status = `past_due`.
- `QuotaBanner` flips to delinquent mode.
- Slack/Discord operator channel (if `OPERATOR_SLACK_WEBHOOK_URL` is set) fires a **Payment failed** card.
- Sentry gets a `warning`-level event titled `stripe.invoice.payment_failed` (or `error` once `attempt >= 3`). Tags: `event`, `attempt`.

## 5 · Dunning recovery

```bash
stripe trigger invoice.payment_succeeded
```

Expected:

- `billing_subscriptions.status` flips `past_due` → `active`.
- Operator channel pings with the **Payment recovered** card.
- Quota gate re-opens on the next request (or call `POST /v1/admin/stripe/invalidate-quota-cache` to force).

## 6 · Cancellation path

```bash
stripe trigger customer.subscription.deleted
```

Expected:

- `billing_subscriptions.status = 'canceled'`.
- Admin `/billing` shows **Free plan** with a "Subscription ended" chip.
- Sentry captures a `warning` event `stripe.subscription.deleted` — use this as a churn dashboard signal.

## 7 · Quota 402 gate

Send more reports than the plan allows (Starter = 10,000/mo by default). The next ingest POST returns **HTTP 402** with body:

```json
{ "error": { "code": "QUOTA_EXCEEDED", "message": "Monthly report quota exceeded", "meta": { "reset_at": "…" } } }
```

The `QuotaBanner` picks this up from the next `/v1/admin/setup` poll and surfaces a **Upgrade** CTA. Clicking it re-enters step 3 with the Pro plan.

## 8 · Async payment failure (ACH/SEPA)

For bank-payment methods you can test the post-checkout failure with:

```bash
stripe trigger checkout.session.async_payment_failed
```

Expected: Sentry `error` event `stripe.checkout.async_payment_failed` so the operator can reach out before the customer notices.

## 9 · Clean up

After you're done, stop the CLI (`Ctrl+C`) and optionally purge test-mode state:

```bash
stripe customers list --limit 100 | jq -r '.data[].id' | xargs -I {} stripe customers delete {}
```

Or just leave it — test-mode objects don't affect billing and make it faster to re-run the flow.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `stripe listen` says `resource_missing: No such endpoint` | You forwarded to the wrong port. Check `supabase functions serve` is on 54321. |
| Webhook returns 401 | The `STRIPE_WEBHOOK_SECRET` in `.env` doesn't match the `whsec_…` CLI printed this session. Restart the edge function after you paste a new one. |
| Subscription stays `incomplete` forever | Your `STRIPE_PRICE_*` IDs in `.env` don't match what `stripe-bootstrap.mjs` provisioned. Re-run the bootstrap and re-deploy edge functions. |
| No Sentry event on `invoice.payment_failed` | Confirm `SENTRY_DSN_SERVER` is set *for the Edge Function runtime* (`supabase secrets list`), not just locally. The `ensureSentry()` helper no-ops silently if the DSN is missing. |

## Cross-references

- Handler: `packages/server/supabase/functions/stripe-webhooks/index.ts`
- Quota middleware: `packages/server/supabase/functions/_shared/quota.ts`
- Sentry wiring: `packages/server/supabase/functions/_shared/sentry.ts`
- Webhook canonical payload tests: `packages/server/src/__tests__/stripe-webhooks.test.ts`
