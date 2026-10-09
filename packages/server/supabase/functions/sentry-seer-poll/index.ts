/**
 * sentry-seer-poll — pull Sentry Seer root-cause analysis into matched reports.
 *
 * Invoked every 15 minutes by `pg_cron` (mushi-sentry-seer-poll, see migration
 * 20260418003300_seer_poller_cron.sql). For every project_settings row with
 * `sentry_seer_enabled = true` it fetches Seer-flagged issues, pulls the
 * autofix analysis, and persists into `reports.sentry_seer_analysis`.
 *
 * §3b: the parsing + writeback logic now lives in `_shared/seer.ts`
 * so the new push-based webhook (`POST /v1/webhooks/sentry/seer`) can reuse
 * the same persistence code path.
 *
 * Second pass: projects with `sentry_auto_import = true` get new unresolved
 * Sentry issues imported as reports, through the same idempotent path as the
 * console's "Import existing Sentry issues". Before it, only an alert-rule
 * webhook built by hand in Sentry brought new issues in, and four of five
 * connected projects had none (2026-10-09).
 */

import { Hono } from 'npm:hono@4'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from '../_shared/logger.ts'
import { ensureSentry, sentryHonoErrorHandler } from '../_shared/sentry.ts'
import {
  applySeerAnalysis,
  fetchIssuesWithSeer,
  fetchSeerAnalysis,
  type SeerAnalysisPayload,
} from '../_shared/seer.ts'
import { mapWithConcurrency } from '../_shared/concurrency.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import {
  allowedSentryProjectSlugs,
  importSentryIssues,
  SENTRY_AUTO_IMPORT_MAX_PAGES,
  SENTRY_IMPORT_MAX,
  sentryAutoImportQuery,
} from '../_shared/sentry-import.ts'
import { resolveAndDereferencePlatformSettings } from '../_shared/integration-settings.ts'

ensureSentry('sentry-seer-poll')

const log = rootLog.child('sentry-seer-poll')
const app = new Hono()
app.onError(sentryHonoErrorHandler)

function getDb() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )
}

// Wave S1 / D-14: delegate to shared helper so future auth-policy changes
// (MUSHI_INTERNAL_CALLER_SECRET rotation, timing-safe compare, etc.) land
// everywhere at once.
function authorizationFailure(req: Request): Response | null {
  return requireServiceRoleAuth(req)
}

async function readVaultSecret(
  db: ReturnType<typeof getDb>,
  ref: string | null | undefined,
): Promise<string | null> {
  if (!ref) return null
  // The console stores `vault://<name>`; vault_get_secret takes the bare name
  // (or a secret uuid). A value without the prefix may be a bare ref or a
  // token saved inline (older rows); try it as a ref, then use it as-is.
  const isVaultUri = ref.startsWith('vault://')
  const secretId = isVaultUri ? ref.slice('vault://'.length) : ref
  const { data, error } = await db.rpc('vault_get_secret', { secret_id: secretId })
  if (error) {
    log.warn('vault_get_secret failed', { error: error.message })
    return isVaultUri ? null : ref
  }
  if (typeof data === 'string' && data) return data
  return isVaultUri ? null : ref
}

async function pollProject(
  db: ReturnType<typeof getDb>,
  settings: {
    project_id: string
    sentry_org_slug: string | null
    sentry_project_slug: string | null
    sentry_seer_token_ref: string | null
    sentry_auth_token_ref: string | null
    sentry_seer_last_polled_at: string | null
  },
): Promise<{ matched: number; updated: number; skipped: string | null }> {
  if (!settings.sentry_org_slug || !settings.sentry_project_slug) {
    return { matched: 0, updated: 0, skipped: 'missing_org_or_project_slug' }
  }
  const token = await readVaultSecret(db, settings.sentry_seer_token_ref)
    ?? await readVaultSecret(db, settings.sentry_auth_token_ref)
  if (!token) return { matched: 0, updated: 0, skipped: 'no_token' }

  const issues = await fetchIssuesWithSeer({
    token,
    orgSlug: settings.sentry_org_slug,
    projectSlug: settings.sentry_project_slug,
    since: settings.sentry_seer_last_polled_at,
  })

  // Wave S3 (PERF): fetch Seer analyses in parallel (concurrency=5). Sentry
  // rate-limits issue detail at 40 req/s; 5 in-flight × ~500ms gives us
  // 10 req/s steady-state, well under the cap. Sequential fetches were
  // measured at >9s per project on a 20-issue queue.
  let matched = 0
  let updated = 0
  const perIssue = await mapWithConcurrency(issues, 5, async (issue) => {
    const analysis = await fetchSeerAnalysis({
      token,
      orgSlug: settings.sentry_org_slug!,
      issueId: issue.id,
    })
    if (!analysis) return { matched: 0, updated: 0 }

    const payload: SeerAnalysisPayload = {
      issueId: issue.id,
      shortId: issue.shortId,
      permalink: issue.permalink,
      rootCause: analysis.rootCause,
      fixSuggestion: analysis.fixSuggestion,
      fixabilityScore: issue.seerFixability?.fixabilityScore ?? null,
      fetchedAt: new Date().toISOString(),
      source: 'poll' as const,
    }
    return applySeerAnalysis(db, settings.project_id, payload)
  })
  for (const r of perIssue) {
    matched += r.matched
    updated += r.updated
  }

  await db
    .from('project_settings')
    .update({ sentry_seer_last_polled_at: new Date().toISOString() })
    .eq('project_id', settings.project_id)

  return { matched, updated, skipped: null }
}

/**
 * Start Stage 1 for an imported report, as the API's triggerClassification
 * does. Fire-and-forget: a failed kick leaves the processing_queue row
 * pending, and recover_stranded_pipeline picks it up.
 */
function kickClassification(reportId: string, projectId: string): void {
  const run = fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/fast-filter`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
    },
    body: JSON.stringify({ reportId, projectId }),
    signal: AbortSignal.timeout(60_000),
  })
    .then((res) => {
      if (!res.ok) log.warn('auto-import: classification kick failed', { reportId, status: res.status })
    })
    .catch((err) => log.warn('auto-import: classification kick failed', { reportId, err: String(err) }))
  const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
  edgeRuntime?.waitUntil(run)
}

async function autoImportProject(
  db: ReturnType<typeof getDb>,
  row: {
    project_id: string
    sentry_project_slug: string | null
    sentry_extra_project_slugs: unknown
    sentry_auto_import_last_at: string | null
  },
): Promise<{ created: number; seen: number; skipped: string | null }> {
  const projectSlugs = allowedSentryProjectSlugs(row.sentry_project_slug, row.sentry_extra_project_slugs)
  if (projectSlugs.length === 0) return { created: 0, seen: 0, skipped: 'no_project_slug' }
  // Token and org may be inherited from the organization's defaults.
  const { settings } = await resolveAndDereferencePlatformSettings(db, row.project_id)
  const token = settings.sentry_auth_token_ref ?? null
  const orgSlug = settings.sentry_org_slug ?? null
  if (!token || !orgSlug) return { created: 0, seen: 0, skipped: 'no_token_or_org' }

  const startedAt = new Date()
  const query = sentryAutoImportQuery(row.sentry_auto_import_last_at, startedAt)
  let created = 0
  let seen = 0
  for (const sentryProject of projectSlugs) {
    let cursor: string | undefined
    for (let page = 0; page < SENTRY_AUTO_IMPORT_MAX_PAGES; page++) {
      const result = await importSentryIssues(db, {
        projectId: row.project_id,
        request: { query, limit: SENTRY_IMPORT_MAX, sentryProject, cursor },
        sentry: { token, orgSlug, projectSlugs },
        triggerClassification: kickClassification,
      })
      seen += result.items.length
      created += result.items.filter((i) => i.outcome === 'created').length
      if (!result.nextCursor) break
      cursor = result.nextCursor
    }
  }
  // Only a completed run moves the window, so a failed one is retried.
  await db
    .from('project_settings')
    .update({ sentry_auto_import_last_at: startedAt.toISOString() })
    .eq('project_id', row.project_id)
  return { created, seen, skipped: null }
}

app.get('/sentry-seer-poll/health', (c) => c.json({ ok: true }))

app.post('/sentry-seer-poll', async (c) => {
  const unauthorized = authorizationFailure(c.req.raw)
  if (unauthorized) return unauthorized

  const db = getDb()
  const { data: rows, error } = await db
    .from('project_settings')
    .select('project_id, sentry_org_slug, sentry_project_slug, sentry_seer_token_ref, sentry_auth_token_ref, sentry_seer_last_polled_at')
    .eq('sentry_seer_enabled', true)
    .limit(50)

  if (error) {
    log.error('settings query failed', { error: error.message })
    return c.json({ ok: false, error: error.message }, 500)
  }

  // Wave S3 (PERF): poll up to 5 projects in parallel. Each project's
  // pollProject already internally parallelises its issue fetches.
  const summary = await mapWithConcurrency(rows ?? [], 5, async (r) => {
    try {
      const result = await pollProject(db, r)
      return { projectId: r.project_id, ...result }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('project poll failed', { projectId: r.project_id, err: msg })
      return { projectId: r.project_id, matched: 0, updated: 0, skipped: `error:${msg.slice(0, 80)}` }
    }
  })

  const { data: importRows, error: importErr } = await db
    .from('project_settings')
    .select('project_id, sentry_project_slug, sentry_extra_project_slugs, sentry_auto_import_last_at')
    .eq('sentry_auto_import', true)
    .limit(50)
  if (importErr) log.error('auto-import settings query failed', { error: importErr.message })
  const imported = await mapWithConcurrency(importRows ?? [], 3, async (r) => {
    try {
      return { projectId: r.project_id, ...(await autoImportProject(db, r)) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('sentry auto-import failed', { projectId: r.project_id, err: msg })
      return { projectId: r.project_id, created: 0, seen: 0, skipped: `error:${msg.slice(0, 80)}` }
    }
  })

  return c.json({ ok: true, polled: summary.length, results: summary, autoImport: imported })
})

Deno.serve(app.fetch)
