/**
 * sentry-seer-poll — pull Sentry Seer root-cause analysis into matched reports.
 *
 * Invoked every 15 minutes by `pg_cron` (mushi-sentry-seer-poll, see migration
 * 20260418003300_seer_poller_cron.sql). For every project_settings row with
 * `sentry_seer_enabled = true` it fetches Seer-flagged issues, pulls the
 * autofix analysis, and persists into `reports.sentry_seer_analysis`.
 *
 * Wave E §3b: the parsing + writeback logic now lives in `_shared/seer.ts`
 * so the new push-based webhook (`POST /v1/webhooks/sentry/seer`) can reuse
 * the same persistence code path.
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

function authorized(req: Request): boolean {
  const expected = `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`
  const got = req.headers.get('Authorization') ?? ''
  return Boolean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) && got === expected
}

async function readVaultSecret(
  db: ReturnType<typeof getDb>,
  ref: string | null | undefined,
): Promise<string | null> {
  if (!ref) return null
  const { data, error } = await db.rpc('vault_get_secret', { secret_id: ref })
  if (error) {
    log.warn('vault_get_secret failed', { ref, error: error.message })
    return null
  }
  return typeof data === 'string' ? data : null
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

  let matched = 0
  let updated = 0
  for (const issue of issues) {
    const analysis = await fetchSeerAnalysis({
      token,
      orgSlug: settings.sentry_org_slug,
      issueId: issue.id,
    })
    if (!analysis) continue

    const payload: SeerAnalysisPayload = {
      issueId: issue.id,
      shortId: issue.shortId,
      permalink: issue.permalink,
      rootCause: analysis.rootCause,
      fixSuggestion: analysis.fixSuggestion,
      fixabilityScore: issue.seerFixability?.fixabilityScore ?? null,
      fetchedAt: new Date().toISOString(),
      source: 'poll',
    }

    const result = await applySeerAnalysis(db, settings.project_id, payload)
    matched += result.matched
    updated += result.updated
  }

  await db
    .from('project_settings')
    .update({ sentry_seer_last_polled_at: new Date().toISOString() })
    .eq('project_id', settings.project_id)

  return { matched, updated, skipped: null }
}

app.get('/sentry-seer-poll/health', (c) => c.json({ ok: true }))

app.post('/sentry-seer-poll', async (c) => {
  if (!authorized(c.req.raw)) {
    return c.json({ error: 'unauthorized' }, 401)
  }

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

  const summary: Array<{ projectId: string; matched: number; updated: number; skipped: string | null }> = []
  for (const r of rows ?? []) {
    try {
      const result = await pollProject(db, r)
      summary.push({ projectId: r.project_id, ...result })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('project poll failed', { projectId: r.project_id, err: msg })
      summary.push({ projectId: r.project_id, matched: 0, updated: 0, skipped: `error:${msg.slice(0, 80)}` })
    }
  }

  return c.json({ ok: true, polled: summary.length, results: summary })
})

Deno.serve(app.fetch)
