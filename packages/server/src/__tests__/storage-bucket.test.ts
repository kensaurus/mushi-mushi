/**
 * FILE: storage-bucket.test.ts
 * PURPOSE: Bucket existence probe used before a Supabase Storage upload.
 *
 * OVERVIEW:
 * - Present bucket is cached for the isolate
 * - A missing bucket is a typed STORAGE_BUCKET_MISSING error, cached for the miss TTL
 * - A thrown or 5xx probe is STORAGE_BUCKET_PROBE_FAILED and is not cached
 * - A missing configured name falls back only after the cluster default probes clean
 *
 * DEPENDENCIES:
 * - vitest
 * - _shared/storage-bucket.ts
 *
 * USAGE:
 * - pnpm --filter @mushi-mushi/server exec vitest run src/__tests__/storage-bucket.test.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BUCKET_MISS_TTL_MS,
  chooseSupabaseBucket,
  clearBucketProbeCache,
  preflightSupabaseBucketSetting,
  probeSupabaseBucket,
  StorageBucketError,
  type BucketProbeClient,
  type BucketProbeError,
} from '../../supabase/functions/_shared/storage-bucket.ts'

type ProbeResult = {
  data: { id?: string; name?: string } | null
  error: BucketProbeError | null
}

function client(getBucket: (name: string) => Promise<ProbeResult> | ProbeResult): BucketProbeClient {
  return { storage: { getBucket: (name) => Promise.resolve(getBucket(name)) } }
}

describe('probeSupabaseBucket', () => {
  beforeEach(() => clearBucketProbeCache())

  it('caches a bucket that exists and skips the next probe', async () => {
    const getBucket = vi.fn(async () => ({ data: { name: 'screenshots' }, error: null }))
    const c = client(getBucket)
    await probeSupabaseBucket(c, 'screenshots')
    await probeSupabaseBucket(c, 'screenshots')
    expect(getBucket).toHaveBeenCalledTimes(1)
    expect(getBucket).toHaveBeenCalledWith('screenshots')
  })

  afterEach(() => vi.useRealTimers())

  it('throws STORAGE_BUCKET_MISSING for a 404 and caches the miss for the TTL', async () => {
    vi.useFakeTimers()
    const getBucket = vi.fn(async () => ({
      data: null,
      error: { message: 'Bucket not found', status: 400, statusCode: '404' },
    }))
    const c = client(getBucket)
    await expect(probeSupabaseBucket(c, 'nope')).rejects.toMatchObject({
      name: 'StorageBucketError',
      code: 'STORAGE_BUCKET_MISSING',
      bucket: 'nope',
      message: 'Storage bucket "nope" does not exist',
      cached: false,
    })
    await expect(probeSupabaseBucket(c, 'nope')).rejects.toMatchObject({
      code: 'STORAGE_BUCKET_MISSING',
      cached: true,
    })
    expect(getBucket).toHaveBeenCalledTimes(1)

    await expect(probeSupabaseBucket(c, 'nope', { fresh: true })).rejects.toBeInstanceOf(StorageBucketError)
    expect(getBucket).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(BUCKET_MISS_TTL_MS + 1)
    await expect(probeSupabaseBucket(c, 'nope')).rejects.toMatchObject({ cached: false })
    expect(getBucket).toHaveBeenCalledTimes(3)
  })

  it('a fresh probe that finds the bucket clears a cached miss', async () => {
    let exists = false
    const getBucket = vi.fn(async (name: string) =>
      exists ? { data: { name }, error: null } : { data: null, error: { message: 'Bucket not found', status: 404 } },
    )
    const c = client(getBucket)
    await expect(probeSupabaseBucket(c, 'late')).rejects.toBeInstanceOf(StorageBucketError)
    exists = true
    await probeSupabaseBucket(c, 'late', { fresh: true })
    await probeSupabaseBucket(c, 'late')
    expect(getBucket).toHaveBeenCalledTimes(2)
  })

  it('a fresh probe re-checks a confirmed bucket and drops it from the cache when it is gone', async () => {
    let exists = true
    const getBucket = vi.fn(async (name: string) =>
      exists ? { data: { name }, error: null } : { data: null, error: { message: 'Bucket not found', status: 404 } },
    )
    const c = client(getBucket)
    await probeSupabaseBucket(c, 'deleted-later')
    exists = false
    await expect(probeSupabaseBucket(c, 'deleted-later', { fresh: true })).rejects.toMatchObject({
      code: 'STORAGE_BUCKET_MISSING',
    })
    await expect(probeSupabaseBucket(c, 'deleted-later')).rejects.toMatchObject({
      code: 'STORAGE_BUCKET_MISSING',
      cached: true,
    })
    expect(getBucket).toHaveBeenCalledTimes(2)
  })

  it('treats a 400 "Bucket not found" without statusCode 404 as a miss', async () => {
    const noStatusCode = vi.fn(async () => ({ data: null, error: { message: 'Bucket not found', status: 400 } }))
    await expect(probeSupabaseBucket(client(noStatusCode), 'd')).rejects.toMatchObject({
      code: 'STORAGE_BUCKET_MISSING',
    })
    const noSuchBucket = vi.fn(async () => ({
      data: null,
      error: { message: 'The resource was not found', status: 400, statusCode: 'NoSuchBucket' },
    }))
    await expect(probeSupabaseBucket(client(noSuchBucket), 'e')).rejects.toMatchObject({
      code: 'STORAGE_BUCKET_MISSING',
    })
  })

  it('treats "not found" as a miss only for a 404 or a non-5xx "Bucket not found"', async () => {
    const unrelated = vi.fn(async () => ({
      data: null,
      error: { message: 'Object not found', status: 500, statusCode: '500' },
    }))
    await expect(probeSupabaseBucket(client(unrelated), 'a')).rejects.toMatchObject({
      code: 'STORAGE_BUCKET_PROBE_FAILED',
    })

    const genericNoStatus = vi.fn(async () => ({ data: null, error: { message: 'tenant not found' } }))
    await expect(probeSupabaseBucket(client(genericNoStatus), 'b')).rejects.toMatchObject({
      code: 'STORAGE_BUCKET_PROBE_FAILED',
    })

    const bucketServerError = vi.fn(async () => ({ data: null, error: { message: 'Bucket not found', status: 503 } }))
    await expect(probeSupabaseBucket(client(bucketServerError), 'f')).rejects.toMatchObject({
      code: 'STORAGE_BUCKET_PROBE_FAILED',
    })

    const bucketNoStatus = vi.fn(async () => ({ data: null, error: { message: 'Bucket not found' } }))
    await expect(probeSupabaseBucket(client(bucketNoStatus), 'c')).rejects.toMatchObject({
      code: 'STORAGE_BUCKET_MISSING',
    })
  })

  it('throws STORAGE_BUCKET_PROBE_FAILED when getBucket throws or returns a server error', async () => {
    const thrown = vi.fn(async () => {
      throw new Error('network down')
    })
    await expect(probeSupabaseBucket(client(thrown), 'screenshots')).rejects.toMatchObject({
      code: 'STORAGE_BUCKET_PROBE_FAILED',
      bucket: 'screenshots',
      message: 'Could not verify storage bucket "screenshots": network down',
    })

    const server = vi.fn(async () => ({
      data: null,
      error: { message: 'internal', status: 500, statusCode: '500' },
    }))
    await expect(probeSupabaseBucket(client(server), 'screenshots')).rejects.toMatchObject({
      code: 'STORAGE_BUCKET_PROBE_FAILED',
      message: 'Could not verify storage bucket "screenshots": internal',
    })
    expect(server).toHaveBeenCalledTimes(1)
  })
})

describe('chooseSupabaseBucket', () => {
  beforeEach(() => clearBucketProbeCache())

  it('uses a configured bucket that exists', async () => {
    const getBucket = vi.fn(async (name: string) => ({ data: { name }, error: null }))
    await expect(chooseSupabaseBucket(client(getBucket), 'custom-shots')).resolves.toEqual({
      bucket: 'custom-shots',
    })
    expect(getBucket).toHaveBeenCalledTimes(1)
    expect(getBucket).toHaveBeenCalledWith('custom-shots')
  })

  it('falls back to the cluster default when the configured bucket is missing', async () => {
    const getBucket = vi.fn(async (name: string) => {
      if (name === 'screenshots') return { data: { name }, error: null }
      return { data: null, error: { message: 'Bucket not found', status: 404, statusCode: '404' } }
    })
    await expect(chooseSupabaseBucket(client(getBucket), 'mushi-screenshots')).resolves.toEqual({
      bucket: 'screenshots',
      missingConfigured: 'mushi-screenshots',
      missCached: false,
    })
    expect(getBucket).toHaveBeenCalledWith('mushi-screenshots')
    expect(getBucket).toHaveBeenCalledWith('screenshots')
  })

  it('does not treat a probe error as a missing bucket', async () => {
    const getBucket = vi.fn(async () => ({ data: null, error: { message: 'timeout', status: 503 } }))
    await expect(chooseSupabaseBucket(client(getBucket), 'custom-shots')).rejects.toMatchObject({
      code: 'STORAGE_BUCKET_PROBE_FAILED',
      bucket: 'custom-shots',
    })
    expect(getBucket).toHaveBeenCalledTimes(1)
  })

  it('throws when the cluster default bucket is missing', async () => {
    const getBucket = vi.fn(async () => ({
      data: null,
      error: { message: 'Bucket not found', status: 404 },
    }))
    await expect(chooseSupabaseBucket(client(getBucket), '  ')).rejects.toMatchObject({
      code: 'STORAGE_BUCKET_MISSING',
      bucket: 'screenshots',
    })
  })
})

describe('preflightSupabaseBucketSetting', () => {
  beforeEach(() => clearBucketProbeCache())

  it('rejects a Supabase bucket that is not in the cluster', async () => {
    const getBucket = vi.fn(async () => ({ data: null, error: { status: 404, message: 'not found' } }))
    await expect(
      preflightSupabaseBucketSetting(client(getBucket), { provider: 'supabase', bucket: 'typo' }),
    ).resolves.toEqual({
      ok: false,
      code: 'STORAGE_BUCKET_MISSING',
      message: 'Storage bucket "typo" does not exist',
    })
  })

  it('re-probes a cached miss so a just-created bucket can be saved', async () => {
    let exists = false
    const getBucket = vi.fn(async (name: string) =>
      exists ? { data: { name }, error: null } : { data: null, error: { message: 'Bucket not found', status: 404 } },
    )
    await expect(probeSupabaseBucket(client(getBucket), 'new-shots')).rejects.toBeInstanceOf(StorageBucketError)
    exists = true
    await expect(
      preflightSupabaseBucketSetting(client(getBucket), { provider: 'supabase', bucket: 'new-shots' }),
    ).resolves.toEqual({ ok: true })
    expect(getBucket).toHaveBeenCalledTimes(2)
  })

  it('accepts a bucket that exists', async () => {
    const getBucket = vi.fn(async () => ({ data: { name: 'screenshots' }, error: null }))
    await expect(
      preflightSupabaseBucketSetting(client(getBucket), { provider: 'supabase', bucket: 'screenshots' }),
    ).resolves.toEqual({ ok: true })
  })

  it('does not probe an external provider or block a save when the probe errors', async () => {
    const getBucket = vi.fn(async () => {
      throw new Error('storage down')
    })
    await expect(
      preflightSupabaseBucketSetting(client(getBucket), { provider: 's3', bucket: 'external' }),
    ).resolves.toEqual({ ok: true })
    expect(getBucket).not.toHaveBeenCalled()

    await expect(
      preflightSupabaseBucketSetting(client(getBucket), { provider: 'supabase', bucket: 'screenshots' }),
    ).resolves.toEqual({ ok: true })
    expect(getBucket).toHaveBeenCalledTimes(1)
  })
})
