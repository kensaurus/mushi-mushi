/**
 * Sentry MUSHI-MUSHI-SERVER-1N: glot.it's legacy BYOK OpenAI key was revoked
 * upstream, every RAG lookup got a 401, and fix attempts ended
 * `skipped_no_context` because embeddings had no failover. A rejected project
 * key is now retired (auth_failed / error_auth) and the call fails over once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const retiredRows: string[] = []
const legacyUpdates: unknown[] = []
let candidates: Array<{ key: string; source: 'byok' | 'env'; keyId?: string }> = []

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => ({
    from: () => ({
      update: (row: unknown) => {
        legacyUpdates.push(row)
        return { eq: async () => ({ error: null }) }
      },
    }),
  }),
}))
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/observability.ts', () => ({
  createTrace: () => ({ id: 't', span: () => ({ end: () => {} }), end: async () => {} }),
}))
vi.mock('../../supabase/functions/_shared/byok.ts', () => ({
  // Mirrors the real resolver: a legacy ref is skipped once its test status
  // is no longer 'ok', and resolution falls through to the env key.
  resolveLlmKey: async () => {
    const live = candidates.filter((c) => c.keyId || legacyUpdates.length === 0)
    return live[0] ?? { key: 'sk-env', source: 'env' }
  },
  markKeyStatus: async (_db: unknown, keyId: string) => {
    retiredRows.push(keyId)
    candidates = candidates.filter((c) => c.keyId !== keyId)
  },
}))

const { createEmbedding } = await import('../../supabase/functions/_shared/embeddings.ts')

const usedKeys: string[] = []
const okBody = JSON.stringify({ data: [{ embedding: [0.1, 0.2], index: 0 }] })

beforeEach(() => {
  retiredRows.length = 0
  legacyUpdates.length = 0
  usedKeys.length = 0
  vi.stubGlobal('Deno', { env: { get: (k: string) => (k === 'OPENAI_API_KEY' ? 'sk-env' : undefined) } })
  vi.stubGlobal('fetch', async (_url: string, init: { headers: Record<string, string> }) => {
    const key = init.headers.Authorization.replace('Bearer ', '')
    usedKeys.push(key)
    return key === 'sk-env' ? new Response(okBody, { status: 200 }) : new Response('{"error":"bad key"}', { status: 401 })
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('createEmbedding key failover', () => {
  it('retires a rejected byok_keys row and fails over to the platform key', async () => {
    candidates = [{ key: 'sk-dead', source: 'byok', keyId: 'row-1' }]
    await expect(createEmbedding('x', { projectId: 'p1' })).resolves.toEqual([0.1, 0.2])
    expect(retiredRows).toEqual(['row-1'])
    expect(usedKeys).toEqual(['sk-dead', 'sk-env'])
  })

  it('retires a rejected legacy project_settings key and fails over', async () => {
    candidates = [{ key: 'sk-legacy', source: 'byok' }]
    await expect(createEmbedding('x', { projectId: 'p1' })).resolves.toEqual([0.1, 0.2])
    expect(legacyUpdates).toEqual([{ byok_openai_test_status: 'error_auth' }])
    expect(usedKeys).toEqual(['sk-legacy', 'sk-env'])
  })

  it('does not fail over when the platform key itself is rejected', async () => {
    candidates = [{ key: 'sk-env', source: 'env' }]
    vi.stubGlobal('fetch', async () => new Response('{"error":"bad"}', { status: 401 }))
    await expect(createEmbedding('x', { projectId: 'p1' })).rejects.toThrow(/401/)
    expect(retiredRows).toEqual([])
    expect(legacyUpdates).toEqual([])
  })
})
