// ============================================================
// Usage aggregator (cron, hourly).
//
// For every metered `usage_events.event_name` we know about, this:
//   1. Reads unsynced rows grouped by (project_id, day_utc) via
//      `billing_usage_unsynced_summary(event_name)`.
//   2. Looks up each project's Stripe customer.
//   3. POSTs ONE Stripe Meter Event per (event, project, day) — the
//      `identifier` is `mushi:<event>:<project_id>:<day>` so retries are
//      idempotent across this cron and Stripe's own dedup.
//   4. Marks the underlying rows as synced.
//
// We map our internal `usage_events.event_name` → the Stripe meter event
// names provisioned by `scripts/stripe-bootstrap.mjs`. Internal names stay
// short; Stripe-side names are namespaced (`mushi_*`) so they don't clash
// with other products on the same account.
//
// Triggered by Supabase pg_cron every hour:
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
import { requireServiceRoleAuth } from '../_shared/auth.ts'

const ulog = log.child('usage-aggregator')

interface SummaryRow {
  project_id: string
  day_utc: string
  total: number
}

interface MeteredEvent {
  /** Internal `usage_events.event_name`. */
  internal: 'reports_ingested' | 'fixes_succeeded'
  /** Stripe Billing Meter `event_name` configured via stripe-bootstrap.mjs. */
  stripe: string
}

const meterIdentifier = (event: string, projectId: string, day: string) =>
  `mushi:${event}:${projectId}:${day}`

const handler = async (req: Request): Promise<Response> => {
  // Wave S (2026-04-23): previously this handler ran with zero auth before
  // touching `getServiceClient()` + Stripe. Anyone who guessed the function
  // URL could trigger a full aggregator pass, abuse Stripe metering, and
  // mark rows synced. We now require the same internal-caller auth as every
  // other cron-triggered internal function (fast-filter, classify-report,
  // judge-batch, intelligence-report). pg_cron passes
  // `MUSHI_INTERNAL_CALLER_SECRET`; in-runtime function-to-function calls
  // use the auto-injected service-role key.
  const unauthorized = requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized

  const cfg = stripeFromEnv()
  if (!cfg.secretKey) {
    ulog.error('missing_stripe_secret_key')
    return new Response('misconfigured', { status: 500 })
  }

  // Internal → Stripe meter mapping. Add new entries here when we ship a
  // new metered SKU; the bootstrap script must create the matching meter.
  const meteredEvents: MeteredEvent[] = [
    { internal: 'reports_ingested', stripe: cfg.meterEventName },
    { internal: 'fixes_succeeded', stripe: cfg.fixesMeterEventName },
  ]

  const db = getServiceClient()
  const cron = await startCronRun(db, 'usage-aggregator', 'cron')

  let synced = 0
  let failed = 0
  let totalBatches = 0

  try {
    for (const me of meteredEvents) {
      const { data, error } = await db.rpc('billing_usage_unsynced_summary', {
        p_event_name: me.internal,
      })
      if (error) {
        ulog.error('summary_rpc_failed', { event: me.internal, error: error.message })
        continue
      }
      const rows = (data ?? []) as SummaryRow[]
      totalBatches += rows.length
      if (rows.length === 0) continue

      // Wave S (2026-04-23, PERF): previously we issued one SELECT on
      // `billing_customers` per unsynced (project, day) summary row. A
      // backlog of 500 rows after a cron skip meant 500 round-trips before
      // a single Stripe call landed. Bulk-fetch once and index in-memory.
      const uniqueProjectIds = [...new Set(rows.map(r => r.project_id))]
      const { data: customers, error: custBatchErr } = await db
        .from('billing_customers')
        .select('project_id, stripe_customer_id')
        .in('project_id', uniqueProjectIds)
      if (custBatchErr) {
        ulog.error('billing_customers_batch_failed', { event: me.internal, error: custBatchErr.message })
        continue
      }
      const customerByProject = new Map<string, string>()
      for (const c of customers ?? []) {
        if (c.stripe_customer_id) customerByProject.set(c.project_id, c.stripe_customer_id)
      }

      for (const row of rows) {
        const customerId = customerByProject.get(row.project_id)
        if (!customerId) {
          ulog.warn('skipped_no_customer', { project_id: row.project_id, event: me.internal })
          continue
        }

        try {
          const result = await recordMeterEvent(cfg, {
            identifier: meterIdentifier(me.internal, row.project_id, row.day_utc),
            customer: customerId,
            value: row.total,
            timestamp: Math.floor(new Date(`${row.day_utc}T23:59:59Z`).getTime() / 1000),
            eventName: me.stripe,
          })

          const { error: updErr } = await db
            .from('usage_events')
            .update({
              meter_synced_at: new Date().toISOString(),
              stripe_meter_event_id: result.identifier,
            })
            .eq('project_id', row.project_id)
            .eq('event_name', me.internal)
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
            event: me.internal,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }

    await cron.finish({
      rowsAffected: synced,
      metadata: { synced, failed, batches: totalBatches },
    })
    return Response.json({ ok: true, synced, failed, batches: totalBatches })
  } catch (err) {
    await cron.fail(err)
    throw err
  }
}

Deno.serve(withSentry('usage-aggregator', handler))

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): void; env: { get(name: string): string | undefined } }
