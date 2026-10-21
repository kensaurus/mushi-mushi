/**
 * FILE: storage-adapter-bucket.test.ts
 * PURPOSE: The bucket probe as wired into storage.ts and the storage settings save.
 *
 * OVERVIEW:
 * - getStorageAdapter never fails ingest on a probe error; it uses the bucket unverified
 * - A confirmed miss falls back to the cluster default and logs once per miss TTL
 * - The health check's bucket_probe step fails on a miss or a probe error;
 *   a configured miss with a healthy fallback stores degraded
 * - gateSupabaseBucketSave probes only a bucket the patch itself sets
 *
 * DEPENDENCIES:
 * - vitest
 * - _shared/storage.ts, api/routes/admin-ops.ts (db and logger mocked)
 *
 * USAGE:
 * - pnpm --filter @mushi-mushi/server exec vitest run src/__tests__/storage-adapter-bucket.test.ts
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type ProbeResult = { data: { name?: string } | null; error: { message?: string; status?: number } | null }

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = vi.fn()
  logger.child = () => logger
  return logger as Record<string, ReturnType<typeof vi.fn>> & { child: () => unknown }
})

const state = vi.hoisted(() => ({
  settings: null as Record<string, unknown> | null,
  settingsError: null as { code: string } | null,
  getBucket: null as unknown as (name: string) => Promise<ProbeResult>,
  uploads: [] as string[],
}))

function fakeDb() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: state.settings, error: state.settingsError }),
        }),
      }),
    }),
    rpc: async () => ({ data: null, error: null }),
    storage: {
      getBucket: (name: string) => state.getBucket(name),
      from: (bucket: string) => ({
        upload: async () => {
          state.uploads.push(bucket)
          return { error: null }
        },
        createSignedUrl: async () => ({ data: { signedUrl: `https://signed/${bucket}` }, error: null }),
        list: async () => ({ data: [], error: null }),
      }),
    },
  }
}

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => fakeDb() }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  apiKeyAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/ee-gate.ts', () => ({
  requireEeLicense: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: vi.fn(async () => {}) }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

let storage: typeof import('../../supabase/functions/_shared/storage.ts')
let bucketMod: typeof import('../../supabase/functions/_shared/storage-bucket.ts')
let routes: typeof import('../../supabase/functions/api/routes/admin-ops.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  storage = await import('../../supabase/functions/_shared/storage.ts')
  bucketMod = await import('../../supabase/functions/_shared/storage-bucket.ts')
  routes = await import('../../supabase/functions/api/routes/admin-ops.ts')
})

const PROJECT = '1000000a-0000-4000-8000-000000000000'

function supabaseSettings(bucket: string): Record<string, unknown> {
  return { project_id: PROJECT, provider: 'supabase', bucket, path_prefix: '' }
}

const found = (name: string): ProbeResult => ({ data: { name }, error: null })
const missing: ProbeResult = { data: null, error: { message: 'Bucket not found', status: 404 } }
const serverError: ProbeResult = { data: null, error: { message: 'upstream timeout', status: 503 } }

async function uploadedBucket(): Promise<string> {
  const adapter = await storage.getStorageAdapter(PROJECT)
  await adapter.upload({ key: 'k.png', body: new Uint8Array([1]), contentType: 'image/png' })
  return state.uploads.at(-1) as string
}

beforeEach(() => {
  storage.invalidateStorageCache()
  bucketMod.clearBucketProbeCache()
  state.settings = null
  state.settingsError = null
  state.uploads = []
  for (const level of ['warn', 'error']) fakeLog[level].mockClear()
})

describe('getStorageAdapter', () => {
  it('uses the configured bucket unverified when the probe errors', async () => {
    state.settings = supabaseSettings('custom-shots')
    state.getBucket = vi.fn(async () => serverError)
    await expect(uploadedBucket()).resolves.toBe('custom-shots')
    expect(fakeLog.warn).toHaveBeenCalledWith(
      'supabase bucket probe failed; using bucket unverified',
      expect.objectContaining({ bucket: 'custom-shots', code: 'STORAGE_BUCKET_PROBE_FAILED' }),
    )
  })

  it('maps the legacy mushi-screenshots name to the cluster default when the probe errors', async () => {
    state.settings = supabaseSettings('mushi-screenshots')
    state.getBucket = vi.fn(async () => serverError)
    await expect(uploadedBucket()).resolves.toBe('screenshots')
  })

  it('returns an adapter that fails on use, rather than throwing, when the cluster default is missing', async () => {
    state.settings = supabaseSettings('screenshots')
    state.getBucket = vi.fn(async () => missing)
    const adapter = await storage.getStorageAdapter(PROJECT)
    await expect(
      adapter.upload({ key: 'k.png', body: new Uint8Array([1]), contentType: 'image/png' }),
    ).rejects.toThrow('Storage bucket "screenshots" does not exist')
    expect(state.uploads).toHaveLength(0)

    state.settings = { project_id: PROJECT, provider: 's3', bucket: 'ext', path_prefix: '' }
    storage.invalidateStorageCache()
    await expect(storage.getStorageAdapter(PROJECT)).resolves.toBeDefined()
  })

  it('uses the cluster default unverified when its probe throws after a confirmed miss', async () => {
    state.settings = supabaseSettings('gone')
    state.getBucket = vi.fn(async (name: string) => {
      if (name === 'screenshots') throw new Error('network down')
      return missing
    })
    await expect(uploadedBucket()).resolves.toBe('screenshots')
  })

  it('falls back to the cluster default unverified on the external-provider fallback path', async () => {
    state.settings = { project_id: PROJECT, provider: 's3', bucket: 'ext', path_prefix: '' }
    state.getBucket = vi.fn(async () => serverError)
    await expect(uploadedBucket()).resolves.toBe('screenshots')
  })

  it('falls back on a confirmed miss and probes and logs it once per miss TTL', async () => {
    state.settings = supabaseSettings('mushi-screenshots')
    const getBucket = vi.fn(async (name: string) => (name === 'screenshots' ? found(name) : missing))
    state.getBucket = getBucket
    await expect(uploadedBucket()).resolves.toBe('screenshots')
    await expect(uploadedBucket()).resolves.toBe('screenshots')
    await expect(uploadedBucket()).resolves.toBe('screenshots')
    expect(getBucket.mock.calls.filter(([n]) => n === 'mushi-screenshots')).toHaveLength(1)
    const missLogs = fakeLog.error.mock.calls.filter(
      ([msg]) => msg === 'configured supabase bucket does not exist; using cluster default',
    )
    expect(missLogs).toHaveLength(1)
  })
})

describe('getStorageAdapterForHealthCheck bucket_probe', () => {
  it('passes when the bucket exists', async () => {
    state.settings = supabaseSettings('screenshots')
    state.getBucket = vi.fn(async (name: string) => found(name))
    const { prefixDebug } = await storage.getStorageAdapterForHealthCheck(PROJECT)
    expect(prefixDebug.find((s) => s.step === 'bucket_probe')).toMatchObject({ ok: true, detail: 'bucket=screenshots' })
  })

  it('warns on a missing configured bucket, even when cached, and checks the fallback bucket', async () => {
    state.settings = supabaseSettings('typo')
    const getBucket = vi.fn(async (name: string) => (name === 'screenshots' ? found(name) : missing))
    state.getBucket = getBucket
    await storage.getStorageAdapter(PROJECT)
    const { adapter, prefixDebug } = await storage.getStorageAdapterForHealthCheck(PROJECT)
    expect(prefixDebug.find((s) => s.step === 'bucket_probe')).toMatchObject({
      ok: false,
      detail: 'Storage bucket "typo" does not exist; uploads use bucket=screenshots',
    })
    const probe = await adapter.healthCheck()
    expect(probe).toMatchObject({ ok: true })
    expect(routes.storageHealthStatus(probe, prefixDebug)).toEqual({
      status: 'degraded',
      error: 'Storage bucket "typo" does not exist; uploads use bucket=screenshots',
    })
    expect(getBucket.mock.calls.filter(([n]) => n === 'typo')).toHaveLength(2)
  })

  it('re-probes a bucket confirmed earlier in the isolate and fails once it is gone', async () => {
    state.settings = supabaseSettings('screenshots')
    let exists = true
    const getBucket = vi.fn(async (name: string) => (exists ? found(name) : missing))
    state.getBucket = getBucket
    await storage.getStorageAdapter(PROJECT)
    exists = false
    const { adapter, prefixDebug } = await storage.getStorageAdapterForHealthCheck(PROJECT)
    expect(prefixDebug.find((s) => s.step === 'bucket_probe')).toMatchObject({
      ok: false,
      detail: 'Storage bucket "screenshots" does not exist',
    })
    await expect(adapter.healthCheck()).resolves.toMatchObject({ ok: false })
    expect(getBucket).toHaveBeenCalledTimes(2)
  })

  it('fails when the probe errors', async () => {
    state.settings = supabaseSettings('screenshots')
    state.getBucket = vi.fn(async () => serverError)
    const { adapter, prefixDebug } = await storage.getStorageAdapterForHealthCheck(PROJECT)
    expect(prefixDebug.find((s) => s.step === 'bucket_probe')).toMatchObject({
      ok: false,
      detail: 'Could not verify storage bucket "screenshots": upstream timeout',
    })
    await expect(adapter.healthCheck()).resolves.toMatchObject({ ok: false })
  })

  it('stores healthy and failing as before', () => {
    expect(routes.storageHealthStatus({ ok: true }, [{ step: 'bucket_probe', ok: true }])).toEqual({
      status: 'healthy',
      error: null,
    })
    expect(routes.storageHealthStatus({ ok: true }, [{ step: 'settings_lookup', ok: false }])).toEqual({
      status: 'healthy',
      error: null,
    })
    expect(routes.storageHealthStatus({ ok: false, error: 'boom' }, [])).toEqual({
      status: 'failing',
      error: 'boom',
    })
  })
})

describe('gateSupabaseBucketSave', () => {
  const c = {
    json: (body: unknown, status: number) => ({ status, body }),
  } as unknown as Parameters<typeof routes.gateSupabaseBucketSave>[0]
  const db = () => fakeDb() as unknown as Parameters<typeof routes.gateSupabaseBucketSave>[1]

  it('does not probe when switching provider back to supabase without a bucket', async () => {
    state.settings = { provider: 's3', bucket: 'my-s3-bucket' }
    const getBucket = vi.fn(async () => missing)
    state.getBucket = getBucket
    await expect(routes.gateSupabaseBucketSave(c, db(), PROJECT, { provider: 'supabase' })).resolves.toBeNull()
    expect(getBucket).not.toHaveBeenCalled()
  })

  it('does not probe a re-save that leaves the legacy bucket name untouched', async () => {
    state.settings = { provider: 'supabase', bucket: 'mushi-screenshots' }
    const getBucket = vi.fn(async () => missing)
    state.getBucket = getBucket
    await expect(
      routes.gateSupabaseBucketSave(c, db(), PROJECT, { path_prefix: 'reports/', bucket: '  ' }),
    ).resolves.toBeNull()
    expect(getBucket).not.toHaveBeenCalled()
  })

  it('rejects a bucket in the patch that Storage says is missing, using the stored provider', async () => {
    state.settings = { provider: 'supabase', bucket: 'screenshots' }
    state.getBucket = vi.fn(async () => missing)
    const res = (await routes.gateSupabaseBucketSave(c, db(), PROJECT, { bucket: 'typo' })) as unknown as {
      status: number
      body: { error: { code: string } }
    }
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('STORAGE_BUCKET_MISSING')
  })

  it('does not probe a bucket in the patch when the stored provider is external', async () => {
    state.settings = { provider: 'r2', bucket: 'old' }
    const getBucket = vi.fn(async () => missing)
    state.getBucket = getBucket
    await expect(routes.gateSupabaseBucketSave(c, db(), PROJECT, { bucket: 'new-r2' })).resolves.toBeNull()
    expect(getBucket).not.toHaveBeenCalled()
  })
})
