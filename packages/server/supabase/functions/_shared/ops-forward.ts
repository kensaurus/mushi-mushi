/**
 * FILE: packages/server/supabase/functions/_shared/ops-forward.ts
 * PURPOSE: Hand a Sentry outcome to the Ops hub without bundling it.
 *
 *          `sentry-ingest.ts` runs inside `api`, which sits at Supabase's
 *          deploy size limit (scripts/deploy-edge-function.test.mjs). The Ops
 *          emitter (ops-events / ops-format / ops-slack) would push it over,
 *          so this module POSTs the outcome to `api-ext`
 *          (`/v1/internal/ops/sentry`, service role only), which records it
 *          and posts to Slack for teams whose bot is on. Fire-and-forget
 *          under waitUntil; never throws, never delays Sentry intake.
 *
 * Only an error / fatal outcome or a resolve is sent: everything else is
 * dropped by `opsEventFromSentry` (ops-sources.ts) anyway, which stays the
 * one place that decides what reaches #alerts.
 *
 * Dependency-free on purpose (no logger): it is the only Ops code in `api`.
 */

export interface SentryOpsOutcome {
  outcome: 'created' | 'reopened' | 'resolved'
  issueId: string | null
  title: string | null
  culprit?: string | null
  level?: string | null
  environment?: string | null
  release?: string | null
  url?: string | null
  firstSeen?: string | null
  regressionCount?: number
}

export const OPS_SENTRY_PATH = '/v1/internal/ops/sentry'

/** @internal Exported for tests: whether an outcome is worth the hop. */
export function shouldForwardSentry(s: SentryOpsOutcome): boolean {
  if (!s.issueId) return false
  if (s.outcome === 'resolved') return true
  const level = (s.level ?? 'error').toLowerCase()
  return (level === 'error' || level === 'fatal') && Boolean(s.title)
}

function env(name: string): string | undefined {
  try {
    return (globalThis as { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env.get(name)
  } catch {
    return undefined
  }
}

/** POST the outcome to api-ext under waitUntil. Never throws. */
export function forwardSentryOps(projectId: string, s: SentryOpsOutcome, fetchImpl: typeof fetch = fetch): Promise<void> {
  const url = env('SUPABASE_URL')
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key || !shouldForwardSentry(s)) return Promise.resolve()
  const p = fetchImpl(`${url.replace(/\/+$/, '')}/functions/v1/api-ext${OPS_SENTRY_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ projectId, sentry: s }),
    signal: AbortSignal.timeout(10_000),
  })
    .then(() => undefined)
    .catch(() => undefined)
  const edge = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
  if (edge && typeof edge.waitUntil === 'function') edge.waitUntil(p)
  return p
}
