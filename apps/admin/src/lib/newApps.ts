/**
 * FILE: apps/admin/src/lib/newApps.ts
 * PURPOSE: Tell a just-made app that has not checked in yet (setup left to
 *          do) from one that should have and did not (something to fix), so
 *          creating an app is not greeted with a warning.
 */

/** An app this young without an SDK heartbeat is still being set up. @internal */
export const NEW_APP_MS = 24 * 60 * 60 * 1000

/**
 * True when every app missing an SDK heartbeat is younger than a day. The
 * list may be capped, so a count above its length is never "all new".
 */
export function missingAppsAreNew(
  missing: ReadonlyArray<{ createdAt?: string | null }> | undefined,
  missingCount: number | undefined,
  now: number = Date.now(),
): boolean {
  if (!missing || missing.length === 0) return false
  if ((missingCount ?? missing.length) > missing.length) return false
  return missing.every((p) => {
    const t = p.createdAt ? Date.parse(p.createdAt) : NaN
    return Number.isFinite(t) && now - t < NEW_APP_MS
  })
}

type HeaderTone = 'ok' | 'warn' | 'danger' | 'brand' | 'info' | 'neutral'

/** The fields of GET /v1/admin/projects/stats the Manage apps header reads. */
interface HeaderStats {
  topPriority: string
  projectCount: number
  neverIngestedCount: number
  sdkMissingProjects?: ReadonlyArray<{ createdAt?: string | null }>
  sdkMissingCount?: number
}

/**
 * The Manage apps header chip and its tone. A just-made app still being set
 * up reads "Setting up" in info, so the chip agrees with the banner instead
 * of warning "No heartbeat" (live journey 2026-10-30).
 */
export function projectsHeaderStatus(stats: HeaderStats, now: number = Date.now()): { label: string; tone: HeaderTone } {
  const p = stats.topPriority
  const settingUp = p !== 'healthy' && p !== 'partial_ingest' && missingAppsAreNew(stats.sdkMissingProjects, stats.sdkMissingCount, now)
  if (settingUp) return { label: 'SETTING UP', tone: 'info' }
  const tone: HeaderTone =
    p === 'never_ingested' || p === 'no_sdk_heartbeat' ? 'warn'
      : p === 'healthy' ? 'ok'
        : p === 'no_projects' ? 'brand'
          : p === 'partial_ingest' ? 'info'
            : 'neutral'
  const label =
    p === 'healthy' ? 'INGESTING'
      : p === 'never_ingested' ? 'NO INGEST'
        : p === 'no_sdk_heartbeat' ? 'NO HEARTBEAT'
          : p === 'partial_ingest' ? `${stats.neverIngestedCount} STALE`
            : stats.projectCount === 0 ? 'EMPTY'
              : 'SETUP'
  return { label, tone }
}
