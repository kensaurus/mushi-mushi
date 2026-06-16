/**
 * FILE: packages/server/supabase/functions/sdk-versions-cron/index.ts
 * PURPOSE: Daily reconciliation of sdk_versions against the npm registry.
 *          Reads the latest stable version for every @mushi-mushi/* package
 *          and upserts into public.sdk_versions so the admin console's SDK
 *          freshness chips stay accurate between hand-authored migrations.
 *
 * Two invocation paths:
 *   1. pg_cron (daily at 02:30 UTC) with the service-role bearer.
 *   2. release.yml post-publish step via the sync-sdk-versions.mjs script
 *      (REST API upsert — this function is the fallback cron, not the primary
 *      publish-time path).
 *
 * Auth: requireServiceRoleAuth — only the pg_cron job and the release step
 * may invoke this function. Never callable by end users.
 */

import { Hono } from 'npm:hono@4'
import { getServiceClient } from '../_shared/db.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { withSentry } from '../_shared/sentry.ts'
import { log as rootLog } from '../_shared/logger.ts'
import {
  fetchAllLatestVersions,
  UPGRADEABLE_PACKAGES,
} from '../_shared/sdk-upgrade-plan.ts'

const log = rootLog.child('sdk-versions-cron')

const app = new Hono()

app.post('/', async (c) => {
  const unauthorized = requireServiceRoleAuth(c.req.raw)
  if (unauthorized) return unauthorized

  const db = getServiceClient()

  log.info('sdk-versions-cron: fetching latest versions from npm registry')

  const latestVersions = await fetchAllLatestVersions()
  const packageNames = Object.keys(latestVersions)

  if (packageNames.length === 0) {
    log.warn('sdk-versions-cron: no versions fetched — npm registry unreachable?')
    return c.json({ ok: false, error: 'Could not fetch versions from npm registry' }, 503)
  }

  log.info('sdk-versions-cron: fetched versions', { count: packageNames.length, latestVersions })

  const rows = packageNames.map((name) => ({
    package: name,
    version: latestVersions[name],
    deprecated: false,
    released_at: new Date().toISOString(),
  }))

  // Upsert — only inserts new rows; updates released_at on conflict.
  const { error } = await db
    .from('sdk_versions')
    .upsert(rows, { onConflict: 'package,version' })

  if (error) {
    log.error('sdk-versions-cron: upsert failed', { error: error.message })
    return c.json({ ok: false, error: error.message }, 500)
  }

  const packagesUpserted = rows.map((r) => `${r.package}@${r.version}`)
  log.info('sdk-versions-cron: upserted', { packages: packagesUpserted })

  return c.json({
    ok: true,
    data: { upserted: packagesUpserted.length, packages: packagesUpserted },
  })
})

Deno.serve(withSentry('sdk-versions-cron', app.fetch))
