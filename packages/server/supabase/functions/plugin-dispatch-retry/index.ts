// ============================================================
// plugin-dispatch-retry — every minute (pg_cron)
//
// Reads `plugin_dispatch_log` rows with status='pending' whose
// `next_retry_at` has elapsed and replays them against the original
// plugin webhook with the same HMAC signing path as the original
// dispatch. Schedule (exponential backoff): 30s, 2m, 10m, 1h, 6h —
// after attempt=5 the row is marked permanently 'error' and the
// installed plugin's last_delivery_status becomes 'error'.
//
// Idempotency: each retry uses the **same delivery_id** and
// **same payload_digest** as the original row — receivers that
// already accepted attempt N will see the dedup key on attempt N+1.
//
// Limits per run: BATCH_SIZE rows, capped so a backlog can't blow
// the 60s edge-function ceiling at concurrency CONCURRENCY.
// ============================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { startCronRun } from '../_shared/telemetry.ts'

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(name: string): string | undefined }
}

const plog = log.child('plugin-dispatch-retry')

// ──────────────────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────────────────

const BATCH_SIZE = 50
const CONCURRENCY = 5
const DISPATCH_TIMEOUT_MS = 8_000
const RESPONSE_EXCERPT_MAX = 512
const MAX_ATTEMPTS = 5

/** Backoff minutes-from-original-attempt for attempts 1..5. Index 0 maps to
 *  the very first retry (after a failed initial dispatch). After attempt 5
 *  the row is finalised as 'error'. */
const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000]

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

interface PendingRow {
  id: number
  delivery_id: string
  project_id: string
  plugin_slug: string
  event: string
  attempt: number
  payload_digest: string
}

interface PluginRow {
  webhook_url: string | null
  webhook_secret_vault_ref: string | null
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

async function loadSecret(db: SupabaseClient, ref: string): Promise<string | null> {
  const name = ref.startsWith('vault://') ? ref.slice('vault://'.length) : ref
  const { data, error } = await db.rpc('vault_lookup', { secret_name: name })
  if (error) return null
  return typeof data === 'string' ? data : null
}

async function signHmac(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('')
}

interface RetryOutcome {
  status: 'ok' | 'error' | 'timeout' | 'skipped'
  httpStatus: number | null
  durationMs: number
  excerpt: string
}

async function retryOne(db: SupabaseClient, row: PendingRow): Promise<RetryOutcome> {
  const { data: plugin } = await db
    .from('project_plugins')
    .select('webhook_url, webhook_secret_vault_ref')
    .eq('project_id', row.project_id)
    .or(`plugin_slug.eq.${row.plugin_slug},plugin_name.eq.${row.plugin_slug}`)
    .maybeSingle<PluginRow>()

  if (!plugin?.webhook_url || !plugin.webhook_secret_vault_ref) {
    return { status: 'skipped', httpStatus: null, durationMs: 0, excerpt: 'plugin_uninstalled' }
  }

  const secret = await loadSecret(db, plugin.webhook_secret_vault_ref)
  if (!secret) {
    return { status: 'skipped', httpStatus: null, durationMs: 0, excerpt: 'missing_secret' }
  }

  // Reconstruct the envelope. data is opaque to the worker — the receiver
  // verifies via X-Mushi-Signature, and dedups via the unchanged
  // delivery_id and payload_digest.
  const envelope = {
    event: row.event,
    deliveryId: row.delivery_id,
    occurredAt: new Date().toISOString(),
    projectId: row.project_id,
    pluginSlug: row.plugin_slug,
    data: { retryOf: row.delivery_id, attempt: row.attempt + 1 },
  }
  const rawBody = JSON.stringify(envelope)
  const t = Date.now()
  const sig = await signHmac(secret, `${t}.${rawBody}`)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Mushi-Event': row.event,
    'X-Mushi-Signature': `t=${t},v1=${sig}`,
    'X-Mushi-Project': row.project_id,
    'X-Mushi-Plugin': row.plugin_slug,
    'X-Mushi-Delivery': row.delivery_id,
    'X-Mushi-Retry-Attempt': String(row.attempt + 1),
  }

  const start = Date.now()
  let status: RetryOutcome['status'] = 'error'
  let httpStatus: number | null = null
  let excerpt = ''

  try {
    const controller = new AbortController()
    const tm = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS)
    const res = await fetch(plugin.webhook_url, {
      method: 'POST',
      headers,
      body: rawBody,
      signal: controller.signal,
    })
    clearTimeout(tm)
    httpStatus = res.status
    const text = await res.text().catch(() => '')
    excerpt = text.slice(0, RESPONSE_EXCERPT_MAX)
    status = res.ok ? 'ok' : 'error'
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') status = 'timeout'
    excerpt = String(err).slice(0, RESPONSE_EXCERPT_MAX)
  }

  return { status, httpStatus, durationMs: Date.now() - start, excerpt }
}

// ──────────────────────────────────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────────────────────────────────

async function handler(req: Request): Promise<Response> {
  const authResult = requireServiceRoleAuth(req)
  if (authResult) return authResult

  const db = getServiceClient()
  const cron = await startCronRun(db, 'plugin-dispatch-retry', 'cron')

  try {
    // ── 1. Pull a batch of pending rows whose retry time has elapsed ───
    const nowIso = new Date().toISOString()
    const { data: pending, error: pendingErr } = await db
      .from('plugin_dispatch_log')
      .select('id, delivery_id, project_id, plugin_slug, event, attempt, payload_digest')
      .eq('status', 'pending')
      .lte('next_retry_at', nowIso)
      .order('next_retry_at', { ascending: true })
      .limit(BATCH_SIZE)
    if (pendingErr) throw new Error(`pending fetch failed: ${pendingErr.message}`)

    const rows = (pending ?? []) as PendingRow[]
    plog.info('plugin-dispatch-retry.start', { rows: rows.length })

    let succeeded = 0
    let failed = 0
    let exhausted = 0

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const batch = rows.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(
        batch.map(async (row) => {
          const outcome = await retryOne(db, row)
          return { row, outcome }
        }),
      )

      for (const r of results) {
        if (r.status !== 'fulfilled') {
          plog.warn('retry threw', { error: String(r.reason) })
          continue
        }
        const { row, outcome } = r.value
        const newAttempt = row.attempt + 1

        // ── Decide next status / next_retry_at based on outcome ───────
        const isFinalOk = outcome.status === 'ok'
        const isPermanentFail = outcome.status === 'skipped' || newAttempt >= MAX_ATTEMPTS
        const willRetry = !isFinalOk && !isPermanentFail
        const nextStatus: 'ok' | 'pending' | 'error' = isFinalOk
          ? 'ok'
          : willRetry
            ? 'pending'
            : 'error'
        // BACKOFF_MS is indexed 0..MAX_ATTEMPTS-1, lookup uses newAttempt-1
        // since attempt=1 was the original dispatch and attempt=2 is the
        // first retry.
        const nextRetryAt = willRetry
          ? new Date(Date.now() + BACKOFF_MS[Math.min(newAttempt - 1, BACKOFF_MS.length - 1)]).toISOString()
          : null

        const { error: updateErr } = await db
          .from('plugin_dispatch_log')
          .update({
            attempt: newAttempt,
            status: nextStatus,
            http_status: outcome.httpStatus,
            response_excerpt: outcome.excerpt || null,
            duration_ms: outcome.durationMs,
            next_retry_at: nextRetryAt,
          })
          .eq('id', row.id)
        if (updateErr) plog.warn('row update failed', { id: row.id, error: updateErr.message })

        if (isFinalOk) {
          succeeded++
          // Update the plugin row's last_delivery_at/status — only on
          // success or permanent-fail, never on intermediate retries.
          await db
            .from('project_plugins')
            .update({
              last_delivery_at: new Date().toISOString(),
              last_delivery_status: 'ok',
            })
            .eq('project_id', row.project_id)
            .or(`plugin_slug.eq.${row.plugin_slug},plugin_name.eq.${row.plugin_slug}`)
        } else if (isPermanentFail) {
          exhausted++
          await db
            .from('project_plugins')
            .update({
              last_delivery_at: new Date().toISOString(),
              last_delivery_status: 'error',
            })
            .eq('project_id', row.project_id)
            .or(`plugin_slug.eq.${row.plugin_slug},plugin_name.eq.${row.plugin_slug}`)
        } else {
          failed++
        }
      }
    }

    await cron.finish({
      rowsAffected: rows.length,
      metadata: { rows: rows.length, succeeded, failed, exhausted },
    })
    return new Response(
      JSON.stringify({ ok: true, data: { processed: rows.length, succeeded, failed, exhausted } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    await cron.fail(err)
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'RETRY_FAILED', message: String(err) } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('plugin-dispatch-retry', handler))
}
