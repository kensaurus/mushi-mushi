/**
 * HTTP entrypoint for SDK upgrade jobs. Primary execution path is inline
 * from the api route (`runSdkUpgradeJob`); this function remains for
 * pg_cron sweeper retries and manual re-invocation.
 */

import { Hono } from 'npm:hono@4'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { withSentry } from '../_shared/sentry.ts'
import { runSdkUpgradeJob } from '../_shared/sdk-upgrade-runner.ts'

const app = new Hono()

app.post('/', async (c) => {
  const unauthorized = requireServiceRoleAuth(c.req.raw)
  if (unauthorized) return unauthorized

  const body = (await c.req.json().catch(() => ({}))) as { jobId?: string }
  if (!body.jobId) {
    return c.json({ ok: false, error: 'jobId required' }, 400)
  }

  const result = await runSdkUpgradeJob(body.jobId)
  if (!result.ok) {
    const status = result.status === 'skipped' ? 404 : 500
    return c.json({ ok: false, error: result.error }, status)
  }

  return c.json({ ok: true, data: { status: result.status, prUrl: result.prUrl } })
})

Deno.serve(withSentry('sdk-upgrade-worker', app.fetch))
