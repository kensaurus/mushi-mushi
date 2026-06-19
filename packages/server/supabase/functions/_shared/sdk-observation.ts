/**
 * FILE: packages/server/supabase/functions/_shared/sdk-observation.ts
 * PURPOSE: Curated SDK version observation layer — replaces the fragile
 *          "latest report by created_at" heuristic with an idempotent
 *          upsert surface fed by reports, heartbeats, repo scans, and
 *          post-upgrade verification.
 */

import type { getServiceClient } from './db.ts'
import { compareSemver } from './sdk-version-compare.ts'
import { UPGRADEABLE_PACKAGES } from './sdk-upgrade-plan.ts'
import { log as rootLog } from './logger.ts'

const log = rootLog.child('sdk-observation')

export const SDK_SEED_VERSION = 'seed'

export type SdkObservationSource = 'report' | 'heartbeat' | 'repo_scan' | 'upgrade_verify'

export interface SdkObservationRow {
  project_id: string
  sdk_package: string
  sdk_version: string
  source: SdkObservationSource
  observed_at: string
}

export interface StampedSdkReportRow {
  project_id: string
  created_at: string | null
  sdk_package: string | null
  sdk_version: string | null
}

export interface ResolvedProjectSdk {
  sdk_package: string | null
  sdk_version: string | null
  sdk_observation_source: SdkObservationSource | 'report_fallback' | null
}

const SAFE_SEMVER = /^\d+\.\d+\.\d+(-[\w.]+)?$/
const UPGRADEABLE_SET = new Set<string>(UPGRADEABLE_PACKAGES)

/** QA seed sentinel and other non-semver placeholders must not drive freshness. */
export function isValidSdkObservation(
  sdkPackage: string | null | undefined,
  sdkVersion: string | null | undefined,
): boolean {
  if (!sdkPackage || !sdkVersion) return false
  if (sdkVersion === SDK_SEED_VERSION) return false
  if (!sdkPackage.startsWith('@mushi-mushi/')) return false
  if (!UPGRADEABLE_SET.has(sdkPackage)) return false
  return SAFE_SEMVER.test(sdkVersion)
}

export function shouldReplaceObservation(
  existing: { sdk_version: string; observed_at: string } | null,
  incoming: { sdk_version: string; observed_at: string },
): boolean {
  if (!existing) return true
  const existingTs = Date.parse(existing.observed_at)
  const incomingTs = Date.parse(incoming.observed_at)
  if (Number.isFinite(incomingTs) && Number.isFinite(existingTs)) {
    if (incomingTs > existingTs) return true
    if (incomingTs < existingTs) return false
  }
  return compareSemver(incoming.sdk_version, existing.sdk_version) > 0
}

/**
 * Per-project most recent stamped report. Skips unstamped rows (admin test
 * reports, legacy ingest) so a NULL sdk_version on the newest report cannot
 * mask a valid older observation.
 */
export async function fetchLatestStampedSdkReports(
  db: ReturnType<typeof getServiceClient>,
  projectIds: string[],
): Promise<StampedSdkReportRow[]> {
  if (projectIds.length === 0) return []

  return Promise.all(
    projectIds.map((pid) =>
      db
        .from('reports')
        .select('created_at, sdk_package, sdk_version')
        .eq('project_id', pid)
        .not('sdk_package', 'is', null)
        .not('sdk_version', 'is', null)
        .neq('sdk_version', SDK_SEED_VERSION)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then((r) => ({
          project_id: pid,
          created_at: r.data?.created_at ?? null,
          sdk_package: (r.data as { sdk_package?: string | null } | null)?.sdk_package ?? null,
          sdk_version: (r.data as { sdk_version?: string | null } | null)?.sdk_version ?? null,
        })),
    ),
  )
}

/** Latest report by created_at (any report) — used for last_report_at freshness only. */
export async function fetchLatestReportTimestamps(
  db: ReturnType<typeof getServiceClient>,
  projectIds: string[],
): Promise<Array<{ project_id: string; created_at: string | null }>> {
  if (projectIds.length === 0) return []

  return Promise.all(
    projectIds.map((pid) =>
      db
        .from('reports')
        .select('created_at')
        .eq('project_id', pid)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then((r) => ({
          project_id: pid,
          created_at: r.data?.created_at ?? null,
        })),
    ),
  )
}

export async function fetchProjectSdkObservations(
  db: ReturnType<typeof getServiceClient>,
  projectIds: string[],
): Promise<SdkObservationRow[]> {
  if (projectIds.length === 0) return []

  const { data, error } = await db
    .from('project_sdk_observations')
    .select('project_id, sdk_package, sdk_version, source, observed_at')
    .in('project_id', projectIds)

  if (error) {
    log.warn('fetchProjectSdkObservations failed', { errMsg: error.message })
    return []
  }

  return (data ?? []) as SdkObservationRow[]
}

export function resolveProjectSdkIdentity(
  observation: SdkObservationRow | undefined,
  stamped: StampedSdkReportRow | undefined,
): ResolvedProjectSdk {
  if (observation && isValidSdkObservation(observation.sdk_package, observation.sdk_version)) {
    return {
      sdk_package: observation.sdk_package,
      sdk_version: observation.sdk_version,
      sdk_observation_source: observation.source,
    }
  }

  if (stamped && isValidSdkObservation(stamped.sdk_package, stamped.sdk_version)) {
    return {
      sdk_package: stamped.sdk_package,
      sdk_version: stamped.sdk_version,
      sdk_observation_source: 'report_fallback',
    }
  }

  return { sdk_package: null, sdk_version: null, sdk_observation_source: null }
}

/** Idempotent upsert — only advances when newer or higher semver at same timestamp. */
export async function upsertProjectSdkObservation(
  db: ReturnType<typeof getServiceClient>,
  input: {
    projectId: string
    sdkPackage: string
    sdkVersion: string
    source: SdkObservationSource
    observedAt?: string
  },
): Promise<void> {
  const { projectId, sdkPackage, sdkVersion, source } = input
  if (!isValidSdkObservation(sdkPackage, sdkVersion)) return

  const observedAt = input.observedAt ?? new Date().toISOString()

  const { data: existing } = await db
    .from('project_sdk_observations')
    .select('sdk_version, observed_at')
    .eq('project_id', projectId)
    .maybeSingle()

  if (
    existing &&
    !shouldReplaceObservation(
      existing as { sdk_version: string; observed_at: string },
      { sdk_version: sdkVersion, observed_at: observedAt },
    )
  ) {
    return
  }

  const { error } = await db.from('project_sdk_observations').upsert(
    {
      project_id: projectId,
      sdk_package: sdkPackage,
      sdk_version: sdkVersion,
      source,
      observed_at: observedAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'project_id' },
  )

  if (error) {
    log.warn('upsertProjectSdkObservation failed', {
      projectId,
      sdkPackage,
      sdkVersion,
      source,
      errMsg: error.message,
    })
  }
}

/** Fire-and-forget wrapper for hot paths (heartbeat, ingest). */
export function upsertProjectSdkObservationAsync(
  db: ReturnType<typeof getServiceClient>,
  input: Parameters<typeof upsertProjectSdkObservation>[1],
): void {
  void upsertProjectSdkObservation(db, input).catch((err: unknown) => {
    log.warn('upsertProjectSdkObservation async failed', { err: String(err) })
  })
}
