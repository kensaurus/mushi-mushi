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
 *             dashboards in the admin console. Callers MUST resolve every
 *             audit row before returning, or rows accumulate as 'pending'
 *             forever and pollute dashboards.
 *
 *          2. **Replay detection** — checks whether the same
 *             (webhook_source, delivery_id) was previously *accepted* in the
 *             last 24 hours. Prevents replay attacks where an attacker
 *             records and re-submits a valid signed payload. Throws
 *             `ReplayAttackError` (status 409) on hit. Note: this check is
 *             best-effort — two concurrent in-flight requests with the same
 *             delivery_id can both pass (TOCTOU). Downstream processing
 *             should be idempotent regardless.
 *
 *          3. **Per-source rate limiting** — uses an in-memory sliding
 *             window. NOTE: each Supabase edge-function isolate has its own
 *             window, so the effective global budget is
 *             `budget × num_isolates`. For per-source-IP correctness use a
 *             centralized store (Redis / Postgres). The in-memory limiter is
 *             still useful as a cheap brute-force gate and protects each
 *             isolate from runaway load.
 *             - Sentry / GitHub / Jira / PagerDuty: 30 req/min per IP
 *             - Unknown sources: 5 req/min per IP
 *             Throws `RateLimitError` (status 429) on hit.
 *
 * USAGE:
 *   import { createWebhookMiddleware } from '../_shared/webhook-middleware.ts'
 *
 *   const { audit, checkReplay, checkRateLimit } = createWebhookMiddleware('sentry')
 *   const auditRow = await audit(c, body, deliveryId)
 *   try {
 *     checkRateLimit(sourceIp)              // throws 429 if rate-limited
 *     await checkReplay(auditRow.id, deliveryId)  // throws 409 if replay
 *     // ... process webhook ...
 *     await auditRow.resolve('accepted', 200, Date.now() - t0)
 *   } catch (err) {
 *     if (err instanceof RateLimitError) {
 *       await auditRow.resolve('rejected_rate_limit', 429, Date.now() - t0, err.message)
 *       return c.json({ ok: false, error: err.message }, 429)
 *     }
 *     if (err instanceof ReplayAttackError) {
 *       await auditRow.resolve('rejected_replay', 409, Date.now() - t0, err.message)
 *       return c.json({ ok: false, error: 'Duplicate delivery' }, 409)
 *     }
 *     throw err
 *   }
 */

import type { Context } from 'jsr:@hono/hono'
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

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
   * Call this on EVERY return path — orphaned 'pending' rows pollute the
   * audit dashboard and block accurate rate-limit accounting.
   */
  resolve(
    outcome: AuditOutcome,
    responseStatus?: number,
    durationMs?: number,
    errorMessage?: string,
  ): Promise<void>
}

// Per-source rate limit budget (requests per 60s per source IP). Tuned to
// the documented event volume of each upstream so we don't reject legitimate
// bursts (CI churn for GitHub, alert storms for PagerDuty, etc.).
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
//
// Memory management: every check filters out timestamps outside the window
// before evaluating; if the resulting array is empty AND the cache reached
// `MAX_RATE_KEYS`, we evict the entry to bound memory in long-lived isolates
// that see many unique IPs (scanners, proxies). The cap is a soft fence —
// individual misses don't break correctness because the next request from
// that IP just starts a new window.
const rateLimitWindows = new Map<string, number[]>()
const MAX_RATE_KEYS = 10_000

function checkInMemoryRateLimit(source: WebhookSource, sourceIp: string): boolean {
  const key = `${source}:${sourceIp}`
  const now = Date.now()
  const windowMs = 60_000
  const budget = RATE_LIMIT_BUDGET[source] ?? 5

  const hits = (rateLimitWindows.get(key) ?? []).filter((t) => now - t < windowMs)
  if (hits.length >= budget) {
    rateLimitWindows.set(key, hits)
    return false
  }

  hits.push(now)
  rateLimitWindows.set(key, hits)

  // Bounded GC — evict oldest entries when the map grows past the soft cap.
  // Map preserves insertion order so the first key is the least-recently-set.
  if (rateLimitWindows.size > MAX_RATE_KEYS) {
    const firstKey = rateLimitWindows.keys().next().value
    if (firstKey !== undefined) rateLimitWindows.delete(firstKey)
  }
  return true
}

/** Compute SHA-256 of a string and return hex */
async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Extract the best available source IP from CF/proxy headers.
 *
 * Header preference order matches the typical Supabase + Cloudflare deployment:
 *   1. CF-Connecting-IP (Cloudflare-set, the actual client IP)
 *   2. X-Real-IP (set by some proxies as a single canonical client IP)
 *   3. X-Forwarded-For (RFC 7239 chain — first hop is the original client)
 */
function extractSourceIp(c: Context): string | null {
  return (
    c.req.header('CF-Connecting-IP') ??
    c.req.header('X-Real-IP') ??
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ??
    null
  )
}

// Module-level service-client cache. createClient() is lightweight but
// recreating it 3-4× per webhook (audit / replay / resolve) on every request
// added measurable overhead under load. One instance per isolate is safe —
// the supabase-js client is stateless beyond the URL+key and connection pool.
let _serviceClient: SupabaseClient | null = null
function getServiceClient(): SupabaseClient {
  if (_serviceClient) return _serviceClient
  _serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  return _serviceClient
}

/**
 * Factory that creates per-request middleware helpers for a given webhook source.
 */
export function createWebhookMiddleware(source: WebhookSource) {
  const db = getServiceClient()

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
   * previously *accepted* in the last 24 hours. Throws `ReplayAttackError`
   * (status 409) if a replay is detected.
   *
   * Best-effort: two concurrent requests with the same delivery_id can both
   * pass this check (TOCTOU). Downstream processing should be idempotent.
   *
   * Call AFTER audit() but BEFORE processing.
   */
  async function checkReplay(
    currentRowId: string,
    deliveryId?: string | null,
  ): Promise<void> {
    if (!deliveryId) return // No delivery ID = cannot detect replay

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
   * Enforce per-source-IP rate limit. Uses an in-memory sliding window
   * (cheap, no DB round-trip). Throws `RateLimitError` (status 429) if over
   * budget.
   *
   * Call AFTER audit() but BEFORE signature verification to catch
   * brute-force signature-guessing attacks early.
   *
   * NOTE: per-isolate. Across N isolates the effective budget is N × the
   * documented limit. Use a centralized store for global enforcement.
   */
  function checkRateLimit(sourceIp: string | null): void {
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
