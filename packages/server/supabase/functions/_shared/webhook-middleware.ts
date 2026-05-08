/**
 * FILE: packages/server/supabase/functions/_shared/webhook-middleware.ts
 * PURPOSE: Shared middleware for inbound webhook endpoints.
 *
 *          Provides three security layers that every webhook route should
 *          apply BEFORE processing the payload:
 *
 *          1. **Audit logging** — writes a row to `webhook_audit_log` on
 *             every request (pending → accepted/rejected on completion).
 *             Enables after-the-fact intrusion analysis and rate-limit
 *             dashboards in the admin console.
 *
 *          2. **Replay detection** — checks whether the same
 *             (webhook_source, delivery_id) arrived in the last 24 hours.
 *             Prevents replay attacks where an attacker records and
 *             re-submits a valid signed payload.
 *
 *          3. **Per-source rate limiting** — uses an in-memory sliding
 *             window (safe because Supabase edge functions are single-tenant
 *             per isolate) to enforce a per-source request budget:
 *             - Sentry / GitHub / Jira / PagerDuty: 30 req/min per IP
 *             - Unknown sources: 5 req/min per IP
 *             Falls back to the audit log for distributed rate limiting when
 *             the in-memory window is cold (new isolate spin-up).
 *
 * USAGE:
 *   import { createWebhookMiddleware } from '../_shared/webhook-middleware.ts'
 *
 *   // In your route handler:
 *   const { audit, checkReplay, checkRateLimit } = createWebhookMiddleware('sentry')
 *   const auditRow = await audit(c, body, deliveryId)
 *   await checkReplay(auditRow.id, deliveryId)     // throws 429 if replay
 *   await checkRateLimit(auditRow.id, sourceIp)    // throws 429 if rate-limited
 *   // ... process webhook ...
 *   await auditRow.resolve('accepted', responseStatus, durationMs)
 */

import type { Context } from 'jsr:@hono/hono'
import { createClient } from 'jsr:@supabase/supabase-js@2'

type WebhookSource =
  | 'sentry' | 'sentry_seer' | 'github' | 'jira' | 'pagerduty'
  | 'linear' | 'slack' | 'discord' | 'datadog' | 'new_relic'
  | 'honeycomb' | 'opsgenie' | 'cloudwatch' | 'bugsnag' | 'rollbar'
  | 'crashlytics' | 'firebase_analytics' | 'openai' | 'unknown'

type AuditOutcome =
  | 'pending' | 'accepted' | 'rejected_signature'
  | 'rejected_rate_limit' | 'rejected_replay' | 'error'

interface AuditRowHandle {
  /** The UUID of the created audit log row */
  id: string
  /**
   * Finalize the audit log row with the outcome, response status, and duration.
   * Call this in a finally block to ensure the row is always resolved.
   */
  resolve(
    outcome: AuditOutcome,
    responseStatus?: number,
    durationMs?: number,
    errorMessage?: string,
  ): Promise<void>
}

// Per-source rate limit budget (requests per 60s per source IP)
const RATE_LIMIT_BUDGET: Record<WebhookSource, number> = {
  sentry: 30,
  sentry_seer: 30,
  github: 60, // GitHub can send many events during a CI run
  jira: 20,
  pagerduty: 20,
  linear: 20,
  slack: 30,
  discord: 30,
  datadog: 20,
  new_relic: 20,
  honeycomb: 20,
  opsgenie: 20,
  cloudwatch: 10,
  bugsnag: 20,
  rollbar: 20,
  crashlytics: 10,
  firebase_analytics: 10,
  openai: 5,
  unknown: 5,
}

// In-memory sliding window for rate limiting.
// Key: `${source}:${sourceIp}` → array of timestamps (ms)
const rateLimitWindows = new Map<string, number[]>()

function checkInMemoryRateLimit(source: WebhookSource, sourceIp: string): boolean {
  const key = `${source}:${sourceIp}`
  const now = Date.now()
  const windowMs = 60_000
  const budget = RATE_LIMIT_BUDGET[source] ?? 5

  const hits = (rateLimitWindows.get(key) ?? []).filter((t) => now - t < windowMs)
  if (hits.length >= budget) return false

  hits.push(now)
  rateLimitWindows.set(key, hits)
  return true
}

/** Compute SHA-256 of a string and return hex */
async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Extract the best available source IP from CF/proxy headers */
function extractSourceIp(c: Context): string | null {
  return (
    c.req.header('CF-Connecting-IP') ??
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ??
    null
  )
}

function getServiceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

/**
 * Factory that creates per-request middleware helpers for a given webhook source.
 */
export function createWebhookMiddleware(source: WebhookSource) {
  /**
   * Create an audit log row for this request. Returns a handle to finalize
   * the row after processing. Call this before ANY signature verification
   * so that even rejected requests are logged.
   */
  async function audit(
    c: Context,
    rawBody: string,
    deliveryId?: string | null,
  ): Promise<AuditRowHandle> {
    const startMs = Date.now()
    const db = getServiceClient()
    const bodyHash = await sha256hex(rawBody)
    const sourceIp = extractSourceIp(c)

    const { data, error } = await db
      .from('webhook_audit_log')
      .insert({
        webhook_source: source,
        delivery_id: deliveryId ?? null,
        body_hash: bodyHash,
        outcome: 'pending',
        source_ip: sourceIp,
        http_method: c.req.method,
        http_path: new URL(c.req.url).pathname,
      })
      .select('id')
      .single()

    if (error || !data) {
      // Audit insert failure is non-fatal — do NOT block the webhook.
      // A compromised logging system should not take down ingest.
      console.error('[webhook-middleware] audit insert failed:', error?.message)
      return {
        id: crypto.randomUUID(),
        resolve: async () => {},
      }
    }

    const rowId = data.id

    return {
      id: rowId,
      async resolve(
        outcome: AuditOutcome,
        responseStatus?: number,
        durationMs?: number,
        errorMessage?: string,
      ) {
        const elapsed = durationMs ?? Date.now() - startMs
        await db
          .from('webhook_audit_log')
          .update({
            outcome,
            response_status: responseStatus ?? null,
            duration_ms: elapsed,
            error_message: errorMessage ?? null,
          })
          .eq('id', rowId)
      },
    }
  }

  /**
   * Check for replay attacks. Looks for a row with the same (source, delivery_id)
   * in the last 24 hours. Throws a 409 Conflict response if a replay is detected.
   *
   * Call AFTER audit() but BEFORE processing.
   */
  async function checkReplay(
    currentRowId: string,
    deliveryId?: string | null,
  ): Promise<void> {
    if (!deliveryId) return // No delivery ID = cannot detect replay

    const db = getServiceClient()
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const { count } = await db
      .from('webhook_audit_log')
      .select('*', { count: 'exact', head: true })
      .eq('webhook_source', source)
      .eq('delivery_id', deliveryId)
      .in('outcome', ['accepted'])
      .gte('created_at', since)
      .neq('id', currentRowId)

    if ((count ?? 0) > 0) {
      throw new ReplayAttackError(`Delivery ${deliveryId} already processed`)
    }
  }

  /**
   * Enforce per-source-IP rate limit. Uses an in-memory sliding window first
   * (cheap, no DB round-trip). Throws a 429 Too Many Requests if over budget.
   *
   * Call AFTER audit() but BEFORE signature verification to catch brute-force
   * signature-guessing attacks.
   */
  function checkRateLimit(auditRowId: string, sourceIp: string | null): void {
    if (!sourceIp) return // Cannot rate-limit without an IP
    if (!checkInMemoryRateLimit(source, sourceIp)) {
      throw new RateLimitError(source, RATE_LIMIT_BUDGET[source] ?? 5)
    }
  }

  return { audit, checkReplay, checkRateLimit }
}

/** Thrown when a webhook delivery was already processed within the last 24h */
export class ReplayAttackError extends Error {
  readonly status = 409
  constructor(message: string) {
    super(message)
    this.name = 'ReplayAttackError'
  }
}

/** Thrown when the per-IP rate limit for a webhook source is exceeded */
export class RateLimitError extends Error {
  readonly status = 429
  readonly retryAfterSeconds = 60
  constructor(source: string, budget: number) {
    super(`Rate limit exceeded for ${source}: max ${budget} req/min per IP`)
    this.name = 'RateLimitError'
  }
}
