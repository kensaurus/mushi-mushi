/**
 * FILE: storage-bucket.test.ts
 * PURPOSE: Bucket existence probe used before a Supabase Storage upload.
 *
 * OVERVIEW:
 * - Present bucket is cached for the isolate
 * - A missing bucket is a typed STORAGE_BUCKET_MISSING error and is not cached
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

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
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

  it('throws STORAGE_BUCKET_MISSING for a 404 and does not cache the miss', async () => {
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
    })
    await expect(probeSupabaseBucket(c, 'nope')).rejects.toBeInstanceOf(StorageBucketError)
    expect(getBucket).toHaveBeenCalledTimes(2)
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
