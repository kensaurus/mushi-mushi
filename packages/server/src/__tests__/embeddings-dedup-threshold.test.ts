/**
 * Settings → General "Dedup threshold" is read when grouping similar reports.
 * It used to be saved and never read, so grouping always used 0.82.
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => ({}),
}))
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/observability.ts', () => ({
  createTrace: () => ({ id: 't', span: () => ({ end: () => {} }), end: async () => {} }),
}))
vi.mock('../../supabase/functions/_shared/byok.ts', () => ({
  resolveLlmKey: async () => null,
}))

import { projectDedupThreshold } from '../../supabase/functions/_shared/embeddings.ts'

function dbWith(row: unknown) {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: row, error: null }) }
  return { from: () => q } as never
}

describe('projectDedupThreshold', () => {
  it("uses the project's saved threshold", async () => {
    expect(await projectDedupThreshold(dbWith({ dedup_threshold: 0.9 }), 'p1')).toBe(0.9)
  })

  it('falls back to 0.82 when unset, out of range or unreadable', async () => {
    expect(await projectDedupThreshold(dbWith(null), 'p1')).toBe(0.82)
    expect(await projectDedupThreshold(dbWith({ dedup_threshold: 0 }), 'p1')).toBe(0.82)
    expect(await projectDedupThreshold(dbWith({ dedup_threshold: 1.5 }), 'p1')).toBe(0.82)
    expect(await projectDedupThreshold(dbWith({ dedup_threshold: 'x' }), 'p1')).toBe(0.82)
  })
})
