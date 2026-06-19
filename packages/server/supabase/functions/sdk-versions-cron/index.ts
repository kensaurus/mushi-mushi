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
import { fetchAllLatestVersions } from '../_shared/sdk-upgrade-plan.ts'
import { compareSemver } from '../_shared/sdk-version-compare.ts'
import { shouldQuarantineCatalogVersion } from '../_shared/sdk-catalog-guard.ts'

const log = rootLog.child('sdk-versions-cron')

const app = new Hono()
// Supabase serves this function at `/functions/v1/sdk-versions-cron`; Hono sees
// the path WITH the function name, so routes MUST be prefixed with it (mirrors
// `library-modernizer` / `prompt-auto-tune` and the api function's
// `.basePath('/api')`). A bare `'/'` route silently 404s the daily pg_cron job,
// which is why the catalogue went stale between hand-authored migrations.
app.get('/sdk-versions-cron/health', (c) => c.json({ ok: true }))

app.post('/sdk-versions-cron', async (c) => {
  const unauthorized = requireServiceRoleAuth(c.req.raw)
  if (unauthorized) return unauthorized

  const startedAt = Date.now()
  const db = getServiceClient()

  log.info('sdk-versions-cron: fetching latest versions from npm registry')

  const latestVersions = await fetchAllLatestVersions()
  const packageNames = Object.keys(latestVersions)

  if (packageNames.length === 0) {
    log.warn('sdk-versions-cron: no versions fetched — npm registry unreachable?')
    return c.json({ ok: false, error: 'Could not fetch versions from npm registry' }, 503)
  }

  const { data: catalogRows } = await db
    .from('sdk_versions')
    .select('package, version')

  const maxVersionByPackage: Record<string, string> = {}
  for (const row of catalogRows ?? []) {
    const existing = maxVersionByPackage[row.package]
    if (!existing || compareSemver(row.version, existing) > 0) {
      maxVersionByPackage[row.package] = row.version
    }
  }

  const acceptedRows: Array<{ package: string; version: string; deprecated: boolean; released_at: string }> = []
  const rejected: string[] = []

  for (const name of packageNames) {
    const version = latestVersions[name]
    if (shouldQuarantineCatalogVersion(name, version, maxVersionByPackage[name] ?? null)) {
      rejected.push(`${name}@${version}`)
      continue
    }
    acceptedRows.push({
      package: name,
      version,
      deprecated: false,
      released_at: new Date().toISOString(),
    })
  }

  log.info('sdk-versions-cron: fetched versions', {
    count: packageNames.length,
    accepted: acceptedRows.length,
    rejected: rejected.length,
  })

  if (acceptedRows.length > 0) {
    const { error } = await db
      .from('sdk_versions')
      .upsert(acceptedRows, { onConflict: 'package,version' })

    if (error) {
      log.error('sdk-versions-cron: upsert failed', { error: error.message })
      return c.json({ ok: false, error: error.message }, 500)
    }
  }

  const packagesUpserted = acceptedRows.map((r) => `${r.package}@${r.version}`)
  const durationMs = Date.now() - startedAt
  log.info('sdk-versions-cron: upserted', { packages: packagesUpserted, durationMs, rejected })

  return c.json({
    ok: true,
    data: {
      upserted: packagesUpserted.length,
      rejected: rejected.length,
      duration_ms: durationMs,
      packages: packagesUpserted,
      quarantined: rejected,
    },
  })
})

Deno.serve(withSentry('sdk-versions-cron', app.fetch))
