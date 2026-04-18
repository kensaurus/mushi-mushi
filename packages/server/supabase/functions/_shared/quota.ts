/**
 * Stripe-backed report ingest quota gate (PDCA full-sweep wave 2.1).
 *
 * Behavior:
 *  - Free tier: `FREE_REPORTS_PER_MONTH` ingested reports per project / billing
 *    period. After that, ingest returns HTTP 402 with `code: 'QUOTA_EXCEEDED'`
 *    until the next period rolls over OR an active billing_subscription exists.
 *  - Active subscription (`status='active'|'trialing'|'past_due'`): unlimited
 *    ingest — overage is metered into `usage_events` and reconciled to Stripe
 *    by the existing `usage-aggregator` cron.
 *  - Cancelled / unpaid / incomplete: treated as free tier.
 *
 * The check is hot-pathed on every `POST /v1/reports`, so we cache the verdict
 * in-process for `CACHE_TTL_MS` to avoid an N+1 against `usage_events`.
 */
import { getServiceClient } from './db.ts'
import { log } from './logger.ts'

const FREE_REPORTS_PER_MONTH = Number(Deno.env.get('MUSHI_FREE_REPORTS_PER_MONTH') ?? '1000')
const CACHE_TTL_MS = 60_000

interface CacheEntry {
  verdict: QuotaVerdict
  expiresAt: number
}

export interface QuotaVerdict {
  allowed: boolean
  reason?: 'OVER_FREE_TIER' | 'NO_SUBSCRIPTION'
  used: number
  limit: number | null
  periodResetsAt: string
  retryAfterSeconds: number | null
}

const cache = new Map<string, CacheEntry>()

function periodWindow(): { start: Date; end: Date } {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { start, end }
}

export function invalidateQuotaCache(projectId: string): void {
  cache.delete(projectId)
}

export async function checkIngestQuota(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
): Promise<QuotaVerdict> {
  const cached = cache.get(projectId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.verdict
  }

  const { start, end } = periodWindow()
  const periodResetsAt = end.toISOString()

  const { data: sub } = await db
    .from('billing_subscriptions')
    .select('status, current_period_end')
    .eq('project_id', projectId)
    .in('status', ['active', 'trialing', 'past_due'])
    .order('current_period_end', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (sub) {
    const verdict: QuotaVerdict = {
      allowed: true,
      used: 0,
      limit: null,
      periodResetsAt: sub.current_period_end ?? periodResetsAt,
      retryAfterSeconds: null,
    }
    cache.set(projectId, { verdict, expiresAt: Date.now() + CACHE_TTL_MS })
    return verdict
  }

  const { count, error } = await db
    .from('usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('event_name', 'reports_ingested')
    .gte('occurred_at', start.toISOString())
    .lt('occurred_at', end.toISOString())

  if (error) {
    log.warn('Quota usage count failed; allowing ingest', { projectId, err: error.message })
    return { allowed: true, used: 0, limit: FREE_REPORTS_PER_MONTH, periodResetsAt, retryAfterSeconds: null }
  }

  const used = count ?? 0
  const allowed = used < FREE_REPORTS_PER_MONTH
  const verdict: QuotaVerdict = {
    allowed,
    reason: allowed ? undefined : 'OVER_FREE_TIER',
    used,
    limit: FREE_REPORTS_PER_MONTH,
    periodResetsAt,
    retryAfterSeconds: allowed ? null : Math.max(1, Math.floor((end.getTime() - Date.now()) / 1000)),
  }
  cache.set(projectId, { verdict, expiresAt: Date.now() + CACHE_TTL_MS })
  return verdict
}
