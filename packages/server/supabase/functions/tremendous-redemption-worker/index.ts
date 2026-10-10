// ============================================================
// tremendous-redemption-worker — Mushi Bounties gift-card cron.
//
// Runs every minute via pg_cron. For each `tremendous_orders` row
// with status='pending':
//   1. Calls Tremendous POST /v2/orders to create the order.
//   2. Updates tremendous_orders with status='processing' + external_id.
//   3. Marks the linked tester_redemptions row as 'processing'.
//
// Completed/failed orders are resolved by the Tremendous webhook
// receiver at POST /v1/webhooks/tremendous in the main API.
//
// A failed POST is retried with backoff; a non-retryable 4xx, or the 10th
// failure, gives up: the order goes 'failed' and the redemption 'withheld'
// for ops, with no automatic refund (_shared/tremendous-retry.ts).
//
// Idempotent: each order row has a UNIQUE external_id (set on first
// Tremendous success) so double-runs are safe.
//
// Schedule: every minute → * * * * *
// Auth: requireServiceRoleAuth (only pg_cron may call this)
// ============================================================

import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { minimalTremendousPayload, scrubEmails } from '../_shared/tremendous-payload.ts'
import { attemptsSoFar, isRetryDue, onTremendousFailure } from '../_shared/tremendous-retry.ts'

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void
  env: { get(name: string): string | undefined }
}

const wlog = log.child('tremendous-redemption-worker')
const BATCH_SIZE = 50

interface PendingOrder {
  id: string
  tester_id: string
  redemption_id: string
  amount_usd: number
  sku: string
  external_id: string | null
  raw_payload: unknown
  last_synced_at: string | null
  mushi_testers: {
    auth_user_id: string
    display_name: string | null
  } | null
}

interface TremendousOrderPayload {
  external_id: string
  payment: { funding_source_id: string }
  rewards: Array<{
    value: { denomination: number; currency_code: string }
    delivery: { method: 'EMAIL'; email: string }
    products: [string]
  }>
}

async function callTremendous(
  baseUrl: string,
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<{ ok: boolean; data?: unknown; error?: string; status: number | null }> {
  const apiKey = Deno.env.get('TREMENDOUS_API_KEY')
  // Not a Tremendous answer: retryable once the operator sets the key.
  if (!apiKey) return { ok: false, error: 'TREMENDOUS_API_KEY not set', status: null }

  const url = `${baseUrl}${path}`

  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) {
    return { ok: false, error: `Tremendous network error: ${String(err)}`, status: null }
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    return { ok: false, error: `Tremendous ${res.status}: ${errText}`, status: res.status }
  }

  const data = await res.json().catch(() => null)
  return { ok: true, data, status: res.status }
}

async function resolveTesterEmail(
  db: ReturnType<typeof getServiceClient>,
  authUserId: string,
): Promise<string | null> {
  // Fetch user email from auth admin API via service role.
  const { data } = await db.auth.admin.getUserById(authUserId)
  return data?.user?.email ?? null
}

Deno.serve(
  withSentry(async (req: Request) => {
    const authError = requireServiceRoleAuth(req)
    if (authError) return authError

    const db = getServiceClient()

    // Pull the configured funding source.
    const { data: runtimeCfg } = await db
      .from('mushi_runtime_config')
      .select('value')
      .eq('key', 'tremendous_funding_source_id')
      .single()

    const fundingSourceId = (runtimeCfg?.value as string | null) ?? ''
    const SENTINEL_FUNDING_SOURCE = 'REPLACE_WITH_YOUR_TREMENDOUS_FUNDING_SOURCE_ID'
    // Tremendous funding source IDs look like `FUND_xxx` or a UUID — reject
    // the seed sentinel explicitly so an un-configured install fails fast
    // with 503 instead of silently calling Tremendous with garbage.
    if (!fundingSourceId || fundingSourceId === SENTINEL_FUNDING_SOURCE) {
      wlog.error('tremendous_funding_source_id is not configured', {
        is_sentinel: fundingSourceId === SENTINEL_FUNDING_SOURCE,
      })
      return new Response(JSON.stringify({ error: 'funding_source_not_configured' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // No default host. Defaulting to the sandbox would accept real
    // redemptions and never pay them; defaulting to production would spend
    // real money from a test deploy. The operator sets it explicitly:
    // https://testflight.tremendous.com/api/v2 or https://www.tremendous.com/api/v2.
    const tremendousApiUrl = Deno.env.get('TREMENDOUS_API_URL')
    if (!tremendousApiUrl) {
      wlog.error('TREMENDOUS_API_URL is not set')
      return new Response(JSON.stringify({ error: 'tremendous_api_url_not_configured' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Fetch pending orders (not yet sent to Tremendous).
    const { data: orders, error: fetchErr } = await db
      .from('tremendous_orders')
      .select(`
        id,
        tester_id,
        redemption_id,
        amount_usd,
        sku,
        external_id,
        raw_payload,
        last_synced_at,
        mushi_testers ( auth_user_id, display_name )
      `)
      .eq('status', 'pending')
      .is('external_id', null) // only rows we haven't sent yet
      // Least recently tried first, so orders in backoff don't starve new ones.
      .order('last_synced_at', { ascending: true })
      .limit(BATCH_SIZE)

    if (fetchErr) {
      wlog.error('Failed to fetch pending orders', { error: fetchErr.message })
      return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }

    let processed = 0
    let failed = 0
    let gaveUp = 0
    const now = Date.now()

    for (const order of (orders ?? []) as unknown as PendingOrder[]) {
      const previousAttempts = attemptsSoFar(order.raw_payload)
      if (!isRetryDue(previousAttempts, order.last_synced_at, now)) continue

      const tester = order.mushi_testers
      if (!tester) {
        wlog.warn('Order has no tester row', { orderId: order.id })
        continue
      }

      const email = await resolveTesterEmail(db, tester.auth_user_id)
      if (!email) {
        wlog.warn('Cannot resolve tester email', { orderId: order.id, testerId: order.tester_id })
        await db
          .from('tremendous_orders')
          .update({ status: 'failed', raw_payload: { error: 'email_not_found' }, last_synced_at: new Date().toISOString() })
          .eq('id', order.id)
        // Withheld, not failed: ops sees it in the withheld queue and either
        // re-sends once the email is fixed or refunds (no automatic refund).
        await db
          .from('tester_redemptions')
          .update({ status: 'withheld', failure_reason: 'tester_email_not_found', withheld_reason: 'gift_card_order_failed' })
          .eq('id', order.redemption_id)
        failed++
        continue
      }

      const payload: TremendousOrderPayload = {
        external_id: `mushi-bounties:${order.id}`,
        payment: { funding_source_id: fundingSourceId },
        rewards: [
          {
            value: { denomination: order.amount_usd, currency_code: 'USD' },
            delivery: { method: 'EMAIL', email },
            products: [order.sku],
          },
        ],
      }

      const result = await callTremendous(tremendousApiUrl, '/orders', 'POST', payload)

      if (result.ok) {
        const extData = result.data as Record<string, unknown>
        const extOrder = (extData?.order as Record<string, unknown>) ?? {}
        const extId = (extOrder?.id as string) ?? null

        await db
          .from('tremendous_orders')
          .update({
            status: 'processing',
            external_id: extId,
            // Ids, status and amounts only: the response echoes the
            // recipient's email and the gift card's redeem link.
            raw_payload: minimalTremendousPayload(extData),
            last_synced_at: new Date().toISOString(),
          })
          .eq('id', order.id)

        await db
          .from('tester_redemptions')
          .update({ status: 'processing', tremendous_order_id: extId })
          .eq('id', order.redemption_id)

        wlog.info('Order sent to Tremendous', { orderId: order.id, externalId: extId })
        processed++
      } else {
        // The error body can echo the request, recipient email included.
        const lastError = scrubEmails(result.error ?? 'unknown error')
        wlog.error('Tremendous order failed', { orderId: order.id, error: lastError })

        const outcome = onTremendousFailure(result.status, previousAttempts)

        if (outcome.giveUp) {
          // A non-retryable 4xx or the last attempt: stop re-POSTing. The
          // redemption goes to the withheld queue with the reason; points
          // are not refunded automatically (owner decision 2026-10-10).
          await db
            .from('tremendous_orders')
            .update({
              status: 'failed',
              raw_payload: { last_error: lastError, attempts: outcome.attempts, gave_up: outcome.reason },
              last_synced_at: new Date().toISOString(),
            })
            .eq('id', order.id)
          await db
            .from('tester_redemptions')
            .update({ status: 'withheld', failure_reason: outcome.reason, withheld_reason: 'gift_card_order_failed' })
            .eq('id', order.redemption_id)
          wlog.error('Tremendous order given up; redemption withheld for review', {
            orderId: order.id,
            attempts: outcome.attempts,
            reason: outcome.reason,
          })
          gaveUp++
        } else {
          // Retryable (5xx, 429, network): stays pending, retried after a backoff.
          await db
            .from('tremendous_orders')
            .update({
              status: 'pending',
              raw_payload: { last_error: lastError, attempts: outcome.attempts },
              last_synced_at: new Date().toISOString(),
            })
            .eq('id', order.id)
        }

        failed++
      }
    }

    wlog.info('Tremendous redemption worker run complete', { processed, failed, gaveUp, total: (orders ?? []).length })

    return new Response(
      JSON.stringify({ ok: true, processed, failed, gave_up: gaveUp }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }),
)
