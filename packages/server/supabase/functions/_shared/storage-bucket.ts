/**
 * FILE: storage-bucket.ts
 * PURPOSE: Pre-flight existence probe for the Supabase Storage bucket.
 *
 * OVERVIEW:
 * - Asks Storage whether a bucket exists before an upload uses the name
 * - Caches a positive answer for the life of this isolate, a confirmed miss for 60 s
 * - A confirmed miss or a failed probe is a typed error, not a later upload failure
 *
 * DEPENDENCIES:
 * - None. The caller passes a client with storage.getBucket (Supabase JS).
 *
 * USAGE:
 * - storage.ts resolves the bucket for the Supabase adapter and the health check
 * - The storage settings PUT rejects a Supabase bucket name that is not there
 * - Unit tests: packages/server/src/__tests__/storage-bucket.test.ts
 *
 * TECHNICAL DETAILS:
 * - probeSupabaseBucket throws StorageBucketError
 * - chooseSupabaseBucket falls back to the cluster default only on a confirmed miss
 * - preflightSupabaseBucketSetting is the config-save gate (miss rejects; probe
 *   failure does not, so a Storage outage cannot block a settings write)
 *
 * NOTES:
 * - Probe failures are not cached; the save gate and health check bypass the miss cache
 * - This module does not create buckets
 */

export const CLUSTER_DEFAULT_BUCKET = 'screenshots'

export type StorageBucketErrorCode = 'STORAGE_BUCKET_MISSING' | 'STORAGE_BUCKET_PROBE_FAILED'

export class StorageBucketError extends Error {
  readonly code: StorageBucketErrorCode
  readonly bucket: string
  /** True when a miss was answered from the miss cache without a probe. */
  readonly cached: boolean

  constructor(code: StorageBucketErrorCode, bucket: string, message: string, cached = false) {
    super(message)
    this.name = 'StorageBucketError'
    this.code = code
    this.bucket = bucket
    this.cached = cached
  }
}

export interface BucketProbeError {
  message?: string
  status?: number
  statusCode?: string | number
}

export interface BucketProbeClient {
  storage: {
    getBucket: (name: string) => Promise<{
      data: { id?: string; name?: string } | null
      error: BucketProbeError | null
    }>
  }
}

/** Bucket names already confirmed to exist in this isolate. */
const confirmedBuckets = new Set<string>()
/** Confirmed misses, by bucket name, until the expiry timestamp. */
const missingBuckets = new Map<string, number>()
export const BUCKET_MISS_TTL_MS = 60 * 1000

export function clearBucketProbeCache(): void {
  confirmedBuckets.clear()
  missingBuckets.clear()
}

function isMissingBucket(error: BucketProbeError | null): boolean {
  if (!error) return true
  const hasStatus = error.status !== undefined || error.statusCode !== undefined
  if (hasStatus) {
    return error.status === 404 || String(error.statusCode ?? '') === '404'
  }
  return (error.message ?? '').toLowerCase().includes('bucket not found')
}

function isMissCached(bucket: string): boolean {
  const expiresAt = missingBuckets.get(bucket)
  if (expiresAt === undefined) return false
  if (expiresAt > Date.now()) return true
  missingBuckets.delete(bucket)
  return false
}

export interface BucketProbeOptions {
  /** Skip the cached-miss shortcut and ask Storage again. */
  fresh?: boolean
}

/**
 * Confirm `bucket` exists. A cached hit returns without a network call; a
 * cached miss (BUCKET_MISS_TTL_MS) throws without one unless `fresh` is set.
 * Throws StorageBucketError on a miss or when the probe itself fails.
 */
export async function probeSupabaseBucket(
  client: BucketProbeClient,
  bucket: string,
  opts: BucketProbeOptions = {},
): Promise<void> {
  if (confirmedBuckets.has(bucket)) return
  if (!opts.fresh && isMissCached(bucket)) {
    throw new StorageBucketError(
      'STORAGE_BUCKET_MISSING',
      bucket,
      `Storage bucket "${bucket}" does not exist`,
      true,
    )
  }
  let result: { data: { id?: string; name?: string } | null; error: BucketProbeError | null }
  try {
    result = await client.storage.getBucket(bucket)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new StorageBucketError(
      'STORAGE_BUCKET_PROBE_FAILED',
      bucket,
      `Could not verify storage bucket "${bucket}": ${detail}`,
    )
  }
  if (!result || result.error || !result.data) {
    if (!result || isMissingBucket(result.error)) {
      missingBuckets.set(bucket, Date.now() + BUCKET_MISS_TTL_MS)
      throw new StorageBucketError(
        'STORAGE_BUCKET_MISSING',
        bucket,
        `Storage bucket "${bucket}" does not exist`,
      )
    }
    const detail = result.error?.message || 'storage.getBucket failed'
    throw new StorageBucketError(
      'STORAGE_BUCKET_PROBE_FAILED',
      bucket,
      `Could not verify storage bucket "${bucket}": ${detail}`,
    )
  }
  missingBuckets.delete(bucket)
  confirmedBuckets.add(bucket)
}

export interface ChosenSupabaseBucket {
  bucket: string
  /** Set when `configured` was missing and the cluster default was probed clean. */
  missingConfigured?: string
  /** True when that miss came from the miss cache rather than a fresh probe. */
  missCached?: boolean
}

/**
 * Pick the Supabase bucket to use. Blank config uses the cluster default.
 * A configured name that Storage confirms is used as-is (no hardcoded alias).
 * A confirmed miss falls back to the cluster default only after that default
 * itself probes clean. A probe failure is thrown and never treated as "exists".
 */
export async function chooseSupabaseBucket(
  client: BucketProbeClient,
  configured?: string | null,
  opts: BucketProbeOptions = {},
): Promise<ChosenSupabaseBucket> {
  const requested = configured?.trim() ? configured.trim() : CLUSTER_DEFAULT_BUCKET
  try {
    await probeSupabaseBucket(client, requested, opts)
    return { bucket: requested }
  } catch (err) {
    if (
      err instanceof StorageBucketError &&
      err.code === 'STORAGE_BUCKET_MISSING' &&
      requested !== CLUSTER_DEFAULT_BUCKET
    ) {
      await probeSupabaseBucket(client, CLUSTER_DEFAULT_BUCKET, opts)
      return { bucket: CLUSTER_DEFAULT_BUCKET, missingConfigured: requested, missCached: err.cached }
    }
    throw err
  }
}

export type BucketSettingPreflight =
  | { ok: true }
  | { ok: false; code: 'STORAGE_BUCKET_MISSING'; message: string }

/**
 * Config-save gate for a Supabase bucket name. External providers and a blank
 * name skip the probe. A confirmed miss rejects the save. A probe failure
 * allows the save: the runtime probe still runs, and a Storage outage must
 * not block an unrelated settings write.
 */
export async function preflightSupabaseBucketSetting(
  client: BucketProbeClient,
  input: { provider?: string | null; bucket?: string | null },
): Promise<BucketSettingPreflight> {
  if ((input.provider ?? 'supabase') !== 'supabase') return { ok: true }
  const bucket = input.bucket?.trim()
  if (!bucket) return { ok: true }
  try {
    await probeSupabaseBucket(client, bucket, { fresh: true })
    return { ok: true }
  } catch (err) {
    if (err instanceof StorageBucketError && err.code === 'STORAGE_BUCKET_MISSING') {
      return { ok: false, code: 'STORAGE_BUCKET_MISSING', message: err.message }
    }
    return { ok: true }
  }
}
