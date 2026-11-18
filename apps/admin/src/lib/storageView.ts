/**
 * FILE: apps/admin/src/lib/storageView.ts
 * PURPOSE: Pure view logic for Team › Storage (round-2 review 2026-11-18):
 *          a failing bucket leads the page as its own row (it was the last
 *          clause of a calm sentence), the per-app list sorts problems first,
 *          the form shows only the fields the chosen provider uses, and the
 *          usage table sorts by screenshots with zero rows last.
 */

type StorageProvider = 'supabase' | 's3' | 'r2' | 'gcs' | 'minio'
export type StorageHealth = 'unknown' | 'healthy' | 'degraded' | 'failing'

export interface StorageRowLike {
  project_id: string
  provider: StorageProvider
  health_status: StorageHealth
  last_health_check_at: string | null
  last_health_error: string | null
  region?: string | null
  endpoint?: string | null
  kms_key_id?: string | null
  access_key_vault_ref?: string | null
  secret_key_vault_ref?: string | null
}

export interface StorageProblem {
  projectId: string
  name: string
  status: 'failing' | 'degraded'
  error: string | null
  checkedAt: string | null
}

/** Saved buckets that failed or are having trouble: failing first, then by name. */
export function storageProblems(settings: readonly StorageRowLike[], nameOf: (projectId: string) => string): StorageProblem[] {
  return settings
    .filter((s): s is StorageRowLike & { health_status: 'failing' | 'degraded' } => s.health_status === 'failing' || s.health_status === 'degraded')
    .map((s) => ({
      projectId: s.project_id,
      name: nameOf(s.project_id),
      status: s.health_status,
      error: s.last_health_error,
      checkedAt: s.last_health_check_at,
    }))
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'failing' ? -1 : 1))
}

/**
 * Rank for the per-app list: failing, having trouble, saved but never
 * checked, working, then apps still on the built-in storage.
 */
function storageRank(row: { existing: boolean; health_status: StorageHealth }): number {
  if (!row.existing) return 4
  switch (row.health_status) {
    case 'failing':
      return 0
    case 'degraded':
      return 1
    case 'unknown':
      return 2
    default:
      return 3
  }
}

export function sortStorageCards<T extends { existing: boolean; setting: { health_status: StorageHealth } }>(
  cards: readonly T[],
  nameOf: (card: T) => string,
): T[] {
  return [...cards].sort(
    (a, b) =>
      storageRank({ existing: a.existing, health_status: a.setting.health_status }) -
        storageRank({ existing: b.existing, health_status: b.setting.health_status }) ||
      nameOf(a).localeCompare(nameOf(b)),
  )
}

export interface StorageFieldSet {
  region: boolean
  endpoint: boolean
  accessKeys: boolean
  serviceAccount: boolean
  kms: boolean
}

/**
 * Which fields the provider uses. Supabase Storage (the default) needs none of
 * the S3 fields. A field that already holds a saved value always shows, so
 * nothing stored is ever hidden from the person who saved it.
 */
export function storageFieldsFor(row: Pick<StorageRowLike, 'provider' | 'region' | 'endpoint' | 'kms_key_id' | 'access_key_vault_ref' | 'secret_key_vault_ref'>): StorageFieldSet {
  const p = row.provider
  const base: StorageFieldSet = {
    region: p === 's3' || p === 'r2' || p === 'minio',
    endpoint: p === 's3' || p === 'r2' || p === 'minio',
    accessKeys: p === 's3' || p === 'r2' || p === 'minio',
    serviceAccount: p === 'gcs',
    kms: p === 's3' || p === 'gcs',
  }
  return {
    ...base,
    region: base.region || Boolean(row.region),
    endpoint: base.endpoint || Boolean(row.endpoint),
    accessKeys: base.accessKeys || Boolean(row.access_key_vault_ref) || Boolean(row.secret_key_vault_ref),
    kms: base.kms || Boolean(row.kms_key_id),
  }
}

/** Usage rows: most screenshots first, then by name; zero rows sink to the end. */
export function sortUsageRows<T extends { name: string; objects: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.objects - a.objects || a.name.localeCompare(b.name))
}

/** A health check older than a week is called out, not shown as current. */
const STORAGE_CHECK_STALE_MS = 7 * 24 * 60 * 60 * 1000

export function isStaleCheck(checkedAt: string | null, now: number = Date.now()): boolean {
  if (!checkedAt) return false
  const t = Date.parse(checkedAt)
  return Number.isFinite(t) && now - t > STORAGE_CHECK_STALE_MS
}
