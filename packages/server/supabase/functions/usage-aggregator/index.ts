// ============================================================
// Wave D D5: usage aggregator (cron, hourly).
//
// 1. Reads `usage_events` rows where `meter_synced_at IS NULL`,
//    grouped by (project_id, day_utc) via `billing_usage_unsynced_summary`.
// 2. Looks up each project's Stripe customer.
// 3. Sends one Stripe Meter Event per (project, day) — `identifier` is
//    `mushi:reports_ingested:<project_id>:<day_utc>` so retries are
//    idempotent.
// 4. Marks the underlying rows as synced.
//
// Designed to be triggered by Supabase pg_cron every hour:
//
//   select cron.schedule(
//     'mushi-usage-aggregator',
//     '@hourly',
//     $$ select net.http_post(
//          url:='https://<project-ref>.functions.supabase.co/usage-aggregator',
//          headers:='{"Authorization": "Bearer <service-role>"}'::jsonb
//        ) $$
//   );
// ============================================================
import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { startCronRun } from '../_shared/telemetry.ts'
import { withSentry } from '../_shared/sentry.ts'
import { recordMeterEvent, stripeFromEnv } from '../_shared/stripe.ts'

const ulog = log.child('usage-aggregator')

interface SummaryRow {
  project_id: string
  day_utc: string
  total: number
}

const meterIdentifier = (event: string, projectId: string, day: string) =>
  `mushi:${event}:${projectId}:${day}`

const handler = async (_req: Request): Promise<Response> => {
  const cfg = stripeFromEnv()
  if (!cfg.secretKey) {
    ulog.error('missing_stripe_secret_key')
    return new Response('misconfigured', { status: 500 })
  }

  const db = getServiceClient()
  const cron = await startCronRun('usage-aggregator')

  let synced = 0
  let failed = 0

  try {
    const { data, error } = await db.rpc('billing_usage_unsynced_summary', {
      p_event_name: 'reports_ingested',
    })
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as SummaryRow[]

    for (const row of rows) {
      const { data: customer, error: custErr } = await db
        .from('billing_customers')
        .select('stripe_customer_id')
        .eq('project_id', row.project_id)
        .maybeSingle()
      if (custErr || !customer?.stripe_customer_id) {
        ulog.warn('skipped_no_customer', { project_id: row.project_id })
        continue
      }

      try {
        const result = await recordMeterEvent(cfg, {
          identifier: meterIdentifier('reports_ingested', row.project_id, row.day_utc),
          customer: customer.stripe_customer_id,
          value: row.total,
          timestamp: Math.floor(new Date(`${row.day_utc}T23:59:59Z`).getTime() / 1000),
        })

        const { error: updErr } = await db
          .from('usage_events')
          .update({
            meter_synced_at: new Date().toISOString(),
            stripe_meter_event_id: result.identifier,
          })
          .eq('project_id', row.project_id)
          .eq('event_name', 'reports_ingested')
          .is('meter_synced_at', null)
          .gte('occurred_at', `${row.day_utc}T00:00:00Z`)
          .lte('occurred_at', `${row.day_utc}T23:59:59Z`)
        if (updErr) throw new Error(updErr.message)
        synced++
      } catch (err) {
        failed++
        ulog.error('meter_push_failed', {
          project_id: row.project_id,
          day_utc: row.day_utc,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    await cron.complete({ status: 'ok', stats: { synced, failed, total: rows.length } })
    return Response.json({ ok: true, synced, failed, batches: rows.length })
  } catch (err) {
    await cron.complete({
      status: 'error',
      stats: { synced, failed },
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

Deno.serve(withSentry(handler, { name: 'usage-aggregator' }))

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): void; env: { get(name: string): string | undefined } }
