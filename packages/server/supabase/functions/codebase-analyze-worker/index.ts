/**
 * HTTP entrypoint for codebase analyze jobs.
 */

import { Hono } from 'npm:hono@4'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { withSentry } from '../_shared/sentry.ts'
import { getServiceClient } from '../_shared/db.ts'
import { runCodebaseAnalyzeJob } from '../_shared/codebase-analyze-runner.ts'

const app = new Hono()

app.post('/', async (c) => {
  const unauthorized = requireServiceRoleAuth(c.req.raw)
  if (unauthorized) return unauthorized

  const body = (await c.req.json().catch(() => ({}))) as { jobId?: string }
  if (!body.jobId) {
    return c.json({ ok: false, error: 'jobId required' }, 400)
  }

  const result = await runCodebaseAnalyzeJob(getServiceClient(), body.jobId)
  if (!result.ok) {
    return c.json({ ok: false, error: result.error, status: result.status }, 500)
  }
  return c.json({ ok: true, data: result })
})

Deno.serve(withSentry('codebase-analyze-worker', app.fetch))
