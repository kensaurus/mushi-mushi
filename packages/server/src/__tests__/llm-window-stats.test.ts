/**
 * FILE: packages/server/src/__tests__/llm-window-stats.test.ts
 * PURPOSE: /health/stats and /health/llm report exact window totals.
 *
 * Why (2026-10-04, QA entry 146): both routes read the newest 500
 * llm_invocations rows and reported `rows.length` as the call count, so a
 * busy project showed "500 calls" and rates over that sample. Counts are now
 * head counts; latency comes from llm_latency_window_stats, and a missing
 * function is reported as a sample, never as exact.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('Deno', { env: { get: () => undefined } })

interface Filters {
  eq: Array<[string, unknown]>
}

function fakeDb(opts: {
  total: number
  success: number
  fallbacks: number
  rpc: { data: unknown; error: { message: string } | null }
  sample?: number[]
  countError?: boolean
}) {
  const calls = { rpc: 0, sample: 0 }
  const db = {
    calls,
    rpc: vi.fn(async () => {
      calls.rpc += 1
      return opts.rpc
    }),
    from: () => ({
      select: (_cols: string, o?: { head?: boolean }) => {
        const f: Filters = { eq: [] }
        const head = Boolean(o?.head)
        const builder = {
          in: () => builder,
          gte: () => builder,
          order: () => builder,
          limit: async () => {
            calls.sample += 1
            return { data: (opts.sample ?? []).map((latency_ms) => ({ latency_ms })), error: null }
          },
          eq: (col: string, v: unknown) => {
            f.eq.push([col, v])
            return builder
          },
          then: (resolve: (v: unknown) => void) => {
            if (!head) return resolve({ data: [], error: null })
            if (opts.countError) return resolve({ count: null, error: { message: 'boom' } })
            const status = f.eq.find(([c]) => c === 'status')
            const fb = f.eq.find(([c]) => c === 'fallback_used')
            resolve({ count: status ? opts.success : fb ? opts.fallbacks : opts.total, error: null })
          },
        }
        return builder
      },
    }),
  }
  return db
}

async function load() {
  return import('../../supabase/functions/_shared/llm-window-stats.ts')
}

afterEach(() => vi.clearAllMocks())

describe('loadLlmWindowStats', () => {
  it('reports the exact window count, not a 500-row sample', async () => {
    const { loadLlmWindowStats } = await load()
    const db = fakeDb({
      total: 1234,
      success: 1200,
      fallbacks: 100,
      rpc: { data: [{ avg_latency_ms: 900, p95_latency_ms: 4000 }], error: null },
    })
    const s = await loadLlmWindowStats(db as never, ['p1'], '2026-10-01T00:00:00Z')
    expect(s.totalCalls).toBe(1234)
    expect(s.errors).toBe(34)
    expect(s.errorRatePct).toBe(2.8)
    expect(s.fallbackRatePct).toBe(8.1)
    expect(s.p95LatencyMs).toBe(4000)
    expect(s.latencyExact).toBe(true)
    expect(db.calls.sample).toBe(0)
  })

  it('flags latency as a sample when the SQL function is missing', async () => {
    const { loadLlmWindowStats } = await load()
    const db = fakeDb({
      total: 900,
      success: 900,
      fallbacks: 0,
      rpc: { data: null, error: { message: 'Could not find the function' } },
      sample: [100, 200, 300],
    })
    const s = await loadLlmWindowStats(db as never, ['p1'], '2026-10-01T00:00:00Z')
    expect(s.totalCalls).toBe(900)
    expect(s.avgLatencyMs).toBe(200)
    expect(s.latencyExact).toBe(false)
  })

  it('throws instead of inventing a number when a count fails', async () => {
    const { loadLlmWindowStats } = await load()
    const db = fakeDb({ total: 0, success: 0, fallbacks: 0, rpc: { data: [], error: null }, countError: true })
    await expect(loadLlmWindowStats(db as never, ['p1'], '2026-10-01T00:00:00Z')).rejects.toThrow(/count failed/)
  })

  it('is all zero for no projects without querying', async () => {
    const { loadLlmWindowStats } = await load()
    const db = fakeDb({ total: 5, success: 5, fallbacks: 0, rpc: { data: [], error: null } })
    const s = await loadLlmWindowStats(db as never, [], '2026-10-01T00:00:00Z')
    expect(s.totalCalls).toBe(0)
    expect(db.rpc).not.toHaveBeenCalled()
  })
})
