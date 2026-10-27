/**
 * ci-cost-fix-worker — Supabase Edge Function (verify_jwt = false, internal)
 *
 * Runs one CI cost "Open fix PR" job (ADR 0047): reads the workflow file,
 * applies the edit (`_shared/ci-cost-fix.ts`), records the workflow's billed
 * minutes for the 14 days before, and opens a draft PR
 * (`_shared/ci-cost-fix-runner.ts`). POST /v1/admin/ci/cost-fixes fires it
 * with `{ jobId }`; a GET of a job still queued after two minutes fires it
 * again, and a run that died while `running` is reclaimed after 10 minutes.
 *
 * With `{ bundleId }` it runs a bundle instead: several fixes for one repo in
 * ONE draft PR (`_shared/ci-cost-fix-bundle.ts`, POST
 * /v1/admin/ci/cost-fix-bundles, "Apply to every app"). A job that belongs to
 * a bundle is never run on its own.
 *
 * Auth: `requireServiceRoleAuth`.
 */

import { Hono } from 'npm:hono@4'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { getServiceClient } from '../_shared/db.ts'
import { withSentry } from '../_shared/sentry.ts'
import { runCiCostFixJob } from '../_shared/ci-cost-fix-runner.ts'
import { runCiCostFixBundle } from '../_shared/ci-cost-fix-bundle.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const app = new Hono()

// Supabase serves this function at `/functions/v1/ci-cost-fix-worker`, and
// Hono sees the path with the function name (see sdk-upgrade-worker).
app.get('/ci-cost-fix-worker/health', (c) => c.json({ ok: true }))

app.post('/ci-cost-fix-worker', async (c) => {
  const unauthorized = requireServiceRoleAuth(c.req.raw)
  if (unauthorized) return unauthorized

  const body = (await c.req.json().catch(() => ({}))) as { jobId?: unknown; bundleId?: unknown }
  if (typeof body.bundleId === 'string') {
    if (!UUID_RE.test(body.bundleId)) return c.json({ ok: false, error: 'bundleId must be a uuid' }, 400)
    const result = await runCiCostFixBundle(getServiceClient(), body.bundleId)
    if (!result.ok) {
      return c.json({ ok: false, error: result.error, ...('code' in result ? { code: result.code, data: { items: result.items } } : {}) }, result.status === 'skipped' ? 409 : 200)
    }
    return c.json({ ok: true, data: result })
  }
  const jobId = typeof body.jobId === 'string' ? body.jobId : ''
  if (!UUID_RE.test(jobId)) return c.json({ ok: false, error: 'jobId or bundleId (uuid) required' }, 400)

  const result = await runCiCostFixJob(getServiceClient(), jobId)
  if (!result.ok) {
    return c.json({ ok: false, error: result.error, ...('code' in result ? { code: result.code } : {}) }, result.status === 'skipped' ? 409 : 200)
  }
  return c.json({ ok: true, data: result })
})

Deno.serve(withSentry('ci-cost-fix-worker', app.fetch))
