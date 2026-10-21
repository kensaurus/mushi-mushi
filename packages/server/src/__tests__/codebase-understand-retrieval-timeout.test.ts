import { beforeEach, describe, expect, it, vi } from 'vitest'

const warn = vi.fn()

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'error', 'fatal', 'audit']) noop[level] = () => {}
  noop.warn = (...args: unknown[]) => warn(...args)
  noop.child = () => noop
  return { log: noop, createLogger: () => noop }
})
vi.mock('../../supabase/functions/_shared/embeddings.ts', () => ({
  createEmbedding: vi.fn(async () => [0.1, 0.2]),
}))

import { retrieveCodeForQuestion } from '../../supabase/functions/_shared/codebase-understand.ts'

function fakeDb(rpcError: { code?: string; message: string } | null) {
  const rpc = vi.fn(async (name: string) =>
    name === 'match_codebase_files'
      ? { data: null, error: rpcError }
      : { data: [], error: null },
  )
  const settingsQuery = {
    select: () => settingsQuery,
    eq: () => settingsQuery,
    maybeSingle: async () => ({ data: null, error: null }),
  }
  return { db: { from: () => settingsQuery, rpc } as never, rpc }
}

describe('retrieveCodeForQuestion on match_codebase_files errors', () => {
  beforeEach(() => warn.mockClear())

  it('returns an empty rpc_timeout result and warns on statement_timeout (57014)', async () => {
    const { db } = fakeDb({ code: '57014', message: 'canceling statement due to statement timeout' })
    const result = await retrieveCodeForQuestion(db, 'proj-1', 'why does login fail', 12)
    expect(result).toEqual({ files: [], wikiChunks: [], reason: 'rpc_timeout' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[1]).toMatchObject({ projectId: 'proj-1', k: 12 })
  })

  it('keeps rpc_failed for other errors without the timeout warning', async () => {
    const { db } = fakeDb({ code: '42883', message: 'function does not exist' })
    const result = await retrieveCodeForQuestion(db, 'proj-1', 'why does login fail', 12)
    expect(result.reason).toBe('rpc_failed')
    expect(warn).not.toHaveBeenCalled()
  })
})
