// ============================================================
// site-watch-poll — read the live-site watches' finished checks and
// file broken pages as reports (ADR 0024).
//
// Trigger: pg_cron hourly at :14 (migration 20261010190000), and
//          POST {"projectId": "<uuid>"} from the api after "Check now".
// Auth:    requireServiceRoleAuth (internal only).
//
// Firecrawl runs each watch's crawl on its own schedule and bills the
// project's Firecrawl key. This function only reads results: for each
// active watch, the checks finished since the last one read, oldest first.
// See _shared/site-watch.ts.
// ============================================================

import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { resolveFirecrawl } from '../_shared/firecrawl.ts'
import { queueReportClassification } from '../_shared/report-classification.ts'
import {
  checkPages,
  checksToProcess,
  FirecrawlMonitorError,
  listChecks,
  processCheck,
  type ProcessDeps,
} from '../_shared/site-watch.ts'

const plog = log.child('site-watch-poll')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const deps: ProcessDeps = {
  now: () => new Date(),
  classify: (db, reportId, projectId) => queueReportClassification(db as never, reportId, projectId),
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

interface WatchRow {
  id: string
  project_id: string
  base_url: string
  firecrawl_monitor_id: string | null
  last_check_id: string | null
}

Deno.serve(
  withSentry(async (req: Request) => {
    const authResp = requireServiceRoleAuth(req)
    if (authResp) return authResp
    const db = getServiceClient()

    let only: string | null = null
    if (req.method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as { projectId?: unknown }
      if (typeof body.projectId === 'string') {
        if (!UUID_RE.test(body.projectId)) return json({ ok: false, error: 'projectId must be a uuid' }, 400)
        only = body.projectId
      }
    }

    let q = db
      .from('site_watches')
      .select('id, project_id, base_url, firecrawl_monitor_id, last_check_id')
      .eq('status', 'active')
      .not('firecrawl_monitor_id', 'is', null)
    if (only) q = q.eq('project_id', only)
    const { data: watches, error } = await q
    if (error) {
      plog.error('failed to read site watches', { err: error.message })
      return json({ ok: false, error: { code: 'WATCHES_READ_FAILED', message: 'Could not read the site watches.' } }, 500)
    }

    const results: Array<Record<string, unknown>> = []
    for (const w of (watches ?? []) as WatchRow[]) {
      const line: Record<string, unknown> = { projectId: w.project_id, checks: 0, filed: 0, resolved: 0 }
      try {
        const fc = await resolveFirecrawl(db, w.project_id)
        if (!fc) {
          await db.from('site_watches').update({ last_error: 'No Firecrawl key for this app.' }).eq('id', w.id)
          results.push({ ...line, status: 'no_key' })
          continue
        }
        const checks = await listChecks(fc.key, w.firecrawl_monitor_id!, 10)
        const todo = checksToProcess(checks, w.last_check_id)
        for (const check of todo) {
          const pages = await checkPages(fc.key, w.firecrawl_monitor_id!, check.id)
          const r = await processCheck(db, w, pages, deps)
          line.checks = (line.checks as number) + 1
          line.filed = (line.filed as number) + r.filed
          line.resolved = (line.resolved as number) + r.resolved
          await db
            .from('site_watches')
            .update({
              last_check_id: check.id,
              last_checked_at: check.finishedAt ?? new Date().toISOString(),
              last_summary: { ...(check.summary ?? {}), broken: r.broken, actualCredits: check.actualCredits ?? null },
              last_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', w.id)
        }
        // A skipped or failed newest check is worth showing, not filing.
        const newest = checks[0]
        if (newest && (newest.status === 'failed' || newest.status === 'skipped_no_credits')) {
          await db
            .from('site_watches')
            .update({
              last_error:
                newest.status === 'skipped_no_credits'
                  ? 'The last check was skipped: the Firecrawl account is out of credits.'
                  : `The last check failed: ${newest.error ?? 'no reason given'}`.slice(0, 300),
            })
            .eq('id', w.id)
        }
        results.push({ ...line, status: 'ok' })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const lost = err instanceof FirecrawlMonitorError && err.status === 404
        await db
          .from('site_watches')
          .update(
            lost
              ? { status: 'error', last_error: 'The Firecrawl monitor no longer exists. Turn the watch off and on again.' }
              : { last_error: msg.slice(0, 300) },
          )
          .eq('id', w.id)
        plog.warn('site watch poll failed', { projectId: w.project_id, err: msg.slice(0, 300) })
        results.push({ ...line, status: 'error' })
      }
    }
    return json({ ok: true, data: { watches: results.length, results } })
  }),
)
