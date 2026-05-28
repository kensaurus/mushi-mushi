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
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const apiKey = Deno.env.get('TREMENDOUS_API_KEY')
  if (!apiKey) return { ok: false, error: 'TREMENDOUS_API_KEY not set' }

  const baseUrl = Deno.env.get('TREMENDOUS_API_URL') ?? 'https://testflight.tremendous.com/api/v2'
  const url = `${baseUrl}${path}`

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    return { ok: false, error: `Tremendous ${res.status}: ${errText}` }
  }

  const data = await res.json().catch(() => null)
  return { ok: true, data }
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
        mushi_testers ( auth_user_id, display_name )
      `)
      .eq('status', 'pending')
      .is('external_id', null) // only rows we haven't sent yet
      .limit(BATCH_SIZE)

    if (fetchErr) {
      wlog.error('Failed to fetch pending orders', { error: fetchErr.message })
      return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }

    let processed = 0
    let failed = 0

    for (const order of (orders ?? []) as PendingOrder[]) {
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
        await db
          .from('tester_redemptions')
          .update({ status: 'failed', failure_reason: 'tester_email_not_found' })
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

      const result = await callTremendous('/orders', 'POST', payload)

      if (result.ok) {
        const extData = result.data as Record<string, unknown>
        const extOrder = (extData?.order as Record<string, unknown>) ?? {}
        const extId = (extOrder?.id as string) ?? null

        await db
          .from('tremendous_orders')
          .update({
            status: 'processing',
            external_id: extId,
            raw_payload: extData,
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
        wlog.error('Tremendous order failed', { orderId: order.id, error: result.error })

        // Keep status='pending' so the next cron tick retries automatically —
        // Tremendous outages are usually transient. Persistent failures are
        // surfaced via the last_error payload field for ops triage; the
        // separate manual-review/withhold workflow lives in the admin UI.
        await db
          .from('tremendous_orders')
          .update({
            status: 'pending',
            raw_payload: { last_error: result.error },
            last_synced_at: new Date().toISOString(),
          })
          .eq('id', order.id)

        failed++
      }
    }

    wlog.info('Tremendous redemption worker run complete', { processed, failed, total: (orders ?? []).length })

    return new Response(
      JSON.stringify({ ok: true, processed, failed }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }),
)
