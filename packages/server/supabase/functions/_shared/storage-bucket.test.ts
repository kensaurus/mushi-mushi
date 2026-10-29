/**
 * FILE: storage-bucket.test.ts
 * PURPOSE: Pin the Supabase bucket pre-flight (BL-011).
 *
 * OVERVIEW:
 * - Bucket present: getBucket hit is cached for the isolate
 * - Bucket missing: STORAGE_BUCKET_MISSING, and the storage call does not run
 * - Probe error: STORAGE_BUCKET_PROBE_FAILED (thrown or non-404)
 * - Health check reports the probe failure instead of throwing
 *
 * Run: cd packages/server && deno test supabase/functions/_shared/storage-bucket.test.ts
 */

import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  createSupabaseStorageAdapter,
  probeSupabaseBucket,
  StorageBucketError,
  type SupabaseBucketProbe,
} from './storage.ts'

type BucketResult = Awaited<ReturnType<SupabaseBucketProbe['getBucket']>>

function probe(result: BucketResult | (() => Promise<BucketResult>)): SupabaseBucketProbe {
  return {
    getBucket: () => (typeof result === 'function' ? result() : Promise.resolve(result)),
  }
}

Deno.test('probeSupabaseBucket — present caches the hit', async () => {
  const cache = new Map<string, true>()
  let calls = 0
  const storage: SupabaseBucketProbe = {
    getBucket: (id) => {
      calls += 1
      assertEquals(id, 'screenshots')
      return Promise.resolve({ data: { name: 'screenshots' }, error: null })
    },
  }
  await probeSupabaseBucket(storage, 'screenshots', cache)
  await probeSupabaseBucket(storage, 'screenshots', cache)
  assertEquals(calls, 1)
  assertEquals(cache.has('screenshots'), true)
})

Deno.test('probeSupabaseBucket — missing bucket is a typed error and is not cached', async () => {
  const cache = new Map<string, true>()
  let calls = 0
  const storage: SupabaseBucketProbe = {
    getBucket: () => {
      calls += 1
      return Promise.resolve({ data: null, error: { message: 'Bucket not found', statusCode: '404' } })
    },
  }
  const err = await assertRejects(
    () => probeSupabaseBucket(storage, 'no-such-bucket', cache),
    StorageBucketError,
  ) as StorageBucketError
  assertEquals(err.code, 'STORAGE_BUCKET_MISSING')
  assertEquals(err.bucket, 'no-such-bucket')
  await assertRejects(() => probeSupabaseBucket(storage, 'no-such-bucket', cache), StorageBucketError)
  assertEquals(calls, 2)
  assertEquals(cache.size, 0)
})

Deno.test('probeSupabaseBucket — probe error when getBucket fails or throws', async () => {
  const cache = new Map<string, true>()
  const failed = await assertRejects(
    () => probeSupabaseBucket(
      probe({ data: null, error: { message: 'Internal Server Error', status: 500 } }),
      'screenshots',
      cache,
    ),
    StorageBucketError,
  ) as StorageBucketError
  assertEquals(failed.code, 'STORAGE_BUCKET_PROBE_FAILED')
  assertEquals(failed.message.includes('Internal Server Error'), true)

  const thrown = await assertRejects(
    () => probeSupabaseBucket(
      { getBucket: () => Promise.reject(new Error('network down')) },
      'screenshots',
      cache,
    ),
    StorageBucketError,
  ) as StorageBucketError
  assertEquals(thrown.code, 'STORAGE_BUCKET_PROBE_FAILED')
  assertEquals(thrown.message.includes('network down'), true)
  assertEquals(cache.size, 0)
})

interface FakeOps {
  upload: number
  sign: number
  remove: number
  list: number
  from: string[]
}

function fakeDb(getBucket: SupabaseBucketProbe['getBucket'], ops: FakeOps): SupabaseClient {
  return {
    storage: {
      getBucket,
      from(bucket: string) {
        ops.from.push(bucket)
        return {
          upload: async () => {
            ops.upload += 1
            return { error: null }
          },
          createSignedUrl: async () => {
            ops.sign += 1
            return { data: { signedUrl: 'https://example.test/signed' }, error: null }
          },
          remove: async () => {
            ops.remove += 1
            return { error: null }
          },
          list: async () => {
            ops.list += 1
            return { error: null }
          },
        }
      },
    },
  } as unknown as SupabaseClient
}

function ops(): FakeOps {
  return { upload: 0, sign: 0, remove: 0, list: 0, from: [] }
}

const png = { key: 'p/a.png', body: new Uint8Array([1]), contentType: 'image/png' }

Deno.test('Supabase adapter — present bucket is probed once, then upload signs', async () => {
  const seen = ops()
  let calls = 0
  const db = fakeDb((id) => {
    calls += 1
    assertEquals(id, 'bucket-present')
    return Promise.resolve({ data: { name: 'bucket-present' }, error: null })
  }, seen)
  const adapter = createSupabaseStorageAdapter(db, 'bucket-present')
  const first = await adapter.upload(png)
  const second = await adapter.upload(png)
  assertEquals(first.storagePath, 'storage://supabase/bucket-present/p/a.png')
  assertEquals(second.signed, true)
  assertEquals(calls, 1)
  assertEquals(seen.upload, 2)
  assertEquals(seen.sign, 2)
  assertEquals(seen.from.every((b) => b === 'bucket-present'), true)
})

Deno.test('Supabase adapter — missing bucket does not upload, sign, or fall back to screenshots', async () => {
  const seen = ops()
  const db = fakeDb(
    () => Promise.resolve({ data: null, error: { message: 'Bucket not found', status: 404 } }),
    seen,
  )
  const adapter = createSupabaseStorageAdapter(db, 'typo-bucket')
  for (const run of [
    () => adapter.upload(png),
    () => adapter.signedUrl('p/a.png'),
    () => adapter.delete('p/a.png'),
  ]) {
    const err = await assertRejects(run, StorageBucketError) as StorageBucketError
    assertEquals(err.code, 'STORAGE_BUCKET_MISSING')
    assertEquals(err.bucket, 'typo-bucket')
  }
  assertEquals(seen.upload, 0)
  assertEquals(seen.sign, 0)
  assertEquals(seen.remove, 0)
  assertEquals(seen.from, [])
})

Deno.test('Supabase adapter — health check reports a missing bucket and a probe error without throwing', async () => {
  const missingOps = ops()
  const missing = createSupabaseStorageAdapter(
    fakeDb(
      () => Promise.resolve({ data: null, error: { message: 'Bucket not found', statusCode: 404 } }),
      missingOps,
    ),
    'health-missing',
  )
  const missingResult = await missing.healthCheck()
  assertEquals(missingResult.ok, false)
  assertEquals(missingResult.error?.includes('STORAGE_BUCKET_MISSING'), true)
  assertEquals(missingResult.debug.some((step) => step.step === 'bucket' && step.ok === false), true)
  assertEquals(missingOps.list, 0)

  const failedOps = ops()
  const failed = createSupabaseStorageAdapter(
    fakeDb(
      () => Promise.resolve({ data: null, error: { message: 'unavailable', status: 503 } }),
      failedOps,
    ),
    'health-probe-error',
  )
  const failedResult = await failed.healthCheck()
  assertEquals(failedResult.ok, false)
  assertEquals(failedResult.error?.includes('STORAGE_BUCKET_PROBE_FAILED'), true)
  assertEquals(failedOps.list, 0)

  const okOps = ops()
  const ok = createSupabaseStorageAdapter(
    fakeDb(
      () => Promise.resolve({ data: { name: 'health-present' }, error: null }),
      okOps,
    ),
    'health-present',
  )
  const okResult = await ok.healthCheck()
  assertEquals(okResult.ok, true)
  assertEquals(okResult.debug.some((step) => step.step === 'bucket' && step.ok === true), true)
  assertEquals(okOps.list, 1)
})
