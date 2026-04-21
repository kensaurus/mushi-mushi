/**
 * _shared/seer.ts — §3b
 *
 * Shared Sentry-Seer logic used by both:
 *   1. `sentry-seer-poll` (cron-driven pull every 15 min)
 *   2. `POST /v1/webhooks/sentry/seer`     (push, raw-body HMAC verified)
 *
 * Both paths converge on `applySeerAnalysis`, which writes the structured
 * root-cause/fix into `reports.sentry_seer_analysis` for every report whose
 * `sentry_event_id` or `sentry_issue_url` matches the Sentry issue. Keeping
 * the persistence shape in one module guarantees the two ingest paths can
 * never diverge.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from './logger.ts'

const log = rootLog.child('seer')

export interface SeerIssue {
  id: string
  shortId: string
  permalink: string
  lastSeen?: string
  seerFixability?: { fixabilityScore?: number }
}

export interface SeerAnalysisPayload {
  issueId: string
  shortId: string
  permalink: string
  rootCause: unknown
  fixSuggestion: unknown
  fixabilityScore: number | null
  fetchedAt: string
  source: 'poll' | 'webhook'
}

/**
 * Sentry's autofix endpoint returns an opaque steps array. We pick out the
 * `root_cause` and `solution` step shapes — both the legacy `key` and
 * current `type` discriminators are accepted for forward-compat.
 */
export function parseSeerAutofixBody(body: unknown): { rootCause: unknown; fixSuggestion: unknown } | null {
  if (!body || typeof body !== 'object') return null
  const autofix = (body as Record<string, unknown>).autofix as Record<string, unknown> | undefined
  const steps = (autofix?.steps as Array<Record<string, unknown>> | undefined) ?? []
  const rootCauseStep = steps.find((s) => s.type === 'root_cause' || s.key === 'root_cause')
  const solutionStep = steps.find((s) => s.type === 'solution' || s.key === 'solution')
  if (!rootCauseStep && !solutionStep) return null
  return {
    rootCause: rootCauseStep?.root_cause ?? rootCauseStep?.insight ?? null,
    fixSuggestion: solutionStep?.solution ?? solutionStep?.insight ?? null,
  }
}

export async function fetchIssuesWithSeer(opts: {
  token: string
  orgSlug: string
  projectSlug: string
  since: string | null
}): Promise<SeerIssue[]> {
  const url = new URL(`https://sentry.io/api/0/projects/${opts.orgSlug}/${opts.projectSlug}/issues/`)
  url.searchParams.set('query', 'is:unresolved has:seer-fixability-score')
  url.searchParams.set('limit', '50')
  if (opts.since) url.searchParams.set('statsPeriod', '24h')

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${opts.token}`, Accept: 'application/json' },
  })
  if (!res.ok) {
    log.warn('Sentry issues fetch failed', { status: res.status, project: opts.projectSlug })
    return []
  }
  return (await res.json()) as SeerIssue[]
}

export async function fetchSeerAnalysis(opts: {
  token: string
  orgSlug: string
  issueId: string
}): Promise<{ rootCause: unknown; fixSuggestion: unknown } | null> {
  const url = `https://sentry.io/api/0/organizations/${opts.orgSlug}/issues/${opts.issueId}/autofix/`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${opts.token}`, Accept: 'application/json' },
  })
  if (!res.ok) {
    if (res.status !== 404) {
      log.warn('Seer autofix fetch failed', { status: res.status, issueId: opts.issueId })
    }
    return null
  }
  return parseSeerAutofixBody(await res.json())
}

/**
 * Match Sentry issue → existing reports → upsert sentry_seer_analysis.
 * Returns counts so callers can audit-log / Langfuse-trace consistently.
 */
export async function applySeerAnalysis(
  db: SupabaseClient,
  projectId: string,
  payload: SeerAnalysisPayload,
): Promise<{ matched: number; updated: number }> {
  const { data: matches } = await db
    .from('reports')
    .select('id')
    .eq('project_id', projectId)
    .or(`sentry_issue_url.eq.${payload.permalink},sentry_event_id.eq.${payload.issueId}`)
    .limit(25)

  if (!matches || matches.length === 0) return { matched: 0, updated: 0 }

  let updated = 0
  for (const m of matches) {
    const { error } = await db
      .from('reports')
      .update({ sentry_seer_analysis: payload })
      .eq('id', m.id)
    if (error) {
      log.warn('seer update failed', { reportId: m.id, error: error.message })
    } else {
      updated++
    }
  }
  return { matched: matches.length, updated }
}

/**
 * Constant-time HMAC-SHA256 verification used by the webhook handler. The
 * raw body must be the exact bytes Sentry sent — JSON-decode + re-encode
 * will silently change whitespace and break the signature.
 *
 * Sentry's `Sentry-Hook-Signature` is a hex digest of HMAC-SHA256(secret, body).
 */
export async function verifySentryHookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader || !secret) return false
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody))
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  // Constant-time compare to avoid timing attacks.
  if (expected.length !== signatureHeader.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i)
  }
  return diff === 0
}

/**
 * Best-effort extraction of (issueId, shortId, permalink, fixabilityScore)
 * from a Sentry issue-event webhook body. Sentry has shipped at least three
 * payload shapes over the years — we accept the modern v2 (`data.issue`),
 * the older flat shape, and the integration-platform `data.event` variant.
 */
export function parseIssueWebhookBody(body: unknown): SeerIssue | null {
  if (!body || typeof body !== 'object') return null
  const root = body as Record<string, unknown>
  const data = (root.data as Record<string, unknown> | undefined) ?? root
  const issue = (data.issue as Record<string, unknown> | undefined)
    ?? (data.event as Record<string, unknown> | undefined)
    ?? data

  const id = String(issue.id ?? issue.issue_id ?? '')
  if (!id) return null
  const shortId = String(issue.shortId ?? issue.short_id ?? id)
  const permalink = String(issue.permalink ?? issue.web_url ?? '')

  return {
    id,
    shortId,
    permalink,
    lastSeen: typeof issue.lastSeen === 'string' ? issue.lastSeen : undefined,
    seerFixability: (issue.seerFixability as { fixabilityScore?: number } | undefined)
      ?? (issue.seer_fixability as { fixabilityScore?: number } | undefined),
  }
}
