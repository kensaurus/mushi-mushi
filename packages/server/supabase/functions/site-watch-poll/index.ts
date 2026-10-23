// ============================================================
// site-watch-poll — read the live-site watches' finished checks and
// file broken pages as reports (ADR 0024).
//
// Trigger: pg_cron hourly at :14 (migration 20261010190000), and
//          POST {"projectId": "<uuid>"} from the api after "Check now".
// Auth:    requireServiceRoleAuth (internal only).
//
// Firecrawl runs each watch's crawl on its own schedule and bills the
// project's Firecrawl key. For each active watch this function reads the
// checks finished since the last one read, oldest first, and records each
// broken page as a suspect. Then it settles every watch's suspects in
// parallel: a confirm scrape on the project's own key (at most
// CONFIRM_SCRAPES_PER_RUN per run shared fairly across watches, 1 credit
// each, none on the platform env key, none that could overrun the run
// deadline) or a second failing check decides whether a suspect files
// (ADR 0029). Settling runs on every poll, so a suspect is retried hourly.
// See _shared/site-watch.ts.
// ============================================================

import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { resolveFirecrawl } from '../_shared/firecrawl.ts'
import { queueReportClassification } from '../_shared/report-classification.ts'
import {
  allocateConfirms,
  checkPages,
  checksToProcess,
  CONFIRM_RUN_DEADLINE_MS,
  CONFIRM_SCRAPES_PER_RUN,
  confirmScrape,
  FirecrawlMonitorError,
  getMonitor,
  listChecks,
  monitorNeedsReconcile,
  pendingConfirmsByWatch,
  processCheck,
  settleSuspects,
  updateMonitor,
  type ConfirmBudget,
  type ProcessDeps,
} from '../_shared/site-watch.ts'

const plog = log.child('site-watch-poll')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const deps: ProcessDeps = {
  now: () => new Date(),
  classify: (db, reportId, projectId) => queueReportClassification(db as never, reportId, projectId),
}

/** last_error is shown on the console card: a sentence, never a code. */
function pollErrorSentence(msg: string): string {
  if (msg === 'FIRECRAWL_AUTH_FAILED') return 'Firecrawl rejected the key. Check it in Settings → AI keys.'
  if (msg === 'FIRECRAWL_NO_CREDITS') return 'The Firecrawl account is out of credits.'
  if (msg === 'FIRECRAWL_RATE_LIMITED') return 'Firecrawl was rate-limiting the key; the next hourly read retries.'
  return 'Mushi could not read the last check; the next hourly read retries.'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

interface WatchRow {
  id: string
  project_id: string
  base_url: string
  page_limit: number
  schedule_cron: string
  firecrawl_monitor_id: string | null
  last_check_id: string | null
}

Deno.serve(
  withSentry('site-watch-poll', async (req: Request) => {
    const runStart = Date.now()
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
      .select('id, project_id, base_url, page_limit, schedule_cron, firecrawl_monitor_id, last_check_id')
      .eq('status', 'active')
      .not('firecrawl_monitor_id', 'is', null)
    if (only) q = q.eq('project_id', only)
    const { data: watches, error } = await q
    if (error) {
      plog.error('failed to read site watches', { err: error.message })
      return json({ ok: false, error: { code: 'WATCHES_READ_FAILED', message: 'Could not read the site watches.' } }, 500)
    }

    const results: Array<Record<string, unknown>> = []
    // Watches whose checks were read; they are settled after every watch is read.
    const ready: Array<{ w: WatchRow; line: Record<string, unknown>; confirmKey: string | null }> = []
    for (const w of (watches ?? []) as WatchRow[]) {
      const line: Record<string, unknown> = { projectId: w.project_id, checks: 0, filed: 0, resolved: 0, confirmScrapes: 0, dismissed: 0 }
      try {
        const fc = await resolveFirecrawl(db, w.project_id)
        if (!fc) {
          await db.from('site_watches').update({ last_error: 'No Firecrawl key for this app.' }).eq('id', w.id)
          results.push({ ...line, status: 'no_key' })
          continue
        }
        // Keep the live monitor on the current config (today: the site-watch
        // User-Agent), so a change to monitorBody reaches watches created
        // before it without anyone re-saving them. Reading results still
        // runs if this fails; the next hourly poll retries.
        try {
          const live = await getMonitor(fc.key, w.firecrawl_monitor_id!)
          if (monitorNeedsReconcile(live)) {
            await updateMonitor(fc.key, w.firecrawl_monitor_id!, {
              name: live.name ?? `Mushi live-site watch: ${w.base_url}`,
              baseUrl: w.base_url,
              pageLimit: w.page_limit,
              scheduleCron: w.schedule_cron,
            })
            line.reconciled = true
          }
        } catch (err) {
          if (err instanceof FirecrawlMonitorError && err.status === 404) throw err
          plog.warn('site watch reconcile failed', {
            projectId: w.project_id,
            err: (err instanceof Error ? err.message : String(err)).slice(0, 300),
          })
        }
        const checks = await listChecks(fc.key, w.firecrawl_monitor_id!, 10)
        const todo = checksToProcess(checks, w.last_check_id)
        for (const check of todo) {
          const pages = await checkPages(fc.key, w.firecrawl_monitor_id!, check.id)
          const r = await processCheck(db, w, pages, deps, check.id)
          line.checks = (line.checks as number) + 1
          line.resolved = (line.resolved as number) + r.resolved
          await db
            .from('site_watches')
            .update({
              last_check_id: check.id,
              last_checked_at: check.finishedAt ?? new Date().toISOString(),
              last_summary: {
                ...(check.summary ?? {}),
                broken: r.broken,
                suspects: r.suspects,
                actualCredits: check.actualCredits ?? null,
              },
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
        // Confirm scrapes bill the project's own key (own or shared, ADR
        // 0023), never the platform's FIRECRAWL_API_KEY fallback.
        ready.push({ w, line, confirmKey: fc.source === 'byok' ? fc.key : null })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const lost = err instanceof FirecrawlMonitorError && err.status === 404
        await db
          .from('site_watches')
          .update(
            lost
              ? {
                  status: 'error',
                  last_error:
                    'Firecrawl no longer finds this watch. If you switched to a key from a different Firecrawl account, ' +
                    'delete the old monitor in that account; then press Change and Save to start a new one.',
                }
              : { last_error: pollErrorSentence(msg) },
          )
          .eq('id', w.id)
        plog.warn('site watch poll failed', { projectId: w.project_id, err: msg.slice(0, 300) })
        results.push({ ...line, status: 'error' })
      }
    }

    // Settle every read watch, new check or not, so a suspect left
    // unconfirmed (budget, a Firecrawl hiccup) is retried within the hour.
    // The run's confirm scrapes are shared fairly (oldest pending suspect
    // first, one per watch before any gets a second), and all watches settle
    // in parallel so every confirm can finish by the run deadline.
    const now = new Date()
    let allocation = new Map<string, number>()
    try {
      const confirmable = ready.filter((r) => r.confirmKey).map((r) => r.w)
      allocation = allocateConfirms(await pendingConfirmsByWatch(db, confirmable, now), CONFIRM_SCRAPES_PER_RUN)
    } catch (err) {
      plog.warn('site watch confirm allocation failed', { err: String(err).slice(0, 300) })
    }
    await Promise.all(
      ready.map(async ({ w, line, confirmKey }) => {
        const budget: ConfirmBudget = {
          remaining: confirmKey ? (allocation.get(w.id) ?? 0) : 0,
          deadline: runStart + CONFIRM_RUN_DEADLINE_MS,
        }
        try {
          const settled = await settleSuspects(db, w, {
            ...deps,
            confirm: (url) =>
              confirmKey ? confirmScrape(confirmKey, url) : Promise.resolve({ kind: 'unavailable', reason: 'NO_PROJECT_KEY' }),
            budget,
            canConfirm: confirmKey !== null,
          })
          results.push({ ...line, filed: settled.filed, confirmScrapes: settled.scrapes, dismissed: settled.dismissed, status: 'ok' })
        } catch (err) {
          plog.warn('site watch settle failed', { projectId: w.project_id, err: String(err).slice(0, 300) })
          results.push({ ...line, status: 'error' })
        }
      }),
    )
    return json({ ok: true, data: { watches: results.length, results } })
  }),
)
