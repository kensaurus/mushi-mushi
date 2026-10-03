// ============================================================
// store-review-intake — App Store and Google Play reviews become
// Mushi reports (gap #23, Plan 020 §5).
//
// Trigger: pg_cron every 6 hours at :45 (migration 20261003180100), and
//          POST {"projectId": "<uuid>"} from an internal caller.
// Auth:    requireServiceRoleAuth (internal only).
//
// Only projects that switched the intake on
// (project_settings.store_review_intake_enabled) are read. Each review is
// filed at most once; only reviews at or under the project's star threshold
// (default 2) become reports. See _shared/store-review-intake.ts.
// ============================================================

import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { projectsDueForStoreReviews, runStoreReviewIntake, type StoreIntakeDeps } from '../_shared/store-review-intake.ts'
import { queueReportClassification } from '../_shared/report-classification.ts'

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
}

const ilog = log.child('store-review-intake')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const liveDeps: StoreIntakeDeps = {
  fetch: (url, init) => fetch(url, init),
  now: () => new Date(),
  classify: (db, reportId, projectId) => queueReportClassification(db as never, reportId, projectId),
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export async function handler(req: Request): Promise<Response> {
  const authResp = requireServiceRoleAuth(req)
  if (authResp) return authResp
  const db = getServiceClient()

  let only: string | null = null
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({})) as { projectId?: unknown }
    if (typeof body.projectId === 'string') {
      if (!UUID_RE.test(body.projectId)) return json({ ok: false, error: 'projectId must be a uuid' }, 400)
      only = body.projectId
    }
  }

  let projectIds: string[]
  try {
    projectIds = await projectsDueForStoreReviews(db, only)
  } catch (err) {
    // The cause goes to the log; the caller gets a stable code and a fixed message.
    ilog.error('failed to read the projects to pull', { err: String((err as Error)?.message ?? err).slice(0, 300) })
    return json({ ok: false, error: { code: 'PROJECTS_READ_FAILED', message: 'Could not read the projects to pull.' } }, 500)
  }

  const results: Array<{ projectId: string; status: string; filed: number }> = []
  for (const projectId of projectIds) {
    try {
      const r = await runStoreReviewIntake(db, projectId, liveDeps)
      results.push({ projectId, status: r.status, filed: r.filed })
    } catch (err) {
      const message = String((err as Error)?.message ?? err).slice(0, 300)
      ilog.error('store review intake failed', { projectId, err: message })
      results.push({ projectId, status: 'failed', filed: 0 })
    }
  }
  return json({ ok: true, data: { projects: results.length, results } })
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('store-review-intake', handler))
}
